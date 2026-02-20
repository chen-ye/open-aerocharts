# open-aerocharts

open-aerocharts is vector-data driven reference aeronautical chart
implementation in MapLibre. The aim is to build high quality vector charts
equivalent to the official raster FAA charts for the US.

The project is split into two packages:

- `cifp-pmtiles`: A Python package to fetch and convert CIFP data to PMTiles
  format.
- `client`: A reference MapLibre webapp to display the data, with aero chart
  styling.

## Datasources

- **3D Terrain**: Global AWS Open Data Registry Terrarium Tiles integrated
  natively with MapLibre mountain hillshading.
- **Aeronautical Data**: Complete US CIFP-derived vector tiles providing
  airspaces, airways, navaids, and airports.
- **Basemap**: CartoCDN-derived basemaps.

## Getting Started

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Tech Stack

- React + TypeScript + Vite
- MapLibre GL JS + `react-map-gl`
- Radix Themes
- Lucide React Icons
