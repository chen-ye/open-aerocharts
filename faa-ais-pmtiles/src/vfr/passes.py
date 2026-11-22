"""Convert OSM mountain pass data to FlatGeobuf."""

import json
import math
import os
from collections import defaultdict

import geopandas as gpd
import pandas as pd
import shapely
from shapely.geometry import Point, shape

from src.common.utils import save_fgb

METERS_TO_FEET = 3.28084
DEDUP_DEG_TOLERANCE = 0.003


def parse_elevation_ft(ele_raw: object) -> int | None:
    """Parse an OSM elevation value into integer feet MSL, or None if invalid/out of range."""
    if ele_raw is None or isinstance(ele_raw, bool):
        return None

    if isinstance(ele_raw, (int, float)):
        val = float(ele_raw)
        if not math.isfinite(val):
            return None
        elev_ft = round(val * METERS_TO_FEET)
        return elev_ft if -300 <= elev_ft <= 25000 else None

    text = str(ele_raw).strip()
    if not text:
        return None

    for part in text.split(";"):
        token = part.strip().replace(",", "")
        if not token:
            continue
        low = token.lower()
        is_feet = False
        if low.endswith("feet"):
            num_str = token[:-4].strip()
            is_feet = True
        elif low.endswith("ft"):
            num_str = token[:-2].strip()
            is_feet = True
        elif low.endswith("'"):
            num_str = token[:-1].strip()
            is_feet = True
        elif low.endswith("meters"):
            num_str = token[:-6].strip()
        elif low.endswith("meter"):
            num_str = token[:-5].strip()
        elif low.endswith("m"):
            num_str = token[:-1].strip()
        else:
            num_str = token

        try:
            val = float(num_str)
        except ValueError:
            continue
        if not math.isfinite(val):
            continue

        elev_ft = round(val) if is_feet else round(val * METERS_TO_FEET)
        if -300 <= elev_ft <= 25000:
            return elev_ft

    return None


def _extract_point_coords(geom_obj: object) -> tuple[float, float] | None:
    if geom_obj is None:
        return None
    try:
        if isinstance(geom_obj, str):
            geom = shapely.from_wkt(geom_obj)
        elif isinstance(geom_obj, dict):
            if geom_obj.get("type") == "Point":
                coords = geom_obj.get("coordinates")
                if not coords or len(coords) < 2:
                    return None
                lon = float(coords[0])
                lat = float(coords[1])
                if math.isfinite(lon) and math.isfinite(lat) and -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
                    return lon, lat
                return None
            geom = shape(geom_obj)
        else:
            return None
    except Exception:
        return None

    if geom.is_empty:
        return None
    pt = geom if geom.geom_type == "Point" else geom.representative_point()
    lon = float(pt.x)
    lat = float(pt.y)
    if not (math.isfinite(lon) and math.isfinite(lat)):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    return lon, lat


def convert_passes(
    raw_path: str = "data/passes_raw.geojson",
    output: str = "data/mountain_passes.fgb",
) -> None:
    """Convert raw mountain pass GeoJSON or QLever SPARQL JSON into deduplicated FlatGeobuf."""
    if not os.path.exists(raw_path):
        print(f"  Mountain passes file not found at {raw_path}")
        return

    print("Processing Mountain Passes...")
    with open(raw_path) as f:
        data = json.load(f)

    records: list[tuple[float, float, str, object, str]] = []
    if isinstance(data, dict) and isinstance((data.get("results") or {}).get("bindings"), list):
        for row in data["results"]["bindings"]:
            coords = _extract_point_coords((row.get("geom") or {}).get("value"))
            if coords is None:
                continue
            name = ((row.get("name") or {}).get("value") or "").strip()
            ele = (row.get("ele") or {}).get("value")
            records.append((coords[0], coords[1], name, ele, "osm"))
    elif isinstance(data, dict):
        for ft in data.get("features") or []:
            coords = _extract_point_coords(ft.get("geometry"))
            if coords is None:
                continue
            props = ft.get("properties") or {}
            name = str(props.get("name") or "").strip()
            ele = props.get("ele")
            source = str(props.get("source") or "osm").strip().lower() or "osm"
            records.append((coords[0], coords[1], name, ele, source))

    dedup_by_name: dict[str, list[dict]] = defaultdict(list)
    for lon, lat, name, ele_raw, source in records:
        elev_ft = parse_elevation_ft(ele_raw)
        if not name:
            continue

        name_key = name.lower()
        existing_list = dedup_by_name[name_key]
        matched_idx: int | None = None
        for idx, ex in enumerate(existing_list):
            if math.hypot(lon - ex["lon"], lat - ex["lat"]) <= DEDUP_DEG_TOLERANCE:
                matched_idx = idx
                break

        candidate = {
            "lon": lon,
            "lat": lat,
            "name": name,
            "elev_ft": elev_ft,
            "source": source,
        }
        if matched_idx is None:
            existing_list.append(candidate)
        elif existing_list[matched_idx]["elev_ft"] is None and elev_ft is not None:
            existing_list[matched_idx] = candidate

    rows: list[dict] = []
    geoms: list[Point] = []
    for entries in dedup_by_name.values():
        for entry in entries:
            elev_ft = entry["elev_ft"]
            rows.append(
                {
                    "name": entry["name"],
                    "elev_ft": elev_ft,
                    "source": entry["source"],
                    "rank": 3 if elev_ft is not None else 4,
                }
            )
            geoms.append(Point(entry["lon"], entry["lat"]))

    if not rows:
        print("  No valid mountain pass features found, skipping.")
        return

    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:4326")
    gdf["elev_ft"] = pd.array([r["elev_ft"] for r in rows], dtype="Int64")
    save_fgb(gdf, output)
    print(f"  Wrote {len(gdf)} mountain pass features to {output}")
