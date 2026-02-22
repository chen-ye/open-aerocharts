# CIFP to PMTiles Data Pipeline

This directory contains a pipeline for automatically downloading and converting
FAA aeronautical datasets into MapLibre/Mapbox compatible 3D PMTiles.

## Pipeline Architecture

The pipeline is split into two distinct phases to ensure data quality and
rendering performance.

### Phase 1: Download & Normalization

In this phase, raw datasets are fetched from multiple FAA portals and normalized
into intermediate bulk geodata formats (**FlatGeobuf** and **GeoJSON**).

- **Data Transformation**:
  - Irrelevant properties are dropped to minimize tile size.
  - Geometries are postprocessed (e.g., coalescing Class E airspace boundaries).
  - Coordinates are mapped to 3D `[lon, lat, elevation]` for engine
    compatibility.
- **Client-Side Optimization**: The resulting schema is tailored for direct
  high-performance rendering in the browser.

### Phase 2: Tileization

Normalized data is processed through `tippecanoe` to produce a collection of
vector PMTiles.

- **Semantic Split**: Archives are organized by data importance and information
  density.
- **Optimal Zoom Levels**: Each archive is compiled with specific zoom
  constraints to balance detail versus performance.
- **Feature Preservation**: High-priority features (e.g., major airports) use
  custom flags to bypass standard density-based truncation.

---

## Data Flow Mapping

| Feature                 | Primary Datasource | Intermediate Format         | Final PMTile Archive          |
| :---------------------- | :----------------- | :-------------------------- | :---------------------------- |
| **Airports**            | CIFP (ARINC 424)   | `data/airports.geojson`*    | `airports_navaids.pmtiles`    |
| **Navaids (VHF/NDB)**   | CIFP (ARINC 424)   | `data/navaids.fgb`          | `airports_navaids.pmtiles`    |
| **Airspaces (B/C/D)**   | NFDC Shapefiles    | `data/airspaces.fgb`        | `airspaces.pmtiles`           |
| **Airspaces (SUA)**     | ADDS ArcGIS        | `data/airspaces.fgb`        | `airspaces.pmtiles`           |
| **Airspaces (Class E)** | NFDC Shapefiles    | `data/airspaces.fgb`        | `enroute.pmtiles`             |
| **Airways**             | CIFP (ARINC 424)   | `data/airways.fgb`          | `enroute.pmtiles`             |
| **Procedures**          | CIFP (ARINC 424)   | `data/procedures.fgb`       | `enroute.pmtiles`             |
| **Runways**             | CIFP + ADDS        | `data/runways.fgb`          | `airport_diagrams.pmtiles`    |
| **Localizers**          | CIFP (ARINC 424)   | `data/localizers.fgb`       | `airports_navaids.pmtiles`    |
| **Waypoints**           | CIFP (ARINC 424)   | `data/waypoints.fgb`        | `waypoints_obstacles.pmtiles` |
| **Holding Patterns**    | ADDS ArcGIS        | `data/holding_patterns.fgb` | `waypoints_obstacles.pmtiles` |
| **Obstacles**           | ADDS ArcGIS        | `data/obstacles.fgb`        | `waypoints_obstacles.pmtiles` |
| **Diagrams (Taxi)**     | ADDS ArcGIS        | `data/am_taxiways.fgb`      | `airport_diagrams.pmtiles`    |

_\*Runways are merged from ADDS (high-fidelity) and CIFP (polygonized), deduplicated, and served in the high-zoom diagrams layer._

_\*Airports use GeoJSON to allow Tippecanoe to respect explicit minzoom/priority
ranks._

---

## Feature Schemas & Examples

### 1. Airports

- **Layer**: `airports`
- **Rank 1**: Major International
- **Rank 2**: Regional/Municipal

```typescript
interface AirportProperties {
  id: string; // e.g., "KSJC"
  name: string; // e.g., "SAN JOSE INTL"
  type: "airport";
  facility_type:
    | "private"
    | "civil_hard"
    | "civil_soft"
    | "seaplane"
    | "military";
  surface: "S" | "H" | "W"; // Soft, Hard, Water
  rank: 1 | 2 | 3 | 4; // 1=Major, 4=Minor
  longest_runway: number; // in feet
  is_military: boolean;
  is_ifr: boolean;
  has_fuel: boolean; // FBO availability
}
```

