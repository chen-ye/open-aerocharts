"""Convert HIFLD high-voltage transmission lines to tippecanoe-ready GeoJSON."""

import json
import math
import os

import shapely
from shapely.geometry import mapping, shape


def convert_powerlines(
    raw_path: str = "data/powerlines_raw.geojson",
    output: str = "data/powerlines.geojson",
) -> None:
    """Filter and convert HIFLD powerlines to GeoJSON with per-feature tippecanoe minzoom."""
    if not os.path.exists(raw_path):
        print(f"  Powerlines file not found at {raw_path}")
        return

    print("Processing High-Voltage Powerlines...")
    with open(raw_path) as f:
        data = json.load(f)

    raw_features = data.get("features") or []
    if not raw_features:
        print("  No powerline features found, skipping.")
        return

    features: list[dict] = []
    for ft in raw_features:
        raw = ft.get("properties") or {}
        status = str(raw.get("STATUS") or "").strip().upper()
        if status in {"INACTIVE", "PROPOSED"}:
            continue

        line_type = str(raw.get("TYPE") or "").strip().upper()
        if "UNDERGROUND" in line_type:
            continue

        voltage_raw = raw.get("VOLTAGE")
        if voltage_raw is None or isinstance(voltage_raw, bool):
            continue
        try:
            voltage_val = float(voltage_raw)
        except TypeError, ValueError:
            continue
        if not math.isfinite(voltage_val) or voltage_val < 115:
            continue

        geom_dict = ft.get("geometry")
        if not geom_dict:
            continue
        try:
            geom = shapely.force_2d(shape(geom_dict))
        except Exception:
            continue
        if geom.is_empty or not geom.is_valid or geom.geom_type not in ("LineString", "MultiLineString"):
            continue

        voltage_kv = int(round(voltage_val))
        if voltage_kv < 115:
            continue

        if voltage_kv >= 345:
            rank = 2
            minzoom = 6
        elif voltage_kv >= 230:
            rank = 3
            minzoom = 7
        else:
            rank = 4
            minzoom = 9

        features.append(
            {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "voltage_kv": voltage_kv,
                    "volt_class": str(raw.get("VOLT_CLASS") or "").strip(),
                    "owner": str(raw.get("OWNER") or "").strip(),
                    "rank": rank,
                },
                "tippecanoe": {"minzoom": minzoom},
            }
        )

    if not features:
        print("  No valid overhead >= 115 kV powerline features found, skipping.")
        return

    features.sort(key=lambda feat: feat["properties"]["rank"])
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    with open(output, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)

    print(f"  Wrote {len(features)} powerline features to {output}")
