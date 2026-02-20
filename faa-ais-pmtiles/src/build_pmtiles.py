import os
import subprocess
import concurrent.futures

from src import fetch_cifp
from src import fetch_airspace_shp
from src import shp_to_fgb
from src import fetch_nasr
from src import cifp_to_fgb

def run_cmd(cmd):
    print(f"Running: {cmd}")
    subprocess.run(cmd, shell=True, check=True)

def fetch_nasr_wrapper():
    # Fetch NASR and save down a local cache file for the build step to use
    import json
    fuel_lookup = fetch_nasr.get_airport_fuel()
    os.makedirs("data", exist_ok=True)
    with open("data/nasr_fuel.json", "w") as f:
        json.dump(fuel_lookup, f)

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
    cmd_boundary = (
        "uv run tippecanoe -Z0 -z8 -o output/boundary.pmtiles "
        "--no-feature-limit --no-tile-size-limit -f "
        "-l boundary_airspace data/boundary_airspace.fgb"
    )
    cmd_other = (
        "uv run tippecanoe -zg -o output/other_layers.pmtiles --drop-densest-as-needed -f "
        "--order-by=rank --order-smallest-first "
        "-L airports:data/airports.fgb "
        "-L navaids:data/navaids.fgb "
        "-L procedures:data/procedures.fgb "
        "-L airways:data/airways.fgb "
        "-L runways:data/runways.fgb "
        "-L localizers:data/localizers.fgb "
        "-L holding_patterns:data/holding_patterns.fgb "
        "-L obstacles:data/obstacles.fgb"
    )

    with concurrent.futures.ThreadPoolExecutor() as executor:
        f1 = executor.submit(run_cmd, cmd_airspaces)
        f2 = executor.submit(run_cmd, cmd_boundary)
        f3 = executor.submit(run_cmd, cmd_other)
        concurrent.futures.wait([f1, f2, f3])
        f1.result()
        f2.result()
        f3.result()

    print("Step 4: Joining PMTiles...")
    cmd_join = (
        "uv run tile-join -o output/faa_ais.pmtiles -f "
        "output/airspaces.pmtiles output/boundary.pmtiles output/other_layers.pmtiles"
    )
    run_cmd(cmd_join)

    print("Pipeline complete! Generated faa_ais.pmtiles")

    print("Symlinking output to client/public/...")
    run_cmd("ln -sf ../../faa-ais-pmtiles/output/faa_ais.pmtiles ../client/public/faa_ais.pmtiles")
    print("Done.")

if __name__ == "__main__":
    main()
