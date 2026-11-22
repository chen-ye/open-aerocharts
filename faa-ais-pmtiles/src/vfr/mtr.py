"""Convert ADDS Military Training Routes (MTRSegment) and NASR MTR backfill to FlatGeobuf."""

import json
import math
import os
from collections import defaultdict

import geopandas as gpd
import numpy as np
import pandas as pd
import pyproj
import shapely
from shapely.errors import GEOSException
from shapely.geometry import LineString, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, unary_union

from src.adds.convert import normalize_boundary_limit
from src.common.utils import save_fgb, unwrap_coordinates

MTR_TYPE_MAP: dict[int | str, str] = {
    0: "IR",
    "0": "IR",
    "IR": "IR",
    1: "VR",
    "1": "VR",
    "VR": "VR",
    2: "SR",
    "2": "SR",
    "SR": "SR",
}

METERS_PER_NM = 1852.0
MAX_CORRIDOR_WIDTH_NM = 20.0


def _map_mtr_type(raw_type: object) -> str:
    if raw_type is None or isinstance(raw_type, bool):
        return ""
    if raw_type in MTR_TYPE_MAP:
        return MTR_TYPE_MAP[raw_type]
    text = str(raw_type).strip().upper()
    return MTR_TYPE_MAP.get(text, "")


def _parse_width(val: object) -> float | None:
    if val is None or isinstance(val, bool):
        return None
    try:
        w = float(val)
    except TypeError, ValueError:
        return None
    if not math.isfinite(w) or w < 0:
        return None
    return w


def _clamp_width(val: object) -> float:
    w = _parse_width(val)
    if w is None:
        return 0.0
    return min(MAX_CORRIDOR_WIDTH_NM, w)


def _parse_seq(val: object) -> float:
    if val is None or isinstance(val, bool):
        return 0.0
    try:
        num = float(val)
    except TypeError, ValueError:
        return 0.0
    return num if math.isfinite(num) else 0.0


def _transform_geom(geom: BaseGeometry, transformer: pyproj.Transformer) -> BaseGeometry:
    return shapely.transform(
        geom,
        lambda coords: np.column_stack(transformer.transform(coords[:, 0], coords[:, 1])) if len(coords) else coords,
    )


def _extract_polygonal(geom: BaseGeometry) -> BaseGeometry | None:
    if geom.is_empty:
        return None
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
    if geom.is_empty:
        return None
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if geom.geom_type == "GeometryCollection":
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon") and not g.is_empty]
        if not polys:
            return None
        merged = unary_union(polys)
        if not merged.is_valid:
            merged = shapely.make_valid(merged)
        return merged if merged.geom_type in ("Polygon", "MultiPolygon") and not merged.is_empty else None
    return None


def _safe_single_sided_buffer(geom: BaseGeometry, distance_m: float) -> BaseGeometry | None:
    try:
        buf = geom.buffer(distance_m, single_sided=True, quad_segs=8)
        return _extract_polygonal(buf)
    except GEOSException:
        parts: list[BaseGeometry] = []
        subgeoms = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
        for sub in subgeoms:
            if sub.is_empty or sub.length == 0:
                continue
            try:
                buf = sub.buffer(distance_m, single_sided=True, quad_segs=8)
                poly = _extract_polygonal(buf)
                if poly is not None:
                    parts.append(poly)
            except GEOSException:
                coords = list(sub.coords)
                for idx in range(len(coords) - 1):
                    if coords[idx] == coords[idx + 1]:
                        continue
                    seg = LineString([coords[idx], coords[idx + 1]])
                    if seg.length == 0:
                        continue
                    try:
                        buf = seg.buffer(distance_m, single_sided=True, quad_segs=8)
                        poly = _extract_polygonal(buf)
                        if poly is not None:
                            parts.append(poly)
                    except GEOSException:
                        continue
        if not parts:
            return None
        return _extract_polygonal(unary_union(parts))


