# open-aerocharts

open-aerocharts is vector-data driven reference aeronautical chart
implementation in MapLibre. The aim is to build high quality vector charts
equivalent to the official raster FAA charts for the US.

The project is split into two packages:

- `faa-ais-pmtiles`: A Python package to fetch and convert FAA AIS (CIFP, NASR,
  ADDS) data to PMTiles format.
- `client`: A reference MapLibre webapp to display the data, with aero chart
  styling.

## Client Datasources

- **3D Terrain**: Global AWS Open Data Registry Terrarium Tiles integrated
  natively with MapLibre mountain hillshading.
- **Aeronautical Data**: FAA AIS-derived vector tiles providing airspaces,
  airways, navaids, and airports. See the [`faa ais pmtiles` README.md](faa-ais-pmtiles/README.md) for more
  information.
- **Basemap**: CartoCDN-derived basemaps.

## References

- [FAA Aeronautical Chart User's Guide](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/aero_guide)

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

## TODOs

- [ ] Beef up flight planning
- [ ] Fully support all aeronautical layers (more airports, TRSA, Localizers, VOR compass roses, etc.)
- [ ] Show weather/radar + METAR/TAF/FRS
- [ ] Show TFRs/other SWIM data
- [ ] Show Airport/Runway info
- [ ] Custom Aeronautical basemap (light + dark)
- [ ] Show VHF information
