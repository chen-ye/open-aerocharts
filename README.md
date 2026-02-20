# OpenVFR Flight Map

OpenVFR is an interactive, open-source VFR Flight Planner map modeled after the
MSFS 2024 interface. It utilizes 100% open data sources to deliver a premium
flight planning experience using top-tier web technologies.

## Features

- **MapLibre GL JS**: High-performance WebGL vector maps.
- **3D Terrain**: Global AWS Open Data Registry Terrarium Tiles integrated
  natively with MapLibre mountain hillshading.
- **Aeronautical Data**: Complete US OpenAIP vector tiles providing airspaces,
  airways, navaids, and airports.
- **Configurable Basemaps**: Easily switch between CartoCDN Voyager, Positron,
  and Dark Matter.
- **Premium Aesthetics**: Built with OpenProps to deliver modern glassmorphism
  UI components.

## Getting Started

1. Clone the repository.
2. Ensure you have an OpenAIP API Key. Create a `.env` file in the root
   directory:
   ```env
   VITE_OPENAIP_API_KEY=your_key_here
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## Tech Stack

- React + TypeScript + Vite
- MapLibre GL JS + `react-map-gl`
- Vanilla CSS + OpenProps for styling
- Lucide React Icons
