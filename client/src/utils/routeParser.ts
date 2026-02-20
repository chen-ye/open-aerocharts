import type { SearchIndex, FlightPlan, RoutePoint, ProcedurePoint } from '../types/FlightPlan';
import { featureCollection, point, lineString } from '@turf/helpers';

export const parseRoute = (routeStr: string, index: SearchIndex): FlightPlan => {
  const parts = routeStr.trim().toUpperCase().split(/\s+/).filter(p => p.length > 0);
  const routePoints: RoutePoint[] = [];
  const allCoords: [number, number][] = [];
  
  let lastFixId: string | null = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Check for Procedure (e.g., TECKY4.VLREE or just TECKY4)
    // Heuristic: Has a dot OR is found in procedures index for the PREVIOUS airport
    
    // Simplest first pass: "PROC.TRANS" or "TRANS.PROC"
    if (part.includes('.')) {
      const [left, right] = part.split('.');
      
      let foundProc = null;
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
        usedTransName = right;
      }

      // Strategy 2: Treat as TRANS.PROC (STAR style: BURGL.IRNMN2)
      if (!foundProc) {
        const proc2 = findProcedure(right);
        if (proc2 && proc2.proc.transitions[left]) {
          foundProc = proc2.proc;
          usedTransName = left;
        }
      }

      if (foundProc) {
        // Found it. 
        let procPoints: ProcedurePoint[] = [];
        
        // If transition exists
        if (usedTransName && foundProc.transitions[usedTransName]) {
             // Heuristic: If parsing a SID, Body then Trans. If STAR, Trans then Body.
             // Usually SIDs have common body from airport to splitting transitions.
             // STARs have merging transitions to common body to airport.
             // We just merge them for visualization.
             procPoints = [...foundProc.body, ...foundProc.transitions[usedTransName]];
        } else {
            procPoints = foundProc.body;
        }

        // Add points to route
        for (const pt of procPoints) {
            routePoints.push({
                id: pt.id,
                lat: pt.coords[1],
                lon: pt.coords[0],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                type: pt.type as any, // Cast to match RoutePoint type union
                name: pt.name
            });
            allCoords.push(pt.coords);
            lastFixId = pt.id; // Update context
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
        type: fix.type,
        name: fix.name
      });
      allCoords.push([fix.lon, fix.lat]);
      continue;
    }
    
    // Fallback: Unknown point
    console.warn(`Unknown fix or procedure: ${part}`);
  }

  // Generate FeatureCollection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const features: any[] = [];

  // 1. Single continuous line for the route
  if (allCoords.length > 1) {
      features.push(lineString(allCoords, { type: 'route-path' }));
  }

  // 2. Points for all fixes (including procedure intermediates)
  for (const pt of routePoints) {
      features.push(point([pt.lon, pt.lat], { 
          id: pt.id, 
          type: pt.type,
          name: pt.name
      }));
  }
  
  return {
    points: routePoints,
    geometry: featureCollection(features)
  };
};
