export interface AeronauticalLayerState {
	// Master
	showAll: boolean;
	declutterLevel: number;

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

	// Airways
	showAirwaysMaster: boolean;
	enrouteLow: boolean;
	enrouteHigh: boolean;

	// Waypoints
	showWaypointsMaster: boolean;
	navaids: boolean;
	waypoints: boolean;

	// VFR Elements
	showVfrMaster: boolean;
	vfrWaypoints: boolean;
	mtrs: boolean;
	mountainPasses: boolean;
	windFarms: boolean;
	powerlines: boolean;

	// Boundaries (ARTCC/FIR/CTA/Special Rules)
	showArtccMaster: boolean;
	artccFirs: boolean;
	ctaAcc: boolean;
	specialRules: boolean;

	// Standalone
	obstacles: boolean;
	gridMora: boolean;
}

export const defaultAeronauticalState: AeronauticalLayerState = {
	showAll: true,
	declutterLevel: 0,

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

	showWaypointsMaster: true,
	navaids: true,
	waypoints: true,

	showVfrMaster: true,
	vfrWaypoints: true,
	mtrs: true,
	mountainPasses: true,
	windFarms: true,
	powerlines: false,

	showArtccMaster: false,
	artccFirs: true,
	ctaAcc: false,
	specialRules: false,

	obstacles: false,
	gridMora: false,
};
