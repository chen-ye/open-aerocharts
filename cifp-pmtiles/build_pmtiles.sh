#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "Step 1: Fetching latest FAA CIFP..."
uv run fetch-cifp

if [ ! -f "FAACIFP18" ]; then
    echo "Error: FAACIFP18 not found after fetching."
    exit 1
fi

echo "Step 1b: Fetching FAA airspace shapefiles..."
uv run fetch-airspace-shp

echo "Step 1c: Converting shapefiles to FlatGeobuf..."
uv run shp-to-fgb

echo "Step 2: Parsing CIFP and generating FlatGeobuf..."
uv run cifp-to-fgb FAACIFP18

echo "Step 3: Compiling into PMTiles with tippecanoe..."
TIPPECANOE="uv run tippecanoe"
TILEJOIN="uv run tile-join"

# Airspaces: controlled (shapefiles) + SUA (ArcGIS), merged into one file
$TIPPECANOE -Z0 -z10 -o output/airspaces.pmtiles \
    --no-feature-limit --no-tile-size-limit -f \
    -l airspaces data/airspaces.fgb

# Boundary airspace (ARTCC/FIR): never drop, visible at low zoom
$TIPPECANOE -Z0 -z8 -o output/boundary.pmtiles \
    --no-feature-limit --no-tile-size-limit -f \
    -l boundary_airspace data/boundary_airspace.fgb

# All other layers: allow dropping dense features to keep tile sizes reasonable
$TIPPECANOE -zg -o output/other_layers.pmtiles --drop-densest-as-needed -f \
    -L airports:data/airports.fgb \
    -L navaids:data/navaids.fgb \
    -L procedures:data/procedures.fgb \
    -L airways:data/airways.fgb \
    -L runways:data/runways.fgb \
    -L localizers:data/localizers.fgb \
    -L holding_patterns:data/holding_patterns.fgb \
    -L obstacles:data/obstacles.fgb

# Join into a single PMTiles file
$TILEJOIN -o output/cifp_data.pmtiles -f \
    output/airspaces.pmtiles output/boundary.pmtiles output/other_layers.pmtiles

echo "Pipeline complete! Generated cifp_data.pmtiles"

# Symlink the output PMTiles to the frontend public directory
echo "Symlinking output to client/public/..."
ln -sf ../../cifp-pmtiles/output/cifp_data.pmtiles ../client/public/cifp_data.pmtiles
echo "Done."
