import { PROTOMAPS_BLACK_URL, PROTOMAPS_DARK_URL } from "../mapStyles";
import type { AeronauticalLayerState } from "../types/AeronauticalLayerState";

export type ChartPresetId =
	| "vfr-sectional"
	| "ifr-low"
	| "vfr-terminal"
	| "ifr-high"
	| "helicopter"
	| "clean";

interface FixedChartPreset {
	id: Exclude<ChartPresetId, "clean">;
	label: string;
	title: string;
	basemap: string;
	showTerrain: boolean;
	layers: AeronauticalLayerState;
}

interface CleanChartPreset {
	id: "clean";
	label: string;
	title: string;
}

export type ChartPreset = FixedChartPreset | CleanChartPreset;

const vfrSectionalLayers: AeronauticalLayerState = {
	showAll: true,
	declutterLevel: 0,

	showAirportsMaster: true,
	publicAirports: true,
	privateAirports: true,
	heliports: true,
	otherAirports: true,

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
	waypoints: false,
	waypointUsage: "all",
	vfrWaypoints: true,

	showVfrMaster: true,
	mtrs: true,
	mountainPasses: true,
	windFarms: true,
	powerlines: true,

	showArtccMaster: true,
	artccFirs: false,
	ctaAcc: false,
	specialRules: true,

	obstacles: true,
	gridMora: false,
};

const ifrLowLayers: AeronauticalLayerState = {
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
	parachuteArea: false,
	modeC: false,

	showAirwaysMaster: true,
	enrouteLow: true,
	enrouteHigh: false,

	showWaypointsMaster: true,
	navaids: true,
	waypoints: true,
	waypointUsage: "low",
	vfrWaypoints: false,

	showVfrMaster: false,
	mtrs: false,
	mountainPasses: false,
	windFarms: false,
	powerlines: false,

	showArtccMaster: true,
	artccFirs: true,
	ctaAcc: true,
	specialRules: true,

	obstacles: false,
	gridMora: true,
};

// Ordered row-major for a 2-column grid:
// Row 1: VFR Sectional | IFR Low
// Row 2: VFR Terminal  | IFR High
// Row 3: Helicopter    | Clean
export const CHART_PRESETS: readonly ChartPreset[] = [
	{
		id: "vfr-sectional",
		label: "VFR Sectional",
		title:
			"VFR Sectional (Protomaps Dark + Terrain + VFR layers & Victor airways)",
		basemap: PROTOMAPS_DARK_URL,
		showTerrain: true,
		layers: vfrSectionalLayers,
	},
	{
		id: "ifr-low",
		label: "IFR Low",
		title:
			"IFR Enroute Low (Protomaps Dataviz Black + Low airways, fixes & Grid MORA)",
		basemap: PROTOMAPS_BLACK_URL,
		showTerrain: false,
		layers: ifrLowLayers,
	},
	{
		id: "vfr-terminal",
		label: "VFR Terminal",
		title: "VFR Terminal Area / TAC (High density VFR layers & Class B detail)",
		basemap: PROTOMAPS_DARK_URL,
		showTerrain: true,
		layers: {
			...vfrSectionalLayers,
			declutterLevel: 2,
		},
	},
	{
		id: "ifr-high",
		label: "IFR High",
		title:
			"IFR Enroute High (Protomaps Dataviz Black + High airways, fixes & SUA)",
		basemap: PROTOMAPS_BLACK_URL,
		showTerrain: false,
		layers: {
			...ifrLowLayers,
			controlledAirspace: false,
			trsa: false,
			classE: false,
			enrouteLow: false,
			enrouteHigh: true,
			waypointUsage: "high",
		},
	},
	{
		id: "helicopter",
		label: "Helicopter",
		title: "Helicopter Route (Heliports, obstacles, powerlines & VFR airspace)",
		basemap: PROTOMAPS_DARK_URL,
		showTerrain: true,
		layers: {
			...vfrSectionalLayers,
			declutterLevel: 2,
			otherAirports: false,
			showAirwaysMaster: false,
			enrouteLow: false,
			enrouteHigh: false,
		},
	},
	{
		id: "clean",
		label: "Clean",
		title: "Clean (Hide aeronautical overlays and terrain on current basemap)",
	},
];

function layersMatchEffectively(
	a: AeronauticalLayerState,
	b: AeronauticalLayerState,
): boolean {
	if (
		a.showAll !== b.showAll ||
		a.declutterLevel !== b.declutterLevel ||
		a.obstacles !== b.obstacles ||
		a.gridMora !== b.gridMora
	) {
		return false;
	}

	if (a.showAirportsMaster !== b.showAirportsMaster) return false;
	if (
		a.showAirportsMaster &&
		(a.publicAirports !== b.publicAirports ||
			a.privateAirports !== b.privateAirports ||
			a.heliports !== b.heliports ||
			a.otherAirports !== b.otherAirports)
	) {
		return false;
	}

	if (a.showAirspaceMaster !== b.showAirspaceMaster) return false;
	if (
		a.showAirspaceMaster &&
		(a.controlledAirspace !== b.controlledAirspace ||
			a.suaMoa !== b.suaMoa ||
			a.trsa !== b.trsa ||
			a.classE !== b.classE ||
			a.parachuteArea !== b.parachuteArea ||
			a.modeC !== b.modeC)
	) {
		return false;
	}

	if (a.showAirwaysMaster !== b.showAirwaysMaster) return false;
	if (
		a.showAirwaysMaster &&
		(a.enrouteLow !== b.enrouteLow || a.enrouteHigh !== b.enrouteHigh)
	) {
		return false;
	}

	if (a.showWaypointsMaster !== b.showWaypointsMaster) return false;
	if (a.showWaypointsMaster) {
		if (
			a.navaids !== b.navaids ||
			a.waypoints !== b.waypoints ||
			a.vfrWaypoints !== b.vfrWaypoints
		) {
			return false;
		}
		if (a.waypoints && a.waypointUsage !== b.waypointUsage) {
			return false;
		}
	}

	if (a.showVfrMaster !== b.showVfrMaster) return false;
	if (
		a.showVfrMaster &&
		(a.mtrs !== b.mtrs ||
			a.mountainPasses !== b.mountainPasses ||
			a.windFarms !== b.windFarms ||
			a.powerlines !== b.powerlines)
	) {
		return false;
	}

	if (a.showArtccMaster !== b.showArtccMaster) return false;
	if (
		a.showArtccMaster &&
		(a.artccFirs !== b.artccFirs ||
			a.ctaAcc !== b.ctaAcc ||
			a.specialRules !== b.specialRules)
	) {
		return false;
	}

	return true;
}

export function getActivePresetId(state: {
	basemap: string;
	showTerrain: boolean;
	layers: AeronauticalLayerState;
}): ChartPresetId | null {
	const { basemap, showTerrain, layers } = state;

	if (!layers.showAll && !showTerrain) {
		return "clean";
	}

	if (!layers.showAll) {
		return null;
	}

	for (const preset of CHART_PRESETS) {
		if (preset.id === "clean") continue;
		if (basemap !== preset.basemap || showTerrain !== preset.showTerrain) {
			continue;
		}
		if (layersMatchEffectively(layers, preset.layers)) {
			return preset.id;
		}
	}

	return null;
}
