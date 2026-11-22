"""
Orchestrates the entire PMTiles build pipeline.

Coordinates the fetching of raw data (CIFP, ADDS, NASR), conversion to intermediate
formats (FlatGeobuf/GeoJSON), and the compilation of final PMTiles archives using `tippecanoe`.
"""

import argparse
import concurrent.futures
import json
import os
import subprocess
import sys

from src.adds import convert as shp_to_fgb
from src.adds import fetch as fetch_airspace_shp
from src.cifp import convert as cifp_to_fgb
from src.cifp import fetch as fetch_cifp
from src.nasr import fetch as fetch_nasr
from src.nasr import pja
from src.runways.merge import merge_runways
from src.search import build_index
from src.vfr import fetch as fetch_vfr
from src.vfr import mtr as vfr_mtr
from src.vfr import passes as vfr_passes
from src.vfr import powerlines as vfr_powerlines
from src.vfr import wind_farms as vfr_wind_farms

# Each PMTiles file is served directly to the frontend — no tile-join needed.
# This allows each file to use its own optimal zoom range.
PMTILES_FILES = [
    "airspaces",
    "enroute",
    "boundary",
    "airports_navaids",
    "waypoints_obstacles",
    "airport_diagrams",
    "vfr",
]


def run_cmd(cmd):
    print(f"Running: {cmd}")
    subprocess.run(cmd, shell=True, check=True)


def fetch_nasr_wrapper():
    # Fetch NASR metadata (caching is handled within fetch_nasr.py)
    fetch_nasr.get_airport_metadata()


