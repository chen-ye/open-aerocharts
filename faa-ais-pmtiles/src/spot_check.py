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

def check_feature_in_tile(tile_json, layer_name, property_name, expected_value):
    if not tile_json:
        return False
    try:
        data = json.loads(tile_json)
        # tippecanoe-decode returns a FeatureCollection containing FeatureCollections for each layer
        for layer_collection in data.get("features", []):
            current_layer = layer_collection.get("properties", {}).get("layer")
            if current_layer == layer_name:
                for feature in layer_collection.get("features", []):
                    if feature.get("properties", {}).get(property_name) == expected_value:
                        return True
    except json.JSONDecodeError:
        pass
    return False

def main():
    # Paths are relative to faa-ais-pmtiles root
    output_dir = "output"

    checks = [
        {
            "name": "KSJC in airports_navaids at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8, "x": 41, "y": 99,
            "layer": "airports",
            "prop": "id",
            "value": "KSJC"
        },
        {
            "name": "KSFO in airports_navaids at Z8",
            "file": "airports_navaids.pmtiles",
            "z": 8, "x": 40, "y": 99,
            "layer": "airports",
            "prop": "id",
            "value": "KSFO"
        },
        {
            "name": "V230 airway in enroute at Z8",
            "file": "enroute.pmtiles",
            "z": 8, "x": 41, "y": 99,
            "layer": "airways",
            "prop": "airway",
            "value": "V230"
        },
        {
            "name": "Obstacles in waypoints_obstacles at Z10",
            "file": "waypoints_obstacles.pmtiles",
            "z": 10, "x": 165, "y": 397,
            "layer": "obstacles",
            "prop": "type",
            "value": "T-L TWR"
        },
        {
            "name": "Waypoint VINCO in waypoints_obstacles at Z10",
            "file": "waypoints_obstacles.pmtiles",
            "z": 10, "x": 165, "y": 397,
            "layer": "waypoints",
            "prop": "id",
            "value": "VINCO"
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
        if check_feature_in_tile(tile_json, check["layer"], check["prop"], check["value"]):
            print(f"PASSED: {check['name']}")
        else:
            print(f"FAILED: {check['name']} - Feature not found in tile {check['z']}/{check['x']}/{check['y']}")
            failed = True

    if failed:
        sys.exit(1)
    else:
        print("\nAll spot checks passed!")

if __name__ == "__main__":
    main()
