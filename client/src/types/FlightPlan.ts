export interface FixInfo {
  lat: number;
  lon: number;
  type: 'airport' | 'navaid' | 'waypoint';
  name?: string;
}

export interface ProcedurePoint {
  coords: [number, number];
  id: string;
  type: string;
  name: string;
}

export interface ProcedureSegment {
  body: ProcedurePoint[];
  transitions: Record<string, ProcedurePoint[]>;
}

export interface SearchIndex {
  fixes: Record<string, FixInfo>;
  procedures: Record<string, Record<string, ProcedureSegment>>; // airport -> proc_name -> segment
}

export interface RoutePoint {
  id: string;
  lat: number;
  lon: number;
  type: 'airport' | 'navaid' | 'waypoint' | 'procedure';
  name?: string; // e.g. "TECKY4"
}

export interface FlightPlan {
  points: RoutePoint[];
  geometry: GeoJSON.FeatureCollection;
}