def main():
    parser = argparse.ArgumentParser(description="Build aeronautical PMTiles archives.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force rebuild even when output/metadata.json already matches the latest CIFP cycle.",
    )
    args = parser.parse_args()

    print("Step 1: Checking for new cycle...")

    # Check if a new cycle is available without downloading anything yet
    cycle, is_new, download_url, zip_path = fetch_cifp.check_latest_cycle()

    if cycle is None:
        if args.force and os.path.exists("FAACIFP18") and os.path.exists("output/metadata.json"):
            with open("output/metadata.json") as f:
                cycle = json.load(f).get("cycle", "unknown")
            print(f"Could not reach FAA CIFP listing; forcing local rebuild for cycle {cycle}.")
        else:
            print("No CIFP zip files found, aborting build.")
            sys.exit(1)

    print(f"Current cycle identified as: {cycle}")
    if not is_new and not args.force:
        print(f"Cycle {cycle} is already the latest. Short-circuiting build pipeline.")
        return

    print("Step 1.5: Fetching data concurrently...")
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = []
        if is_new or not os.path.exists("FAACIFP18"):
            futures.append(executor.submit(fetch_cifp.download_cifp, download_url, zip_path))
        else:
            print("FAACIFP18 already present for current cycle; skipping CIFP download.")
        futures.append(executor.submit(fetch_airspace_shp.main))
        futures.append(executor.submit(fetch_nasr_wrapper))
        futures.append(executor.submit(fetch_vfr.main))
        concurrent.futures.wait(futures)
        for future in futures:
            future.result()

    if not os.path.exists("FAACIFP18"):
        print("Error: FAACIFP18 not found after fetching.")
        return

    print("Step 2: Parsing and converting to FlatGeobuf concurrently...")
    with concurrent.futures.ProcessPoolExecutor() as executor:
        futures = [
            executor.submit(shp_to_fgb.main),
            executor.submit(cifp_to_fgb.build_pmtiles_fgb, "FAACIFP18"),
            executor.submit(pja.convert_pja),
            executor.submit(vfr_mtr.convert_mtrs),
            executor.submit(vfr_passes.convert_passes),
            executor.submit(vfr_powerlines.convert_powerlines),
            executor.submit(build_index.build_search_index, "FAACIFP18"),
        ]
        concurrent.futures.wait(futures)
        for future in futures:
            future.result()

    print("Step 2.5: Merging Runways and Clustering Wind Farms...")
    merge_runways()
    vfr_wind_farms.convert_wind_farms()

    print("Step 3: Compiling into PMTiles with tippecanoe concurrently...")
    os.makedirs("output", exist_ok=True)

    cmd_airspaces = (
        "uv run tippecanoe -Z0 -z8 -o output/airspaces.pmtiles "
        "--no-feature-limit --no-tile-size-limit --buffer=25 --no-clipping -f "
        "-l airspaces data/airspaces.fgb"
    )
    enroute_layers = [
        "-L airways:data/airways.fgb",
        "-L airspaces:data/airspaces_e.fgb",
    ]
    if os.path.exists("data/grid_mora_lines.fgb"):
        enroute_layers.append("-L grid_mora_lines:data/grid_mora_lines.fgb")
    if os.path.exists("data/grid_mora_labels.fgb"):
        enroute_layers.append("-L grid_mora_labels:data/grid_mora_labels.fgb")

    cmd_enroute = "uv run tippecanoe -Z0 -z8 -r1 -o output/enroute.pmtiles --no-feature-limit --no-tile-size-limit -f " + " ".join(
        enroute_layers
    )
    cmd_boundary = (
        "uv run tippecanoe -Z0 -z8 -o output/boundary.pmtiles "
        "--no-feature-limit --no-tile-size-limit -f "
        "-l boundary_airspace data/boundary_airspace.fgb"
    )
    cmd_airports_navaids = (
        "uv run tippecanoe -Z0 -z10 -o output/airports_navaids.pmtiles --no-feature-limit --no-tile-size-limit -f "
        "--order-by=rank --order-smallest-first "
        "-L airports:data/airports.geojson "
        "-L navaids:data/navaids.fgb "
        "-L localizers:data/localizers.fgb "
    )
    waypoints_obstacles_layers = [
        "-L waypoints:data/waypoints.fgb",
        "-L holding_patterns:data/holding_patterns.fgb",
        "-L obstacles:data/obstacles.fgb",
    ]
    if os.path.exists("data/parachute_areas.fgb"):
        waypoints_obstacles_layers.append("-L parachute_areas:data/parachute_areas.fgb")

    cmd_waypoints_obstacles = (
        "uv run tippecanoe -Z0 -z10 -o output/waypoints_obstacles.pmtiles --drop-fraction-as-needed -f "
        "--order-by=rank --order-smallest-first " + " ".join(waypoints_obstacles_layers)
    )
    cmd_airport_diagrams = (
        "uv run tippecanoe -Z9 -z14 -o output/airport_diagrams.pmtiles "
        "--no-feature-limit --no-tile-size-limit -f "
        "-L runways:data/runways.fgb "
        "-L am_taxiways:data/am_taxiways.fgb "
        "-L runway_labels:data/runway_labels.fgb"
    )

    vfr_layers = []
    for layer_name, path in [
        ("vfr_waypoints", "data/vfr_waypoints.fgb"),
        ("mtrs", "data/mtrs.fgb"),
        ("mtr_corridors", "data/mtr_corridors.fgb"),
        ("mountain_passes", "data/mountain_passes.fgb"),
        ("wind_farms", "data/wind_farms.fgb"),
        ("powerlines", "data/powerlines.geojson"),
    ]:
        if os.path.exists(path):
            vfr_layers.append(f"-L {layer_name}:{path}")

    commands = [
        cmd_airspaces,
        cmd_enroute,
        cmd_boundary,
        cmd_airports_navaids,
        cmd_waypoints_obstacles,
        cmd_airport_diagrams,
    ]
    if vfr_layers:
        cmd_vfr = (
            "uv run tippecanoe -Z0 -z10 -r1 -o output/vfr.pmtiles "
            "--no-feature-limit --no-tile-size-limit --order-by=rank --order-smallest-first -f " + " ".join(vfr_layers)
        )
        commands.append(cmd_vfr)

    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = [executor.submit(run_cmd, cmd) for cmd in commands]
        concurrent.futures.wait(futures)
        for f in futures:
            f.result()

    # Save the cycle metadata only when the entire pipeline succeeds
    metadata_path = "output/metadata.json"
    metadata = {"cycle": cycle}
    with open(metadata_path, "w") as f:
        json.dump(metadata, f)

    print("Pipeline complete!")

    print("Symlinking output to client/public/...")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/airspaces.pmtiles ../client/public/airspaces.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/enroute.pmtiles ../client/public/enroute.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/boundary.pmtiles ../client/public/boundary.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/airports_navaids.pmtiles ../client/public/airports_navaids.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/waypoints_obstacles.pmtiles ../client/public/waypoints_obstacles.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/airport_diagrams.pmtiles ../client/public/airport_diagrams.pmtiles")
    if os.path.exists("output/vfr.pmtiles"):
        run_cmd("ln -sf ../../faa-ais-pmtiles/output/vfr.pmtiles ../client/public/vfr.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/metadata.json ../client/public/metadata.json")
    print("Done.")


if __name__ == "__main__":
    main()
