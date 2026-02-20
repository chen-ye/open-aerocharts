export interface AeronauticalLayerState {
  // Master
  showAll: boolean;

  // Airports
  showAirportsMaster: boolean;
  publicAirports: boolean;
  privateAirports: boolean;
  heliports: boolean;
  otherAirports: boolean;

  // Airspace
  showAirspaceMaster: boolean;
  controlledAirspace: boolean;
  suaMoa: boolean;
  trsa: boolean;
  classE: boolean;
  parachuteArea: boolean;
  modeC: boolean;

  // Airways & Waypoints
  showAirwaysMaster: boolean;
  enrouteLow: boolean;
  enrouteHigh: boolean;
  airways: boolean;
  navaids: boolean;
  waypoints: boolean;

  // ARTCC/FIR
  showArtccMaster: boolean;
  artccFirs: boolean;
  fisas: boolean;
  atcSectors: boolean;

  // Standalone
  vfrElements: boolean;
  gridMora: boolean;
}

export const defaultAeronauticalState: AeronauticalLayerState = {
  showAll: true,

  showAirportsMaster: true,
  publicAirports: true,
  privateAirports: false,
  heliports: false,
  otherAirports: false,

  showAirspaceMaster: true,
  controlledAirspace: true,
  suaMoa: true,
  trsa: true,
  classE: true,
  parachuteArea: true,
  modeC: true,

  showAirwaysMaster: true,
  enrouteLow: true,
  enrouteHigh: false,
  airways: true,
  navaids: true,
  waypoints: true,

  showArtccMaster: false,
  artccFirs: false,
  fisas: false,
  atcSectors: false,

  vfrElements: true,
  gridMora: false,
};
