"""Cluster USWTDB wind turbines into wind farm polygons enriched with FAA DOF heights."""

import json
import math
import os
from collections import defaultdict

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import pyproj
import shapely
from shapely.geometry import MultiPoint, Point
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.strtree import STRtree

from src.common.utils import save_fgb

CLUSTER_RADIUS_M = 2500.0  # diameter = 5000.0 m
METERS_TO_FEET = 3.28084
DOF_MATCH_DEG_BUFFER = 0.003
MIN_FARM_TURBINES = 3


def _clean_farm_name(raw_name: str) -> str:
    name = raw_name.strip()
    low = name.lower()
    if low == "unknown":
        name = ""
    elif low.startswith("unknown "):
        name = name[8:].strip()
    return name or "Wind Farm"


def _parse_pos_float(val: object) -> float | None:
    if val is None or isinstance(val, bool):
        return None
    try:
        num = float(val)
    except TypeError, ValueError:
        return None
    if not math.isfinite(num) or num <= 0:
        return None
    return num


def _parse_int_val(val: object) -> int | None:
    if val is None or isinstance(val, bool):
        return None
    try:
        if pd.isna(val):
            return None
    except TypeError, ValueError:
        pass
    try:
        num = float(val)
    except TypeError, ValueError:
        return None
    if not math.isfinite(num):
        return None
    return int(round(num))


def _farm_rank(turbines: int) -> int:
    if turbines >= 30:
        return 2
    if turbines >= 10:
        return 3
    return 4


def _transform_geom(geom: BaseGeometry, transformer: pyproj.Transformer) -> BaseGeometry:
    return shapely.transform(
        geom,
        lambda coords: np.column_stack(transformer.transform(coords[:, 0], coords[:, 1])) if len(coords) else coords,
    )


def _build_cluster_polygon_aeqd(pts_m: list[Point]) -> BaseGeometry | None:
    mp = MultiPoint(pts_m)
    if len(pts_m) >= 5:
        try:
            hull = shapely.concave_hull(mp, ratio=0.45)
        except Exception:
            hull = Point()
        if not hull.is_empty and hull.geom_type == "Polygon":
            poly = hull.buffer(300.0, quad_segs=8)
        else:
            poly = mp.convex_hull.buffer(350.0, quad_segs=8)
    else:
        poly = mp.convex_hull.buffer(350.0, quad_segs=8)

    if poly.is_empty:
        return None
    if not poly.is_valid:
        poly = shapely.make_valid(poly)
    if poly.is_empty or poly.geom_type not in ("Polygon", "MultiPolygon"):
        return None
    return poly


def _cluster_points_aeqd(
    lon_lats: list[tuple[float, float]],
) -> list[tuple[list[int], BaseGeometry]]:
    """Project (lon, lat) points to local AEQD, cluster at 5000 m, and return (indices, WGS84 polygon)."""
    if len(lon_lats) < MIN_FARM_TURBINES:
        return []

    mean_lon = sum(lon for lon, _ in lon_lats) / len(lon_lats)
    mean_lat = sum(lat for _, lat in lon_lats) / len(lon_lats)
    aeqd_crs = pyproj.CRS.from_proj4(f"+proj=aeqd +lat_0={mean_lat} +lon_0={mean_lon} +datum=WGS84 +units=m")
    to_aeqd = pyproj.Transformer.from_crs("EPSG:4326", aeqd_crs, always_xy=True)
    to_wgs84 = pyproj.Transformer.from_crs(aeqd_crs, "EPSG:4326", always_xy=True)

    xs, ys = to_aeqd.transform([lon for lon, _ in lon_lats], [lat for _, lat in lon_lats])
    pts_m = [Point(float(x), float(y)) for x, y in zip(xs, ys)]

    disks = unary_union([pt.buffer(CLUSTER_RADIUS_M, quad_segs=8) for pt in pts_m])
    if disks.is_empty:
        return []
    components = [disks] if disks.geom_type == "Polygon" else [g for g in disks.geoms if g.geom_type == "Polygon"]
    if not components:
        return []

    comp_tree = STRtree(components)
    pt_idxs, comp_idxs = comp_tree.query(pts_m, predicate="within")
    by_comp: dict[int, list[int]] = defaultdict(list)
    for pi, ci in zip(pt_idxs, comp_idxs):
        by_comp[int(ci)].append(int(pi))

    results: list[tuple[list[int], BaseGeometry]] = []
    for idxs in by_comp.values():
        if len(idxs) < MIN_FARM_TURBINES:
            continue
        poly_m = _build_cluster_polygon_aeqd([pts_m[i] for i in idxs])
        if poly_m is None:
            continue
        poly_4326 = _transform_geom(poly_m, to_wgs84)
        if not poly_4326.is_valid:
            poly_4326 = shapely.make_valid(poly_4326)
        if poly_4326.is_empty or poly_4326.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        results.append((idxs, poly_4326))

    return results


