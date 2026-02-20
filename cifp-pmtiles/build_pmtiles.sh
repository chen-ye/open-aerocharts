#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "Step 1: Fetching latest FAA CIFP..."
uv run python src/fetch_cifp.py

if [ ! -f "FAACIFP18" ]; then
    echo "Error: FAACIFP18 not found after fetching."
    exit 1
fi

echo "Step 2: Parsing CIFP and generating GeoJSON..."
uv run python src/cifp_to_geojson.py FAACIFP18

echo "Step 3: Compiling into PMTiles with tippecanoe..."
tippecanoe -zg -o output/cifp_data.pmtiles --drop-densest-as-needed -f \
    data/airports.geojson data/navaids.geojson data/airspaces.geojson \
    data/procedures.geojson data/airways.geojson data/runways.geojson \
    data/localizers.geojson

echo "Pipeline complete! Generated cifp_data.pmtiles"

# Symlink the output PMTiles to the frontend public directory
echo "Symlinking output to public/..."
ln -sf ../cifp-pmtiles/output/cifp_data.pmtiles ../public/cifp_data.pmtiles
echo "Done."
