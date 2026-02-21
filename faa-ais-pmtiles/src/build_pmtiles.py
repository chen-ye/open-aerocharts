import os
import subprocess
import concurrent.futures

from src import fetch_cifp
from src import fetch_airspace_shp
from src import shp_to_fgb
from src import fetch_nasr
from src import cifp_to_fgb

# Each PMTiles file is served directly to the frontend — no tile-join needed.
# This allows each file to use its own optimal zoom range.
PMTILES_FILES = [
    "airspaces",
    "enroute",
    "boundary",
    "airport_diagrams",
]

def run_cmd(cmd):
    print(f"Running: {cmd}")
    subprocess.run(cmd, shell=True, check=True)

def fetch_nasr_wrapper():
    # Fetch NASR metadata (caching is handled within fetch_nasr.py)
    fetch_nasr.get_airport_metadata()

def main():
    print("Step 1: Fetching data concurrently...")
    with concurrent.futures.ThreadPoolExecutor() as executor:
        f1 = executor.submit(fetch_cifp.main)
        f2 = executor.submit(fetch_airspace_shp.main)
        f3 = executor.submit(fetch_nasr_wrapper)
        concurrent.futures.wait([f1, f2, f3])
        # Check exceptions
        f1.result()
        f2.result()
        f3.result()

    if not os.path.exists("FAACIFP18"):
        print("Error: FAACIFP18 not found after fetching.")
        return

    print("Step 2: Parsing and converting to FlatGeobuf concurrently...")
    with concurrent.futures.ProcessPoolExecutor() as executor:
        f1 = executor.submit(shp_to_fgb.main)
        f2 = executor.submit(cifp_to_fgb.build_pmtiles_fgb, "FAACIFP18")
        concurrent.futures.wait([f1, f2])
        f1.result()
        f2.result()

    print("Step 3: Compiling into PMTiles with tippecanoe concurrently...")
    os.makedirs("output", exist_ok=True)

    cmd_airspaces = (
        "uv run tippecanoe -Z0 -z10 -o output/airspaces.pmtiles "
        "--no-feature-limit --no-tile-size-limit -f "
        "-l airspaces data/airspaces.fgb"
    )
    cmd_enroute = (
        "uv run tippecanoe -Z0 -z8 -o output/enroute.pmtiles "
        "--no-feature-limit --no-tile-size-limit -f "
        "-L airways:data/airways.fgb "
        "-L airspaces:data/airspaces_e.fgb"
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
        "-L runways:data/runways.fgb "
        "-L localizers:data/localizers.fgb "
    )
    cmd_waypoints_obstacles = (
        "uv run tippecanoe -Z0 -z10 -o output/waypoints_obstacles.pmtiles --drop-fraction-as-needed -f "
        "--order-by=rank --order-smallest-first "
        "-L waypoints:data/waypoints.fgb "
        "-L holding_patterns:data/holding_patterns.fgb "
        "-L obstacles:data/obstacles.fgb"
    )
    cmd_airport_diagrams = (
        "uv run tippecanoe -Z9 -z14 -o output/airport_diagrams.pmtiles "
        "--no-feature-limit --no-tile-size-limit -f "
        "-L am_runways:data/am_runways.fgb "
        "-L am_taxiways:data/am_taxiways.fgb"
    )

    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = [
            executor.submit(run_cmd, cmd_airspaces),
            executor.submit(run_cmd, cmd_enroute),
            executor.submit(run_cmd, cmd_boundary),
            executor.submit(run_cmd, cmd_airports_navaids),
            executor.submit(run_cmd, cmd_waypoints_obstacles),
            executor.submit(run_cmd, cmd_airport_diagrams),
        ]
        concurrent.futures.wait(futures)
        for f in futures:
            f.result()

    print("Pipeline complete!")

    print("Symlinking output to client/public/...")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/airspaces.pmtiles ../client/public/airspaces.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/enroute.pmtiles ../client/public/enroute.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/boundary.pmtiles ../client/public/boundary.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/airports_navaids.pmtiles ../client/public/airports_navaids.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/waypoints_obstacles.pmtiles ../client/public/waypoints_obstacles.pmtiles")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/airport_diagrams.pmtiles ../client/public/airport_diagrams.pmtiles")
    print("Done.")

if __name__ == "__main__":
    main()