def convert_wind_farms(
    raw_path: str = "data/uswtdb_raw.geojson",
    obstacles_path: str = "data/obstacles.fgb",
    output: str = "data/wind_farms.fgb",
) -> None:
    """Convert USWTDB turbines into wind farm polygons enriched with FAA DOF WINDMILL heights."""
    if not os.path.exists(raw_path):
        print(f"  USWTDB file not found at {raw_path}")
        return

    with open(raw_path) as f:
        data = json.load(f)
    uswtdb_raw_features = data.get("features") or [] if isinstance(data, dict) else []
    if not uswtdb_raw_features:
        print("  No USWTDB wind turbine features found, skipping.")
        return

    dof_pts: list[Point] = []
    dof_amsl: list[int | None] = []
    dof_agl: list[int | None] = []
    if os.path.exists(obstacles_path):
        dof_df = pyogrio.read_dataframe(obstacles_path, where="type = 'WINDMILL'")
        if not dof_df.empty:
            has_amsl = "amsl" in dof_df.columns
            has_agl = "agl" in dof_df.columns
            amsl_vals = dof_df["amsl"].tolist() if has_amsl else [None] * len(dof_df)
            agl_vals = dof_df["agl"].tolist() if has_agl else [None] * len(dof_df)
            for geom, amsl_v, agl_v in zip(dof_df.geometry, amsl_vals, agl_vals):
                if geom is None or geom.is_empty:
                    continue
                pt = geom if geom.geom_type == "Point" else geom.representative_point()
                if not (math.isfinite(pt.x) and math.isfinite(pt.y)):
                    continue
                if not (-90.0 <= pt.y <= 90.0 and -180.0 <= pt.x <= 180.0):
                    continue
                dof_pts.append(pt)
                dof_amsl.append(_parse_int_val(amsl_v))
                dof_agl.append(_parse_int_val(agl_v))

    print("Processing Wind Farms...")
    grouped_uswtdb: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for ft in uswtdb_raw_features:
        props = ft.get("properties") or {}
        geom = ft.get("geometry") or {}
        if geom.get("type") != "Point":
            continue
        coords = geom.get("coordinates")
        if not coords or len(coords) < 2:
            continue

        p_name = str(props.get("p_name") or "").strip()
        if not p_name:
            continue

        try:
            lon = float(coords[0])
            lat = float(coords[1])
        except TypeError, ValueError:
            continue
        if not (math.isfinite(lon) and math.isfinite(lat)):
            continue
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            continue

        state = str(props.get("t_state") or "").strip().upper()
        grouped_uswtdb[(p_name, state)].append(
            {
                "lon": lon,
                "lat": lat,
                "t_cap": _parse_pos_float(props.get("t_cap")),
                "t_ttlh": _parse_pos_float(props.get("t_ttlh")),
            }
        )

    dof_tree = STRtree(dof_pts) if dof_pts else None
    farm_rows: list[dict] = []
    farm_geoms: list[BaseGeometry] = []

    for (p_name, state), items in grouped_uswtdb.items():
        if len(items) < MIN_FARM_TURBINES:
            continue
        lon_lats = [(item["lon"], item["lat"]) for item in items]
        clusters = _cluster_points_aeqd(lon_lats)
        display_name = _clean_farm_name(p_name)

        for idxs, poly_4326 in clusters:
            turbines = len(idxs)
            t_caps = [items[i]["t_cap"] for i in idxs if items[i]["t_cap"] is not None]
            capacity_mw: float | None = round(sum(t_caps) / 1000.0, 1) if t_caps else None

            ttlh_vals = [items[i]["t_ttlh"] for i in idxs if items[i]["t_ttlh"] is not None]
            max_tip_ft = round(max(ttlh_vals) * METERS_TO_FEET) if ttlh_vals else None

            max_amsl_ft: int | None = None
            max_agl_ft: int | None = None
            if dof_tree is not None:
                hit_indices = dof_tree.query(poly_4326.buffer(DOF_MATCH_DEG_BUFFER), predicate="intersects")
                if len(hit_indices):
                    matched_amsl = [dof_amsl[int(idx)] for idx in hit_indices if dof_amsl[int(idx)] is not None]
                    matched_agl = [dof_agl[int(idx)] for idx in hit_indices if dof_agl[int(idx)] is not None]
                    if matched_amsl:
                        max_amsl_ft = max(matched_amsl)
                    if matched_agl:
                        max_agl_ft = max(matched_agl)

            farm_rows.append(
                {
                    "name": display_name,
                    "state": state,
                    "turbines": turbines,
                    "capacity_mw": capacity_mw,
                    "max_amsl_ft": max_amsl_ft,
                    "max_agl_ft": max_agl_ft,
                    "max_tip_ft": max_tip_ft,
                    "source": "uswtdb",
                    "rank": _farm_rank(turbines),
                }
            )
            farm_geoms.append(poly_4326)

    if not farm_rows:
        print("  No valid wind farm clusters found, skipping.")
        return

    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    gdf = gpd.GeoDataFrame(farm_rows, geometry=farm_geoms, crs="EPSG:4326")
    gdf["turbines"] = pd.array([r["turbines"] for r in farm_rows], dtype="int64")
    gdf["capacity_mw"] = pd.to_numeric([r["capacity_mw"] for r in farm_rows], errors="coerce").astype("float64")
    gdf["max_amsl_ft"] = pd.array([r["max_amsl_ft"] for r in farm_rows], dtype="Int64")
    gdf["max_agl_ft"] = pd.array([r["max_agl_ft"] for r in farm_rows], dtype="Int64")
    gdf["max_tip_ft"] = pd.array([r["max_tip_ft"] for r in farm_rows], dtype="Int64")
    gdf["rank"] = pd.array([r["rank"] for r in farm_rows], dtype="int64")

    save_fgb(gdf, output)
    print(f"  Wrote {len(gdf)} USWTDB wind farm features to {output}")