def convert_mtrs(
    raw_path: str = "data/mtr_raw.geojson",
    nasr_mtr_path: str = "data/nasr_mtr_raw.json",
    mtrs_output: str = "data/mtrs.fgb",
    corridors_output: str = "data/mtr_corridors.fgb",
) -> None:
    """Convert ADDS MTR segments and NASR MTR backfill routes into centerline and corridor FlatGeobuf files."""
    adds_features: list[dict] = []
    if os.path.exists(raw_path):
        with open(raw_path) as f:
            adds_data = json.load(f)
        if isinstance(adds_data, dict):
            adds_features = adds_data.get("features") or []
    else:
        print(f"  ADDS MTR file not found at {raw_path}")

    nasr_routes: dict[str, dict] = {}
    nasr_points: dict[str, list[dict]] = {}
    if os.path.exists(nasr_mtr_path):
        with open(nasr_mtr_path) as f:
            nasr_data = json.load(f)
        if isinstance(nasr_data, dict):
            nasr_routes = nasr_data.get("routes") or {}
            nasr_points = nasr_data.get("points") or {}

    if not adds_features and not nasr_points:
        print("  No MTR features found, skipping.")
        return

    print("Processing Military Training Routes (MTR)...")
    centerline_rows: list[dict] = []
    centerline_geoms: list[BaseGeometry] = []
    seen_routes: set[str] = set()
    corridor_segments_by_route: dict[str, list[tuple[float, float, BaseGeometry]]] = defaultdict(list)
    route_meta: dict[str, dict] = {}

    for ft in adds_features:
        raw = ft.get("properties") or {}
        geom_dict = ft.get("geometry")
        if not geom_dict:
            continue

        mtr_type = _map_mtr_type(raw.get("MTR_TYPE"))
        ident = str(raw.get("IDENT") or "").strip().upper()
        if not mtr_type or not ident:
            continue

        route_id = ident if ident.startswith(mtr_type) else f"{mtr_type}{ident}"

        try:
            geom = shapely.force_2d(shape(geom_dict))
        except Exception:
            continue
        if geom.is_empty or geom.geom_type not in ("LineString", "MultiLineString"):
            continue

        seen_routes.add(route_id)
        lower_alt = normalize_boundary_limit(raw.get("LOWER_VAL"), raw.get("LOWER_UOM"), raw.get("LOWER_CODE"))
        upper_alt = normalize_boundary_limit(raw.get("UPPER_VAL"), raw.get("UPPER_UOM"), raw.get("UPPER_CODE"))
        width_left_raw = _parse_width(raw.get("WIDTHLEFT"))
        width_right_raw = _parse_width(raw.get("WIDTHRIGHT"))

        nasr_route = nasr_routes.get(route_id) or {}
        artcc = (nasr_route.get("artcc") or "").strip()
        fss = (nasr_route.get("fss") or "").strip()
        time_of_use = (nasr_route.get("time_of_use") or "").strip()
        rank = 3 if mtr_type in ("IR", "VR") else 4

        centerline_rows.append(
            {
                "route_id": route_id,
                "mtr_type": mtr_type,
                "lower_alt": lower_alt,
                "upper_alt": upper_alt,
                "width_left": width_left_raw,
                "width_right": width_right_raw,
                "artcc": artcc,
                "fss": fss,
                "time_of_use": time_of_use,
                "source": "adds",
                "rank": rank,
            }
        )
        centerline_geoms.append(geom)

        wl = _clamp_width(raw.get("WIDTHLEFT"))
        wr = _clamp_width(raw.get("WIDTHRIGHT"))
        if wl > 0 or wr > 0:
            corridor_segments_by_route[route_id].append((wl, wr, geom))
            route_meta.setdefault(
                route_id,
                {
                    "route_id": route_id,
                    "mtr_type": mtr_type,
                    "artcc": artcc,
                    "fss": fss,
                    "time_of_use": time_of_use,
                    "source": "adds",
                    "rank": rank,
                },
            )

    backfill_count = 0
    for route_id, raw_pts in nasr_points.items():
        route_key = str(route_id).strip().upper()
        if not route_key or route_key in seen_routes:
            continue

        sorted_pts = sorted(raw_pts, key=lambda pt: _parse_seq(pt.get("seq")))
        coords_2d: list[tuple[float, float]] = []
        for pt in sorted_pts:
            lat_raw = pt.get("lat")
            lon_raw = pt.get("lon")
            if lat_raw is None or lon_raw is None or isinstance(lat_raw, bool) or isinstance(lon_raw, bool):
                continue
            try:
                lat = float(lat_raw)
                lon = float(lon_raw)
            except TypeError, ValueError:
                continue
            if not (math.isfinite(lat) and math.isfinite(lon)):
                continue
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue
            coord = (lon, lat)
            if not coords_2d or coords_2d[-1] != coord:
                coords_2d.append(coord)

        if len(coords_2d) < 2 or len(set(coords_2d)) < 2:
            continue

        unwrapped_3d = unwrap_coordinates([(lon, lat, 0.0) for lon, lat in coords_2d])
        unwrapped_2d = [(lon, lat) for lon, lat, _ in unwrapped_3d]

        nasr_route = nasr_routes.get(route_key) or {}
        mtr_type = (nasr_route.get("mtr_type") or route_key[:2]).strip().upper()
        rank = 3 if mtr_type in ("IR", "VR") else 4

        centerline_rows.append(
            {
                "route_id": route_key,
                "mtr_type": mtr_type,
                "lower_alt": "",
                "upper_alt": "",
                "width_left": None,
                "width_right": None,
                "artcc": (nasr_route.get("artcc") or "").strip(),
                "fss": (nasr_route.get("fss") or "").strip(),
                "time_of_use": (nasr_route.get("time_of_use") or "").strip(),
                "source": "nasr",
                "rank": rank,
            }
        )
        centerline_geoms.append(LineString(unwrapped_2d))
        backfill_count += 1

    if centerline_rows:
        os.makedirs(os.path.dirname(mtrs_output) or ".", exist_ok=True)
        gdf_mtrs = gpd.GeoDataFrame(centerline_rows, geometry=centerline_geoms, crs="EPSG:4326")
        gdf_mtrs["width_left"] = pd.to_numeric(gdf_mtrs["width_left"], errors="coerce").astype("float64")
        gdf_mtrs["width_right"] = pd.to_numeric(gdf_mtrs["width_right"], errors="coerce").astype("float64")
        save_fgb(gdf_mtrs, mtrs_output)
        print(f"  Wrote {len(gdf_mtrs)} MTR centerline features ({backfill_count} NASR backfill) to {mtrs_output}")
    else:
        print("  No valid MTR centerline features found, skipping.")

    corridor_rows: list[dict] = []
    corridor_geoms: list[BaseGeometry] = []
    for route_id, items in corridor_segments_by_route.items():
        all_geoms = [g for _, _, g in items]
        centroid = unary_union(all_geoms).centroid
        if not (math.isfinite(centroid.x) and math.isfinite(centroid.y)):
            continue

        aeqd_crs = pyproj.CRS.from_proj4(f"+proj=aeqd +lat_0={centroid.y} +lon_0={centroid.x} +datum=WGS84 +units=m")
        to_aeqd = pyproj.Transformer.from_crs("EPSG:4326", aeqd_crs, always_xy=True)
        to_wgs84 = pyproj.Transformer.from_crs(aeqd_crs, "EPSG:4326", always_xy=True)

        by_width: dict[tuple[float, float], list[LineString]] = defaultdict(list)
        for wl, wr, geom in items:
            proj_geom = _transform_geom(geom, to_aeqd)
            if proj_geom.is_empty:
                continue
            if proj_geom.geom_type == "LineString":
                by_width[(wl, wr)].append(proj_geom)
            elif proj_geom.geom_type == "MultiLineString":
                by_width[(wl, wr)].extend(g for g in proj_geom.geoms if not g.is_empty)

        poly_parts_m: list[BaseGeometry] = []
        for (wl, wr), lines in by_width.items():
            if not lines:
                continue
            merged = linemerge(lines) if len(lines) > 1 else lines[0]
            if wl > 0:
                left_buf = _safe_single_sided_buffer(merged, wl * METERS_PER_NM)
                if left_buf is not None:
                    poly_parts_m.append(left_buf)
            if wr > 0:
                right_buf = _safe_single_sided_buffer(merged, -wr * METERS_PER_NM)
                if right_buf is not None:
                    poly_parts_m.append(right_buf)
            if wl > 0 and wr > 0:
                center_bridge = _extract_polygonal(merged.buffer(1.0, cap_style="flat"))
                if center_bridge is not None:
                    poly_parts_m.append(center_bridge)

        if not poly_parts_m:
            continue

        route_poly_m = _extract_polygonal(unary_union(poly_parts_m))
        if route_poly_m is None:
            continue

        route_poly_4326 = _extract_polygonal(_transform_geom(route_poly_m, to_wgs84))
        if route_poly_4326 is None:
            continue

        corridor_rows.append(route_meta[route_id])
        corridor_geoms.append(route_poly_4326)

    if corridor_rows:
        os.makedirs(os.path.dirname(corridors_output) or ".", exist_ok=True)
        gdf_corridors = gpd.GeoDataFrame(corridor_rows, geometry=corridor_geoms, crs="EPSG:4326")
        save_fgb(gdf_corridors, corridors_output)
        print(f"  Wrote {len(gdf_corridors)} MTR corridor features to {corridors_output}")
    else:
        print("  No valid MTR corridor features found, skipping.")
