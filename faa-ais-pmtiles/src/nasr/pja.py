"""
Parse and convert FAA NASR Parachute Jump Areas (PJA) to FlatGeobuf.

Parses rows from NASR `PJA_BASE.csv` into GeoJSON Point features and buffers each
point into a geodesic circle polygon using a local Azimuthal Equidistant (AEQD)
projection centered on the drop zone coordinates.
"""

import csv
import io
import json
import math
import os
from collections.abc import Iterable

import geojson
import pyproj
from shapely.geometry import Point, mapping
from shapely.ops import transform

from src.common.utils import save_fgb

DEFAULT_PJA_RADIUS_NM = 1.5
METERS_PER_NM = 1852.0


def _parse_radius_nm(value: object) -> float:
    """Parse a PJA radius in nautical miles, defaulting invalid or non-positive values to 1.5 NM."""
    if value is None or isinstance(value, bool):
        return DEFAULT_PJA_RADIUS_NM

    text = str(value).strip()
    if not text:
        return DEFAULT_PJA_RADIUS_NM

    try:
        radius = float(text)
    except ValueError:
        return DEFAULT_PJA_RADIUS_NM

    if not math.isfinite(radius) or radius <= 0:
        return DEFAULT_PJA_RADIUS_NM
    return radius


def normalize_pja_max_alt(max_altitude: str | None, alt_type_code: str | None) -> str:
    """Normalize PJA maximum altitude from MAX_ALTITUDE and MAX_ALTITUDE_TYPE_CODE."""
    alt = (max_altitude or "").strip()
    code = (alt_type_code or "").strip().upper()

    if code == "UNR" and not alt:
        return "UNL"
    if not alt:
        return ""
    if code in ("MSL", ""):
        return alt
    return f"{alt} {code}"


def parse_pja_csv(csv_file: Iterable[str] | str | os.PathLike[str]) -> list[geojson.Feature]:
    """Parse NASR `PJA_BASE.csv` rows into GeoJSON Point features."""
    should_close = False
    stream: Iterable[str]

    if isinstance(csv_file, os.PathLike):
        stream = open(csv_file, encoding="utf-8", errors="replace")
        should_close = True
    elif isinstance(csv_file, str):
        if "\n" not in csv_file and os.path.exists(csv_file):
            stream = open(csv_file, encoding="utf-8", errors="replace")
            should_close = True
        else:
            stream = io.StringIO(csv_file)
    else:
        stream = csv_file

    features: list[geojson.Feature] = []
    try:
        reader = csv.DictReader(stream)
        for row in reader:
            lat_raw = (row.get("LAT_DECIMAL") or "").strip()
            lon_raw = (row.get("LONG_DECIMAL") or "").strip()
            if not lat_raw or not lon_raw:
                continue

            try:
                lat = float(lat_raw)
                lon = float(lon_raw)
            except ValueError:
                continue

            if not (math.isfinite(lat) and math.isfinite(lon)):
                continue
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue

            radius_nm = _parse_radius_nm(row.get("PJA_RADIUS"))
            max_alt = normalize_pja_max_alt(row.get("MAX_ALTITUDE"), row.get("MAX_ALTITUDE_TYPE_CODE"))
            name = (row.get("DROP_ZONE_NAME") or row.get("CITY") or row.get("ARPT_ID") or "").strip()

            features.append(
                geojson.Feature(
                    geometry=geojson.Point((lon, lat)),
                    properties={
                        "ident": (row.get("PJA_ID") or "").strip(),
                        "name": name,
                        "arpt_id": (row.get("ARPT_ID") or "").strip(),
                        "city": (row.get("CITY") or "").strip(),
                        "radius_nm": radius_nm,
                        "max_alt": max_alt,
                        "time_of_use": (row.get("TIME_OF_USE") or "").strip(),
                        "use": (row.get("PJA_USE") or "").strip(),
                        "rank": 5,
                    },
                )
            )
    finally:
        if should_close and hasattr(stream, "close"):
            stream.close()

    return features


def convert_pja(
    raw_path: str = "data/pja_raw.geojson",
    output: str = "data/parachute_areas.fgb",
) -> None:
    """Convert raw PJA Point GeoJSON into geodesic polygon circles in FlatGeobuf."""
    if not os.path.exists(raw_path):
        print(f"  PJA file not found at {raw_path}")
        return

    print("Processing Parachute Jump Areas (PJA)...")
    with open(raw_path) as f:
        data = json.load(f)

    raw_features = data.get("features", [])
    if not raw_features:
        print("  No PJA features found, skipping.")
        return

    features: list[geojson.Feature] = []
    for ft in raw_features:
        geom = ft.get("geometry")
        if not geom or geom.get("type") != "Point":
            continue

        coords = geom.get("coordinates")
        if not coords or len(coords) < 2:
            continue

        try:
            lon = float(coords[0])
            lat = float(coords[1])
        except TypeError, ValueError:
            continue

        if not (math.isfinite(lat) and math.isfinite(lon)):
            continue
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            continue

        raw_props = dict(ft.get("properties") or {})
        radius_nm = _parse_radius_nm(raw_props.get("radius_nm"))
        raw_props["radius_nm"] = radius_nm
        raw_props.setdefault("rank", 5)

        aeqd_crs = pyproj.CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m")
        transformer = pyproj.Transformer.from_crs(aeqd_crs, "EPSG:4326", always_xy=True)
        local_circle = Point(0, 0).buffer(radius_nm * METERS_PER_NM, quad_segs=16)
        polygon = transform(transformer.transform, local_circle)

        features.append(geojson.Feature(geometry=mapping(polygon), properties=raw_props))

    if not features:
        print("  No valid PJA features to convert, skipping.")
        return

    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    save_fgb(features, output)
    print(f"  Wrote {len(features)} PJA features to {output}")
