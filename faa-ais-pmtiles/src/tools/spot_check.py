"""
Performs automated quality assurance checks on generated PMTiles.

Decodes specific tiles at given zoom levels to verify the presence and properties
of key features (e.g., major airports, specific waypoints).
"""

import json
import os
import subprocess
import sys


def run_decode(pmtiles_path, z, x, y):
    cmd = f"tippecanoe-decode {pmtiles_path} {z} {x} {y}"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    return result.stdout


def check_feature_in_tile(tile_json, layer_name, matches):
    """
    Check if a feature exists in the tile that matches all provided property criteria.
    matches is a dict { "prop_name": "expected_value" }
    """
    if not tile_json:
        return False
    try:
        data = json.loads(tile_json)
        # tippecanoe-decode returns a FeatureCollection containing FeatureCollections for each layer
        for layer_collection in data.get("features", []):
            current_layer = layer_collection.get("properties", {}).get("layer")
            if current_layer == layer_name:
                for feature in layer_collection.get("features", []):
                    props = feature.get("properties", {})
                    # Check if all key-value pairs in 'matches' are present in feature properties
                    if all(props.get(k) == v for k, v in matches.items()):
                        return True
    except json.JSONDecodeError:
        pass
    return False


def main():
    # Paths are relative to faa-ais-pmtiles root
    output_dir = "output"

    checks = [
        {
            "name": "Rank 1 Check: KSFO at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8,
            "x": 40,
            "y": 99,
            "layer": "airports",
            "matches": {"id": "KSFO", "rank": 1},
        },
        {
            "name": "Rank 1 Check: KATL at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8,
            "x": 67,
            "y": 102,
            "layer": "airports",
            "matches": {"id": "KATL", "rank": 1},
        },
        {
            "name": "Rank 2 Check: KMER at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8,
            "x": 42,
            "y": 99,
            "layer": "airports",
            "matches": {"id": "KMER", "rank": 2},
        },
        {
            "name": "KSJC in airports_navaids at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8,
            "x": 41,
            "y": 99,
            "layer": "airports",
            "matches": {"id": "KSJC"},
        },
        {
            "name": "V230 airway in enroute at Z8",
            "file": "enroute.pmtiles",
            "z": 8,
            "x": 41,
            "y": 99,
            "layer": "airways",
            "matches": {"airway": "V230"},
        },
        {
            "name": "Obstacles in waypoints_obstacles at Z10",
            "file": "waypoints_obstacles.pmtiles",
            "z": 10,
            "x": 165,
            "y": 397,
            "layer": "obstacles",
            "matches": {"type": "T-L TWR"},
        },
        {
            "name": "Waypoint VINCO in waypoints_obstacles at Z10",
            "file": "waypoints_obstacles.pmtiles",
            "z": 10,
            "x": 165,
            "y": 397,
            "layer": "waypoints",
            "matches": {"id": "VINCO"},
        },
        {
            "name": "Heliport KJRA in airports_navaids at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8,
            "x": 75,
            "y": 96,
            "layer": "airports",
            "matches": {"id": "KJRA", "facility_type": "heliport"},
        },
        {
            "name": "Gliderport CA69 in airports_navaids at Z10",
            "file": "airports_navaids.pmtiles",
            "z": 10,
            "x": 170,
            "y": 402,
            "layer": "airports",
            "matches": {"id": "CA69", "facility_type": "gliderport"},
        },
        {
            "name": "Ultralight 0CL8 in airports_navaids at Z10",
            "file": "airports_navaids.pmtiles",
            "z": 10,
            "x": 177,
            "y": 403,
            "layer": "airports",
            "matches": {"id": "0CL8", "facility_type": "ultralight"},
        },
        {
            "name": "Grid MORA N36W119 in enroute at Z6",
            "file": "enroute.pmtiles",
            "z": 6,
            "x": 10,
            "y": 25,
            "layer": "grid_mora_labels",
            "matches": {"cell_id": "N36W119", "mora_ft": "16800", "thousands": "16", "hundreds": "8", "is_high": True},
        },
        {
            "name": "VFR Waypoint VPAAQ in vfr at Z8",
            "file": "vfr.pmtiles",
            "z": 8,
            "x": 40,
            "y": 99,
            "layer": "vfr_waypoints",
            "matches": {"id": "VPAAQ", "type": "vfr"},
        },
        {
            "name": "NASR-backfilled MTR VR1257 in vfr at Z8",
            "file": "vfr.pmtiles",
            "z": 8,
            "x": 41,
            "y": 100,
            "layer": "mtrs",
            "matches": {"route_id": "VR1257", "mtr_type": "VR", "source": "nasr"},
        },
        {
            "name": "ADDS MTR IR207 in vfr at Z8",
            "file": "vfr.pmtiles",
            "z": 8,
            "x": 41,
            "y": 99,
            "layer": "mtrs",
            "matches": {"route_id": "IR207", "mtr_type": "IR"},
        },
        {
            "name": "Mountain Pass Altamont Pass in vfr at Z7",
            "file": "vfr.pmtiles",
            "z": 7,
            "x": 20,
            "y": 49,
            "layer": "mountain_passes",
            "matches": {"name": "Altamont Pass"},
        },
        {
            "name": "Wind Farm Golden Hills in vfr at Z8",
            "file": "vfr.pmtiles",
            "z": 8,
            "x": 41,
            "y": 99,
            "layer": "wind_farms",
            "matches": {"name": "Golden Hills", "source": "uswtdb"},
        },
        {
            "name": "Powerline 500 kV in vfr at Z8",
            "file": "vfr.pmtiles",
            "z": 8,
            "x": 41,
            "y": 99,
            "layer": "powerlines",
            "matches": {"voltage_kv": 500},
        },
        {
            "name": "VFR Waypoint VPAAQ excluded from IFR waypoints at Z10",
            "file": "waypoints_obstacles.pmtiles",
            "z": 10,
            "x": 163,
            "y": 396,
            "layer": "waypoints",
            "matches": {"id": "VPAAQ"},
            "expect_absent": True,
        },
        {
            "name": "IFR NRS Waypoint KL12G preserved in waypoints at Z10",
            "file": "waypoints_obstacles.pmtiles",
            "z": 10,
            "x": 170,
            "y": 415,
            "layer": "waypoints",
            "matches": {"id": "KL12G", "type": "named"},
        },
    ]

    failed = False
    for check in checks:
        path = os.path.join(output_dir, check["file"])
        if not os.path.exists(path):
            print(f"FAILED: {check['name']} - File not found: {path}")
            failed = True
            continue

        tile_json = run_decode(path, check["z"], check["x"], check["y"])
        found = check_feature_in_tile(tile_json, check["layer"], check["matches"])
        expect_absent = bool(check.get("expect_absent", False))
        if (not expect_absent and found) or (expect_absent and not found):
            print(f"PASSED: {check['name']}")
        else:
            status_word = "unexpectedly found" if expect_absent else "not found"
            print(
                f"FAILED: {check['name']} - Feature matching {check['matches']} "
                f"{status_word} in tile {check['z']}/{check['x']}/{check['y']}"
            )
            failed = True

    if failed:
        sys.exit(1)
    else:
        print("\nAll spot checks passed!")


if __name__ == "__main__":
    main()
