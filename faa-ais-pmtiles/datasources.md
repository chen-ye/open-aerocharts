# Data Sources

Tracking document for all aeronautical data sources used in the open-aerocharts
pipeline.

## Active Sources

### From CIFP (ARINC 424)

| Layer                      | Status         | Output                    |
| -------------------------- | -------------- | ------------------------- |
| **Airports**               | ✅ Implemented | `data/airports.geojson`*  |
| **Navaids (VHF/NDB)**      | ✅ Implemented | `data/navaids.fgb`        |
| **Procedures (SID/STAR)**  | ✅ Implemented | `data/procedures.fgb`     |
| **Airways**                | ✅ Implemented | `data/airways.fgb`        |
| **Runways**                | CIFP + ADDS    | ✅ Implemented | `data/runways.fgb`        |
| **Localizers**             | ✅ Implemented | `data/localizers.fgb`     |
| **Waypoints**              | ✅ Implemented | `data/waypoints.fgb`      |

\*_Airports use GeoJSON to allow Tippecanoe to respect explicit `minzoom` and rank-based feature preservation._

CIFP download: https://aeronav.faa.gov/Upload_313-d/cifp/

---

### From NFDC 28-Day Subscription (Shapefiles)

| Layer                    | Status         | Output                            |
| ------------------------ | -------------- | --------------------------------- |
| Class Airspace (B/C/D/E) | ✅ Implemented | `data/airspaces.geojson` (merged) |

Download:
`https://nfdc.faa.gov/webContent/28DaySub/{cycle-date}/class_airspace_shape_files.zip`

---

### From ADDS ArcGIS Open Data Hub

Base URL: `https://adds-faa.opendata.arcgis.com` Download pattern:
`{base}/api/v3/datasets/{item_id}_0/downloads/data?format=geojson&spatialRefId=4326`

| Layer                         | Item ID                            | Status         | Output                            |
| ----------------------------- | ---------------------------------- | -------------- | --------------------------------- |
| Special Use Airspace          | `dd0d1b726e504137ab3c41b21835d05b` | ✅ Implemented | `data/airspaces.geojson` (merged) |
| Boundary Airspace (ARTCC/FIR) | `67885972e4e940b2aa6d74024901c561` | ✅ Implemented | `data/boundary_airspace.geojson`  |
| Holding Pattern               | `ba57404f70184b858d2c929f99f7b40c` | ✅ Implemented | `data/holding_patterns.geojson`   |
| Digital Obstacle File (DOF)   | `e202ff4e4cf943bda02ff63c0c44c9b7` | ✅ Implemented | `data/obstacles.geojson`          |

---

## Potential Future Sources (ADDS ArcGIS)

| Dataset                           | Item ID | Notes                                   |
| --------------------------------- | ------- | --------------------------------------- |
| Designated_Point (Waypoints)      | _TBD_   | Richer than CIFP waypoints              |
| ATS_Route / RoutePortion          | _TBD_   | Pre-built airway geometry               |
| NAVAID_System / NAVAID_Component  | _TBD_   | Could replace CIFP navaids              |
| ILS_System / ILS_Component        | _TBD_   | Richer ILS data than CIFP localizers    |
| MSA_Center / MSA_Arc              | _TBD_   | Minimum Sector Altitudes                |
| Terminal_Arrival_Area (TAA)       | _TBD_   | RNAV arrival areas                      |
| MTR_Segment                       | _TBD_   | Military Training Routes                |
| TFR_Area                          | _TBD_   | Temporary Flight Restrictions (dynamic) |
| AM_Runway / AM_Taxiway / AM_Apron | _TBD_   | Airport detail mapping (high zoom)      |
