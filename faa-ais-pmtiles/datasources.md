# Data Sources

Tracking document for all aeronautical data sources used in the open-aerocharts
pipeline.

## Active Sources

### From CIFP (ARINC 424)

| Layer                     | Status         | Output                                           |
| ------------------------- | -------------- | ------------------------------------------------ |
| **Airports & Heliports**  | ✅ Implemented | `data/airports.geojson`*                         |
| **Navaids (VHF/NDB)**     | ✅ Implemented | `data/navaids.fgb`                               |
| **Procedures (SID/STAR)** | ✅ Implemented | `data/procedures.fgb`                            |
| **Airways**               | ✅ Implemented | `data/airways.fgb`                               |
| **Grid MORA (`AS` records)** | ✅ Implemented | `data/grid_mora_lines.fgb`, `data/grid_mora_labels.fgb` (`→ enroute.pmtiles`) |
| **Runways**               | ✅ Implemented | `data/runways.fgb`                               |
| **Localizers**            | ✅ Implemented | `data/localizers.fgb`                            |
| **Waypoints**             | ✅ Implemented | `data/waypoints.fgb`                             |

\*_Merged with operational NASR facilities (`APT_BASE.csv` + `APT_RWY.csv`) and written as GeoJSON so Tippecanoe respects explicit `minzoom` and rank-based feature preservation. Runways merge CIFP + ADDS._

CIFP download: https://aeronav.faa.gov/Upload_313-d/cifp/

---

### From NASR 28-Day Subscription (CSV)

| Layer                               | Source Files                | Status         | Output                                                       |
| ----------------------------------- | --------------------------- | -------------- | ------------------------------------------------------------ |
| **Airport & Heliport Facilities**   | `APT_BASE.csv`, `APT_RWY.csv` | ✅ Implemented | `data/nasr_facilities.json`, `data/nasr_metadata.json`       |
| **Parachute Jump Areas (PJA)**      | `PJA_BASE.csv`              | ✅ Implemented | `data/pja_raw.geojson` → `data/parachute_areas.fgb`          |
| **VFR Waypoints & Sectional Fixes** | `FIX_BASE.csv` (`VP*` & sectional fixes) | ✅ Implemented | `data/vfr_waypoints.fgb` (`→ vfr.pmtiles`)      |
| **Military Training Routes (MTR)**  | `MTR_BASE.csv`, `MTR_PT.csv` | ✅ Implemented | Backfills `data/mtrs.fgb` (`→ vfr.pmtiles`)                 |

Download:
`https://nfdc.faa.gov/webContent/28DaySub/{cycle-date}/28DaySubscription_CSV.zip` (fallback `extra/{dd_Mon_YYYY}_CSV.zip`)

---

### From NFDC 28-Day Subscription (Shapefiles)

| Layer                    | Status         | Output                        |
| ------------------------ | -------------- | ----------------------------- |
| Class Airspace (B/C/D/E) | ✅ Implemented | `data/airspaces.fgb` (merged) |

Download:
`https://nfdc.faa.gov/webContent/28DaySub/{cycle-date}/class_airspace_shape_files.zip`

---

### From ADDS ArcGIS Open Data Hub

Base URL: `https://adds-faa.opendata.arcgis.com` Download pattern:
`{base}/api/v3/datasets/{item_id}_0/downloads/data?format=geojson&spatialRefId=4326`

| Layer                         | Item ID                            | Status         | Output                                      |
| ----------------------------- | ---------------------------------- | -------------- | ------------------------------------------- |
| Special Use Airspace          | `dd0d1b726e504137ab3c41b21835d05b` | ✅ Implemented | `data/airspaces.fgb` (merged)               |
| Boundary Airspace (ARTCC/FIR) | `67885972e4e940b2aa6d74024901c561` | ✅ Implemented | `data/boundary_airspace.fgb`                |
| Holding Pattern               | `ba57404f70184b858d2c929f99f7b40c` | ✅ Implemented | `data/holding_patterns.fgb`                 |
| Digital Obstacle File (DOF)   | `e202ff4e4cf943bda02ff63c0c44c9b7` | ✅ Implemented | `data/obstacles.fgb`                        |
| Military Training Routes (`MTR_Segment`) | `0c6899de28af447c801231ed7ba7baa6` (`MTRSegment/FeatureServer/0`) | ✅ Implemented | `data/mtrs.fgb`, `data/mtr_corridors.fgb` (`→ vfr.pmtiles`) |

---

### VFR Auxiliary Open Data Sources

| Layer                        | Source & Processing                                                                                              | Status         | Output                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------- |
| **Mountain Passes**          | QLever OSM Planet SPARQL (`mountain_pass=yes`, US relation `148838`)                                         | ✅ Implemented | `data/mountain_passes.fgb` (`→ vfr.pmtiles`) |
| **Wind Farms**               | USGS USWTDB (`uswtdbGeoJSON.zip`) clustered in 5 km AEQD + FAA DOF `WINDMILL` `AMSL`/`AGL` enrichment       | ✅ Implemented | `data/wind_farms.fgb` (`→ vfr.pmtiles`)   |
| **Power Transmission Lines** | HIFLD `Electric_Power_Transmission_Lines/FeatureServer/0` (`>= 115 kV` overhead, tiered at `z6`/`z7`/`z9`)       | ✅ Implemented | `data/powerlines.geojson` (`→ vfr.pmtiles`) |

---

## Omitted VFR Elements & Basemap Rationale

The following VFR chart elements are intentionally excluded from the aeronautical overlay pipeline:

- **`pop-village` (Populated Places)**: Already rendered across all Protomaps (`places` `kind="locality"`), CartoCDN, and MapTiler basemap themes; adding an aeronautical overlay duplicates and collides with basemap place labels.
- **`relief-peak` (Mountain Peaks)**: Present in Protomaps `pois` (`kind="peak"`, `elevation` in meters at `z11`–`z14`, rendered in `light`/`dark`) and MapTiler Outdoor (feet, `z7`–`z14`); omitted to avoid cluttering and duplicating basemap terrain labels.
- **Visual Landmarks (`lm-lookout`, `lm-mine`, `lm-outdoor-theater`, `lm-cg-station`)**: Omitted from Protomaps (except unstyled `quarry` centroids and stripped `cinema` tags lacking `drive_in=yes`), and USGS GNIS dropped `Tower` and `Mine` feature classes in Oct 2026, leaving no authoritative federal open dataset.
- **Named VFR Checkpoints** (magenta call-in flags such as *"Sunol Grade"*): FAA NASR and ADDS open vector feeds do not publish named VFR checkpoints (`FIX_BASE.csv` carries only `VP*` 5-letter VFR waypoints with blank `CHARTING_REMARK`).

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
| TFR_Area                          | _TBD_   | Temporary Flight Restrictions (dynamic) |
| AM_Runway / AM_Taxiway / AM_Apron | _TBD_   | Airport detail mapping (high zoom)      |
