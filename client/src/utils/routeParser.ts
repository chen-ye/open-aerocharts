import type { SearchIndex, FlightPlan, RoutePoint } from '../types/FlightPlan';
import { featureCollection, point, lineString } from '@turf/helpers';

export const parseRoute = (routeStr: string, index: SearchIndex): FlightPlan => {
  const parts = routeStr.trim().toUpperCase().split(/\s+/).filter(p => p.length > 0);
  const routePoints: RoutePoint[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const features: any[] = []; // GeoJSON features

  let lastFixId: string | null = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Check for Procedure (e.g., TECKY4.VLREE or just TECKY4)
    // Heuristic: Has a dot OR is found in procedures index for the PREVIOUS airport
    // But efficiently, we usually know the airport context from the previous point?
    // Actually, SIDs start at an airport. STARs end at an airport.
    // Enroute procedures?
    
    // Simplest first pass: "PROC.TRANS"
    if (part.includes('.')) {
      const [procName, transName] = part.split('.');
      
      // We need to know which airport this procedure belongs to.
      // SIDs: Previous point should be the airport.
      // STARs: Next point should be the airport? Or previous point is enroute transition?
      
      // Search strategy:
      // 1. Check if previous point is an airport (SID context)
      // 2. Check if any airport has this procedure (expensive without optimized index)
      
      // Let's rely on index lookups.
      // Since our index is nested by Airport, we have to iterate airports to find the proc if we don't know it.
      // Optimization: We could build a reverse index map { "TECKY4": "KSJC" } but for now let's scan.
      
      let foundProc = null;

      // Try context first
      if (lastFixId && index.procedures[lastFixId] && index.procedures[lastFixId][procName]) {
        foundProc = index.procedures[lastFixId][procName];
      } else {
        // Scan all
        for (const [, procs] of Object.entries(index.procedures)) {
          if (procs[procName]) {
            foundProc = procs[procName];
            break; 
          }
        }
      }
      if (foundProc) {
        // Found it.
        // Logic: Procedure path = body + transition OR transition + body depending on SID vs STAR?
        // Our build script put points in 'body' and 'transitions'.
        // SIDs: usually Airport -> Runway -> Body -> Transition.
        // STARs: Transition -> Body -> Airport.

        // For drawing, we just concatenate geometry.
        let coords: [number, number][] = [];

        // If transition exists
        if (transName && foundProc.transitions[transName]) {
             // Heuristic: If parsing a SID, Body then Trans. If STAR, Trans then Body.
             // Usually SIDs have common body from airport to splitting transitions.
             // STARs have merging transitions to common body to airport.
             // Let's assume order in file was preserved?
             // Actually, simplest is just draw both segments.
             coords = [...foundProc.body, ...foundProc.transitions[transName]];

             // Deduplicate if join point is repeated?
             // Not worrying about perfect topology for now.
        } else {
            coords = foundProc.body;
        }

        if (coords.length > 1) {
            features.push(lineString(coords, { type: 'procedure', name: part }));

            // Add end point as a route point for continuity if needed?
            // Actually, let's just add the procedure visual.
            // And update lastFixId to the END of the procedure?
            // We don't easily know the ID of the last point from geometry alone without reverse lookup.
            // So we might lose "context" for the next segment if it relies on connectivity.
        }
        continue;
      }
    }

    // Direct Fix Lookup
    const fix = index.fixes[part];
    if (fix) {
      lastFixId = part;
      routePoints.push({
        id: part,
        lat: fix.lat,
        lon: fix.lon,
        type: 'fix',
        name: fix.name
      });
      features.push(point([fix.lon, fix.lat], { type: 'fix', id: part }));
      continue;
    }

    // Fallback: Unknown point
    console.warn(`Unknown fix or procedure: ${part}`);
  }

  // Generate connecting lines between sequential fixes (gaps in procedures)
  // This is tricky if mixed with procedures.
  // Ideally, we trace the full path.
  // For this v0, we just show what we found.

  // Basic point-to-point lines for non-procedure segments
  // Iterate routePoints, if sequential in 'parts', draw line.
  // But 'parts' includes procedures.

  // Better approach: Reconstruct geometry list.
  // Items in list: { type: 'point', coords } OR { type: 'line', coords[] }
  // Then connect the gaps.

  return {
    points: routePoints,
    geometry: featureCollection(features)
  };
};
