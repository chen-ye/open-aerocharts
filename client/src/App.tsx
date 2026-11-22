import { Theme } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { FlightPlanPanel } from "./components/FlightPlanPanel/FlightPlanPanel";
import { AeroMap } from "./components/Map/AeroMap";
import { MobileBottomSheet } from "./components/MobileBottomSheet/MobileBottomSheet";
import { SettingsPanel } from "./components/SettingsPanel/SettingsPanel";
import { DEFAULT_BASEMAP_URL } from "./mapStyles";
import type {
	AeronauticalLayerState,
	WaypointUsage,
} from "./types/AeronauticalLayerState";
import { defaultAeronauticalState } from "./types/AeronauticalLayerState";
import type { FlightPlan, SearchIndex } from "./types/FlightPlan";

export const accentColor = "iris" as const;
export const grayColor = "gray" as const;

type AeronauticalBooleanKey = {
	[K in keyof AeronauticalLayerState]: AeronauticalLayerState[K] extends boolean
		? K
		: never;
}[keyof AeronauticalLayerState];

const parseWaypointUsage = (val: string | null): WaypointUsage => {
	if (val === "high" || val === "low") return val;
	return "all";
};

function App() {
	const [basemapUrlOrId, setBasemapUrlOrId] = useState(() => {
		const params = new URLSearchParams(window.location.search);
		return params.get("basemap") || DEFAULT_BASEMAP_URL;
	});

	const [showTerrain, setShowTerrain] = useState(() => {
		const params = new URLSearchParams(window.location.search);
		return params.get("terrain") === "true";
	});

	const [basemapBrightness, setBasemapBrightness] = useState(() => {
		const params = new URLSearchParams(window.location.search);
		const brightness = params.get("brightness");
		return brightness ? parseInt(brightness, 10) : 100;
	});

	const [routeString, setRouteString] = useState(() => {
		const params = new URLSearchParams(window.location.search);
		return params.get("route") || "";
	});

	const [showTooltip, setShowTooltip] = useState(() => {
		const params = new URLSearchParams(window.location.search);
		return params.get("tooltip") !== "false";
	});

	const [flightPlan, setFlightPlan] = useState<FlightPlan | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const [selectedFeatures, setSelectedFeatures] = useState<{
		lngLat: [number, number];
		features: any[];
	} | null>(null);
	const [index, setIndex] = useState<SearchIndex | null>(null);
	const [indexLoading, setIndexLoading] = useState(false);
	const [cycle, setCycle] = useState<string | null>(null);

	useEffect(() => {
		fetch("metadata.json")
			.then((res) => res.json())
			.then((data) => setCycle(data.cycle))
			.catch((err) => console.error("Failed to load metadata", err));
	}, []);

	useEffect(() => {
		if (index || indexLoading) return;

		const loadIndex = async () => {
			setIndexLoading(true);
			try {
				const res = await fetch("search_index.json");
				const data = await res.json();
				setIndex(data);
			} catch (err) {
				console.error("Failed to load search index", err);
			} finally {
				setIndexLoading(false);
			}
		};

		loadIndex();
	}, [index, indexLoading]);

	const [aeronauticalLayers, setAeronauticalLayers] =
		useState<AeronauticalLayerState>(() => {
			const params = new URLSearchParams(window.location.search);
			const layersParam = params.get("layers");
			const densityParam = params.get("density");
			const wptUsageParam = params.get("wptUsage");

			const initialState: AeronauticalLayerState = {
				...defaultAeronauticalState,
			};

			if (densityParam) {
				const density = parseInt(densityParam, 10);
				if (!Number.isNaN(density)) {
					initialState.declutterLevel = density;
				}
			}

			initialState.waypointUsage = parseWaypointUsage(wptUsageParam);

			if (!layersParam) return initialState;

			const booleanKeys = (
				Object.keys(initialState) as Array<keyof AeronauticalLayerState>
			).filter(
				(k): k is AeronauticalBooleanKey =>
					typeof initialState[k] === "boolean",
			);

			if (layersParam === "none") {
				const nextState = { ...initialState };
				for (const key of booleanKeys) {
					nextState[key] = false;
				}
				return nextState;
			}

			const enabledLayers = new Set(layersParam.split(","));
			const nextState = { ...initialState };
			for (const key of booleanKeys) {
				nextState[key] = enabledLayers.has(key);
			}
			return nextState;
		});

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		let changed = false;

		if (basemapUrlOrId !== DEFAULT_BASEMAP_URL) {
			if (params.get("basemap") !== basemapUrlOrId) {
				params.set("basemap", basemapUrlOrId);
				changed = true;
			}
		} else if (params.has("basemap")) {
			params.delete("basemap");
			changed = true;
		}

		if (showTerrain) {
			if (params.get("terrain") !== "true") {
				params.set("terrain", "true");
				changed = true;
			}
		} else if (params.has("terrain")) {
			params.delete("terrain");
			changed = true;
		}

		if (basemapBrightness !== 100) {
			if (params.get("brightness") !== basemapBrightness.toString()) {
				params.set("brightness", basemapBrightness.toString());
				changed = true;
			}
		} else if (params.has("brightness")) {
			params.delete("brightness");
			changed = true;
		}

		if (routeString) {
			if (params.get("route") !== routeString) {
				params.set("route", routeString);
				changed = true;
			}
		} else if (params.has("route")) {
			params.delete("route");
			changed = true;
		}

		const isLayersDefault = Object.entries(aeronauticalLayers).every(
			([key, val]) => {
				if (key === "declutterLevel" || key === "waypointUsage") return true; // Handled separately
				return (
					defaultAeronauticalState[key as keyof AeronauticalLayerState] === val
				);
			},
		);

		if (!isLayersDefault) {
			const enabledLayers = Object.entries(aeronauticalLayers)
				.filter(([, value]) => typeof value === "boolean" && value === true)
				.map(([key]) => key);

			const layersString =
				enabledLayers.length === 0 ? "none" : enabledLayers.join(",");
			if (params.get("layers") !== layersString) {
				params.set("layers", layersString);
				changed = true;
			}
		} else if (params.has("layers")) {
			params.delete("layers");
			changed = true;
		}

		if (aeronauticalLayers.declutterLevel !== 0) {
			if (
				params.get("density") !== aeronauticalLayers.declutterLevel.toString()
			) {
				params.set("density", aeronauticalLayers.declutterLevel.toString());
				changed = true;
			}
		} else if (params.has("density")) {
			params.delete("density");
			changed = true;
		}

		if (aeronauticalLayers.waypointUsage !== "all") {
			if (params.get("wptUsage") !== aeronauticalLayers.waypointUsage) {
				params.set("wptUsage", aeronauticalLayers.waypointUsage);
				changed = true;
			}
		} else if (params.has("wptUsage")) {
			params.delete("wptUsage");
			changed = true;
		}

		if (routeString) {
			if (params.get("route") !== routeString) {
				params.set("route", routeString);
				changed = true;
			}
		} else if (params.has("route")) {
			params.delete("route");
			changed = true;
		}

		if (!showTooltip) {
			if (params.get("tooltip") !== "false") {
				params.set("tooltip", "false");
				changed = true;
			}
		} else if (params.has("tooltip")) {
			params.delete("tooltip");
			changed = true;
		}

		if (changed) {
			const newSearch = params.toString();
			const newUrl = newSearch
				? `?${newSearch}${window.location.hash}`
				: window.location.pathname + window.location.hash;
			window.history.replaceState(null, "", newUrl);
		}
	}, [
		basemapUrlOrId,
		showTerrain,
		aeronauticalLayers,
		basemapBrightness,
		routeString,
		showTooltip,
	]);

	return (
		<Theme accentColor={accentColor} grayColor={grayColor} radius="medium">
			<div className="app-container">
				<SettingsPanel
					basemap={basemapUrlOrId}
					setBasemap={setBasemapUrlOrId}
					showTerrain={showTerrain}
					setShowTerrain={setShowTerrain}
					aeronauticalLayers={aeronauticalLayers}
					setAeronauticalLayers={setAeronauticalLayers}
					basemapBrightness={basemapBrightness}
					setBasemapBrightness={setBasemapBrightness}
					onClearSelection={() => setSelectedFeatures(null)}
				/>
				<AeroMap
					basemapUrlOrId={basemapUrlOrId}
					showTerrain={showTerrain}
					aeronauticalLayers={aeronauticalLayers}
					basemapBrightness={basemapBrightness}
					flightPlan={flightPlan}
					selectedFeatures={selectedFeatures}
					onSelectFeatures={setSelectedFeatures}
					showTooltip={showTooltip}
					cycle={cycle}
				/>
				<FlightPlanPanel
					onFlightPlanChange={setFlightPlan}
					routeString={routeString}
					onRouteStringChange={setRouteString}
					index={index}
					loading={indexLoading}
					showTooltip={showTooltip}
					setShowTooltip={setShowTooltip}
				/>
				<MobileBottomSheet
					selectedFeatures={
						aeronauticalLayers.showAll ? selectedFeatures : null
					}
					onCloseFeatures={() => setSelectedFeatures(null)}
					onFlightPlanChange={setFlightPlan}
					routeString={routeString}
					onRouteStringChange={setRouteString}
					index={index}
					loading={indexLoading}
				/>
			</div>
		</Theme>
	);
}

export default App;
