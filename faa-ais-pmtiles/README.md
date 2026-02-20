# CIFP to PMTiles Data Pipeline

This directory contains a pipeline for automatically downloading and converting
FAA CIFP (ARINC 424) datasets into MapLibre/Mapbox compatible 3D PMTiles. The
extracted database provides routing and spatial features tailored for VFR/IFR
webmaps.

## Architecture

- `src/fetch_cifp.py`
  - Scrapes the FAA AeroNav portal and automatically downloads the latest 28-day
    cycle CIFP `.zip` bundle.
- `src/cifp_to_geojson.py`
  - Utilizes `cifparse` to unpack the CIFP records and generates valid GeoJSON
    files for each functional aeronautical layer.
  - All GeoJSON features are emitted with `Z` (elevation/altitude) coordinate
    mapping for 3D engine capabilities.
- `build_pmtiles.py`
  - Orchestrates the fetching, parsing, and finally the execution of
    `tippecanoe` to produce `output/faa_ais.pmtiles`.

## Extracted Features & PMTile Structure

The pipeline exports a PMTiles archive populated with multiple internal layers
(features). The geometries natively support 3D dimensions as
`[lon, lat, elevation]`.

Below is the structure of each feature layer stored inside the `pmtiles`
database, along with a GeoJSON representation example.

### 1. Airports (`airports.geojson`)

- **Geometry**: `Point`
- **Z-Coordinate**: Airport Elevation (MSL)
- **Properties**:
  - `type`: "airport"
  - `id`: Airport identifier (e.g. `00AK`)
  - `name`: Facility Name (e.g. `LOWELL FLD`)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [-151.692222, 59.948889, 252.0]
  },
  "properties": {
    "id": "00AK",
    "name": "LOWELL FLD",
    "type": "airport"
  }
}
```

### 2. Navaids (`navaids.geojson`)

Extracts both VHF (VORs, VORTACs, DMEs) and NDB facilities.

- **Geometry**: `Point`
- **Z-Coordinate**: Navaid Antenna Elevation (MSL)
- **Properties**:
  - `type`: "vhf" or "ndb"
  - `id`: Ident (e.g. `ADK`)
  - `name`: Full Name (e.g. `MOUNT MOFFETT`)
  - `frequency`: Operating Frequency (e.g. `114.0`)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [-176.674275, 51.871075, 329.0]
  },
  "properties": {
    "id": "ADK",
    "name": "MOUNT MOFFETT",
    "frequency": 114.0,
    "type": "vhf"
  }
}
```

### 3. Airspaces (`airspaces.geojson`)

Extracts controlled (Class B, C, D) and restrictive (Prohibited, Restricted,
MOA) airspace boundaries.

- **Geometry**: `Polygon` or `LineString`
- **Z-Coordinate**: Upper Limit Ceiling (MSL)
- **Properties**:
  - `name`: Region/Center Name
  - `type`: Airspace Class/Type indicator code

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[
      [-149.983055, 61.176666, 4100.0],
      [-149.900000, 61.180000, 4100.0],
      ...
    ]]
  },
  "properties": {
    "name": "ANCHORAGE",
    "type": "C"
  }
}
```

### 4. Procedures (`procedures.geojson`)

Extracts operational routing legs for SIDs, STARs, and standard Approach paths.

- **Geometry**: `LineString`
- **Z-Coordinate**: Minimum Crossing Altitude at each fix/waypoint (MSL)
- **Properties**:
  - `airport`: Destination/Departure facility ID
  - `procedure`: Procedure designation
  - `transition`: Associated routing transition

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-174.213836, 52.238328, 18000.0],
      [-174.518714, 52.266289, 0.0]
    ]
  },
  "properties": {
    "airport": "PAAK",
    "procedure": "INOTY1",
    "transition": "RW34"
  }
}
```

### 5. Airways (`airways.geojson`)

Extracts the low enroute (Victor) and high enroute (Jet/Q) networked flight
paths.

- **Geometry**: `LineString`
- **Z-Coordinate**: Minimum Enroute Altitude (MEA) (MSL)
- **Properties**:
  - `airway`: Airway identifier (e.g. `A342`, `V108`)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [163.702353, 51.607208, 18000.0],
      [170.154239, 52.93775, 18000.0]
    ]
  },
  "properties": {
    "airway": "A342"
  }
}
```

### 6. Runways (`runways.geojson`)

Extracts runway endpoints and threshold locations for visual diagram scaling.

- **Geometry**: `Point`
- **Z-Coordinate**: Threshold Elevation (MSL)
- **Properties**:
  - `type`: "runway"
  - `airport`: Local Airport ID
  - `runway`: Identifier (e.g. `RW03`)
  - `bearing`: Magnetic Bearing
  - `length`: Physical Length (ft)
  - `width`: Physical Width (ft)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [-156.463889, 59.088889, 70.0]
  },
  "properties": {
    "airport": "00AN",
    "runway": "RW03",
    "length": 4517,
    "bearing": 30.3,
    "width": 60,
    "type": "runway"
  }
}
```

### 7. Localizers (`localizers.geojson`)

Extracts Instrument Landing System (ILS) Localizer and Glide Slope beam
emitters.

- **Geometry**: `Point`
- **Z-Coordinate**: Glide Slope Emitter Elevation (MSL)
- **Properties**:
  - `type`: "localizer"
  - `airport`: Host Airport ID
  - `runway`: Target Runway ID
  - `ident`: LOC Identifier
  - `frequency`: LOC Frequency
  - `bearing`: Beam Alignment Course

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [-161.846411, 60.768492, 106.0]
  },
  "properties": {
    "airport": "PABE",
    "runway": "RW19R",
    "ident": "IBET",
    "frequency": 111.5,
    "bearing": 192.5,
    "type": "localizer"
  }
}
```

## Running the Pipeline

1. Install system prerequisites: `tippecanoe`
2. Install Python manager: `uv`
3. Enter `faa-ais-pmtiles` directory.
4. Run orchestrator script:

```bash
uv run build-pmtiles
```

5. Once completed, find the MapLibre-ready database at `output/faa_ais.pmtiles`.
