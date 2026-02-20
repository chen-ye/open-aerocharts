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
    
    // Simplest first pass: "PROC.TRANS" or "TRANS.PROC"
    if (part.includes('.')) {
      const [left, right] = part.split('.');
      
      let foundProc = null;
      let usedProcName = '';
      let usedTransName = '';

      // Helper to find a procedure by name across all airports or within context
      const findProcedure = (name: string) => {
        // Try context first (if previous point was an airport)
        if (lastFixId && index.procedures[lastFixId] && index.procedures[lastFixId][name]) {
          return { airport: lastFixId, proc: index.procedures[lastFixId][name] };
        }
        // Scan all airports
        for (const [apt, procs] of Object.entries(index.procedures)) {
          if (procs[name]) {
            return { airport: apt, proc: procs[name] };
          }
        }
        return null;
      };

      // Strategy 1: Treat as PROC.TRANS (SID style: TECKY4.VLREE)
      const proc1 = findProcedure(left);
      if (proc1 && proc1.proc.transitions[right]) {
        foundProc = proc1.proc;
        usedProcName = left;
        usedTransName = right;
      }

      // Strategy 2: Treat as TRANS.PROC (STAR style: BURGL.IRNMN2)
      if (!foundProc) {
        const proc2 = findProcedure(right);
        if (proc2 && proc2.proc.transitions[left]) {
          foundProc = proc2.proc;
          usedProcName = right;
          usedTransName = left;
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
        if (usedTransName && foundProc.transitions[usedTransName]) {
             // Heuristic: If parsing a SID, Body then Trans. If STAR, Trans then Body.
             // Usually SIDs have common body from airport to splitting transitions.
             // STARs have merging transitions to common body to airport.
             // Let's assume order in file was preserved?
             // Actually, simplest is just draw both segments.
             coords = [...foundProc.body, ...foundProc.transitions[usedTransName]];
        } else {
            coords = foundProc.body;
        }

        if (coords.length > 1) {
            features.push(lineString(coords, { type: 'procedure', name: part }));
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