Example:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [-121.92, 37.36, 62.0] },
  "properties": {
    "id": "KSJC",
    "name": "SAN JOSE INTL",
    "rank": 1,
    "type": "airport"
  }
}
```

### 2. Navaids

- **Layer**: `navaids`

```typescript
interface NavaidProperties {
  id: string; // e.g., "SJC"
  name: string; // e.g., "SAN JOSE"
  frequency: number; // e.g., 114.1
  type: "vhf" | "ndb";
  rank: 4 | 5;
}
```

Example:

```json
{
  "properties": {
    "id": "SJC",
    "name": "SAN JOSE",
    "frequency": 114.1,
    "type": "vhf"
  }
}
```

### 3. Airspaces

- **Layer**: `airspaces`, `enroute`, `boundary_airspace`

```typescript
type AirspaceType =
  | "CLASS_B"
  | "CLASS_C"
  | "CLASS_D"
  | "E"
  | "A"
  | "MOA"
  | "R"
  | "W"
  | "P"
  | "D";
type BoundaryType =
  | "ARTCC"
  | "FIR"
  | "ACC"
  | "CLASS"
  | "SATA"
  | "CTA"
  | "CTA-P"
  | "ADIZ"
  | "DEF"
  | "UTA"
  | "OCA";

interface AirspaceProperties {
  name: string;
  type: AirspaceType | BoundaryType;
  airspace_class: string;
  is_sua: boolean;
  upper_limit: string; // e.g., "10000" or "FL180"
  lower_limit: string; // e.g., "4000" or "SFC"
}
```

Example:

```json
{
  "properties": {
    "name": "SAN FRANCISCO",
    "type": "B",
    "upper_val": 10000,
    "lower_val": 4000
  }
}
```

### 4. Airways

- **Layer**: `airways`

```typescript
interface AirwayProperties {
  airway: string; // e.g., "V230"
  type: "victor" | "jet" | "q" | "t";
  route_type: "O" | "R"; // O=Optional/Standard, R=Regulated/Required
  structure: "Low" | "High";
  rank: 5;
}
```

Example:

```json
{
  "properties": { "airway": "V230", "type": "victor" }
}
```

### 5. Waypoints & Obstacles

- **Layer**: `waypoints`, `obstacles`

```typescript
interface WaypointProperties {
  id: string; // e.g., "VINCO"
  name: string;
  type: "named" | "rnav" | "compulsory";
  usage: "L" | "H" | "B" | ""; // Low, High, Both, Terminal
  rank: 3 | 4 | 5 | 6;
}

interface ObstacleProperties {
  type: string; // e.g., "T-L TWR"
  amsl: number; // Altitude Above Mean Sea Level
  agl: number; // Height Above Ground Level
  lighting: "N" | "U" | "D" | "W" | "R" | "M" | "L" | "S" | "H" | "C" | "F";
}
```

Example:

```json
{
  "properties": { "id": "VINCO", "type": "compulsory" }
}
```

---

## Running & Validating

1. **Install Prerequisites**: `tippecanoe`, `uv`
2. **Execute Full Pipeline**:

   ```bash
   uv run build-pmtiles
   ```

3. **Data Quality Validation**:

   ```bash
   uv run spot-check
   ```

   _Note: This utility decodes key tiles to ensure high-priority features (like
   KSJC) were not dropped during Phase 2._

4. **Enumeration Discovery**:

   ```bash
   uv run list-enums
   ```

   _Note: Use this to view all possible unique values for categorical properties
   (like `type` or `lighting`) across all datasets._
   
   5. **Outputs**: Files in `output/` are automatically symlinked to
      `client/public/`.
   
   ## Project Structure
   
   - **`src/cifp/`**: Handling of FAA CIFP (ARINC 424) datasets.
   - **`src/adds/`**: Handling of ADDS ArcGIS and NFDC Shapefile datasets.
   - **`src/runways/`**: Logic for generating runway polygons from threshold data.
   - **`src/pmtiles/`**: Orchestration of the build pipeline.
   - **`src/tools/`**: Utilities for inspection and validation.
   - **`src/search/`**: Search index generation.
   
