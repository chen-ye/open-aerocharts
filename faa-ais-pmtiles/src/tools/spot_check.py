"""
Performs automated quality assurance checks on generated PMTiles.

Decodes specific tiles at given zoom levels to verify the presence and properties
of key features (e.g., major airports, specific waypoints).
"""

import subprocess
import json
import sys
import os

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
            "z": 8, "x": 40, "y": 99,
            "layer": "airports",
            "matches": {"id": "KSFO", "rank": 1}
        },
        {
            "name": "Rank 1 Check: KATL at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8, "x": 67, "y": 102,
            "layer": "airports",
            "matches": {"id": "KATL", "rank": 1}
        },
        {
            "name": "Rank 2 Check: KMER at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8, "x": 42, "y": 99,
            "layer": "airports",
            "matches": {"id": "KMER", "rank": 2}
        },
        {
            "name": "KSJC in airports_navaids at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8, "x": 41, "y": 99,
            "layer": "airports",
            "matches": {"id": "KSJC"}
        },
        {
            "name": "V230 airway in enroute at Z8",
            "file": "enroute.pmtiles",
            "z": 8, "x": 41, "y": 99,
            "layer": "airways",
            "matches": {"airway": "V230"}
        },
        {
            "name": "Obstacles in waypoints_obstacles at Z10",
            "file": "waypoints_obstacles.pmtiles",
            "z": 10, "x": 165, "y": 397,
            "layer": "obstacles",
            "matches": {"type": "T-L TWR"}
        },
        {
            "name": "Waypoint VINCO in waypoints_obstacles at Z10",
            "file": "waypoints_obstacles.pmtiles",
            "z": 10, "x": 165, "y": 397,
            "layer": "waypoints",
            "matches": {"id": "VINCO"}
        }
    ]

    failed = False
    for check in checks:
        path = os.path.join(output_dir, check["file"])
        if not os.path.exists(path):
            print(f"FAILED: {check['name']} - File not found: {path}")
            failed = True
            continue

        tile_json = run_decode(path, check["z"], check["x"], check["y"])
        if check_feature_in_tile(tile_json, check["layer"], check["matches"]):
            print(f"PASSED: {check['name']}")
        else:
            print(f"FAILED: {check['name']} - Feature matching {check['matches']} not found in tile {check['z']}/{check['x']}/{check['y']}")
            failed = True

    if failed:
        sys.exit(1)
    else:
        print("\nAll spot checks passed!")

if __name__ == "__main__":
    main()
