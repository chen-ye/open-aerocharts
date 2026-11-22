import {
	amber,
	amberDark,
	blue,
	blueDark,
	brown,
	brownDark,
	crimson,
	crimsonDark,
	cyan,
	cyanDark,
	gray,
	grayDark,
	indigo,
	indigoDark,
	purple,
	purpleDark,
	slate,
	slateDark,
	teal,
	tealDark,
} from "@radix-ui/colors";
import {
	Box,
	Card,
	Flex,
	Heading,
	IconButton,
	Separator,
	Text,
} from "@radix-ui/themes";
import { X } from "lucide-react";
import type { Map as Maplibre } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import React, { useCallback, useMemo, useState } from "react";
import ReactMap, {
	Layer,
	NavigationControl,
	Popup,
	Source,
} from "react-map-gl/maplibre";
import { accentColor, grayColor } from "../../App.tsx";
import styles from "../../mapStyles";
import type { AeronauticalLayerState } from "../../types/AeronauticalLayerState";
import type { FlightPlan } from "../../types/FlightPlan";
import { addAeroIcons } from "../../utils/aeroIcons.ts";
import {
	getAirspaceColor,
	getAirspaceTextColor,
} from "../../utils/airspaceColors.ts";
import { AirspaceOverlay } from "./AirspaceOverlay";
import { FeatureList } from "./FeatureList";

maplibregl.setWorkerUrl(workerUrl);

const CANVAS_CONTEXT_ATTRIBUTES = { antialias: true };
const INITIAL_VIEW_STATE = {
	longitude: -121.596667, // San Martin Airport
	latitude: 37.081667,
	zoom: 8,
	pitch: 0,
};
const MAP_CONTAINER_STYLE: React.CSSProperties = {
	width: "100%",
	height: "100%",
};
const TERRAIN_SPEC: maplibregl.TerrainSpecification = {
	source: "terrain",
	exaggeration: 1.2,
};
const BASEMAP_DIMMER_DATA = {
	type: "FeatureCollection" as const,
	features: [
		{
			type: "Feature" as const,
			geometry: {
				type: "Polygon" as const,
				coordinates: [
					[
						[-180, -90],
						[180, -90],
						[180, 90],
						[-180, 90],
						[-180, -90],
					],
				],
			},
			properties: {},
		},
	],
};

interface AeroMapProps {
	basemapUrlOrId: string;
	showTerrain: boolean;
	aeronauticalLayers: AeronauticalLayerState;
	basemapBrightness: number;
	flightPlan: FlightPlan | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	onSelectFeatures?: (
		features: { lngLat: [number, number]; features: any[] } | null,
	) => void;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	selectedFeatures?: { lngLat: [number, number]; features: any[] } | null;
	showTooltip: boolean;
	cycle?: string | null;
}

export const AeroMap: React.FC<AeroMapProps> = ({
	basemapUrlOrId,
	showTerrain,
	aeronauticalLayers,
	basemapBrightness,
	flightPlan,
	onSelectFeatures,
	selectedFeatures: propSelectedFeatures,
	showTooltip,
	cycle,
}) => {
	const mapStyle = useMemo<string | maplibregl.StyleSpecification>(() => {
		// If the basemapUrlOrId is a URL, treat it as a style URL
		if (URL.canParse(basemapUrlOrId)) {
			return basemapUrlOrId;
		}
		const style =
			styles[basemapUrlOrId as keyof typeof styles] ?? styles["faa-sectional"];
		return style;
	}, [basemapUrlOrId]);

	// Derive light/dark mode from basemap identifier
	const isDarkMap = useMemo(() => {
		const id = basemapUrlOrId.toLowerCase();
		return id.includes("dark") || id.includes("black");
	}, [basemapUrlOrId]);

	// Theme-dependent colors
	const textColor = isDarkMap ? "#ffffff" : "#000000";
	const haloColor = isDarkMap
		? "rgba(0, 0, 0, 0.8)"
		: "rgba(255, 255, 255, 0.95)";
	const accentTextColor = isDarkMap ? indigoDark.indigo11 : indigo.indigo11;
	const waypointTextColor = isDarkMap ? grayDark.gray11 : gray.gray11;
	const obstacleTextColor = isDarkMap ? purpleDark.purple11 : purple.purple11;

	const mapRef = React.useRef<Maplibre | null>(null);

	const addAirwayBgIcon = useCallback(
		(map: Maplibre, isDark: boolean, shouldApply?: () => boolean) => {
			const definitions = [
				{ id: "airway-bg-gray", color: isDark ? grayDark.gray11 : gray.gray11 },
				{ id: "airway-bg-blue", color: blueDark.blue8 },
				{
					id: "airway-bg-brown",
					color: isDark ? brownDark.brown9 : brown.brown9,
				},
			];

			definitions.forEach((def) => {
				const svgStr = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="22" height="22" rx="4" fill="${def.color}"/>
        </svg>
      `;
				const img = new Image(24, 24);
				const blob = new Blob([svgStr], {
					type: "image/svg+xml;charset=utf-8",
				});
				const url = URL.createObjectURL(blob);
				img.onload = () => {
					URL.revokeObjectURL(url);
					if (shouldApply && !shouldApply()) return;
					if (!map.getStyle()) return;
					if (map.hasImage(def.id)) map.removeImage(def.id);
					map.addImage(def.id, img, {
						stretchX: [[8, 16]],
						stretchY: [[8, 16]],
						content: [4, 4, 20, 20],
						pixelRatio: 1,
					});
				};
				img.onerror = () => {
					URL.revokeObjectURL(url);
				};
				img.src = url;
			});
		},
		[],
	);

	const addVfrPatterns = useCallback(
		(map: Maplibre, isDark: boolean, shouldApply?: () => boolean) => {
			const color = isDark ? purpleDark.purple9 : purple.purple9;
			const svgStr = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M-2 2L2 -2M-2 18L18 -2M14 18L18 14" stroke="${color}" stroke-width="0.9" stroke-opacity="0.45"/>
        <circle cx="4" cy="4" r="1.1" fill="${color}" fill-opacity="0.8"/>
        <circle cx="12" cy="12" r="1.1" fill="${color}" fill-opacity="0.8"/>
      </svg>
    `;
			const img = new Image(16, 16);
			const blob = new Blob([svgStr], {
				type: "image/svg+xml;charset=utf-8",
			});
			const url = URL.createObjectURL(blob);
			img.onload = () => {
				URL.revokeObjectURL(url);
				if (shouldApply && !shouldApply()) return;
				if (!map.getStyle()) return;
				if (map.hasImage("pat-wind-farm")) map.removeImage("pat-wind-farm");
				map.addImage("pat-wind-farm", img, { pixelRatio: 1 });
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
			};
			img.src = url;
		},
		[],
	);

	const iconGenRef = React.useRef(0);
	const injectedThemeRef = React.useRef<boolean | null>(null);
	const styleEpochRef = React.useRef(0);
	const lastInjectedEpochRef = React.useRef(-1);
	const prevBasemapRef = React.useRef<string>(basemapUrlOrId);
	if (prevBasemapRef.current !== basemapUrlOrId) {
		prevBasemapRef.current = basemapUrlOrId;
		styleEpochRef.current += 1;
	}

	React.useEffect(() => {
		return () => {
			iconGenRef.current += 1;
		};
	}, []);

	const injectMapIcons = useCallback(
		(map: Maplibre) => {
			const gen = ++iconGenRef.current;
			const shouldApply = () => iconGenRef.current === gen;
			injectedThemeRef.current = isDarkMap;
			const svgHaloColor = isDarkMap ? "#000000" : "#ffffff";
			addAeroIcons(map, svgHaloColor, 0.95, shouldApply);
			addAirwayBgIcon(map, isDarkMap, shouldApply);
			addVfrPatterns(map, isDarkMap, shouldApply);
		},
		[isDarkMap, addAirwayBgIcon, addVfrPatterns],
	);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onMapLoad = useCallback(
		(e: any) => {
			mapRef.current = e.target;
			setIsTilted(e.target.getPitch() > 10);
			lastInjectedEpochRef.current = styleEpochRef.current;
			injectMapIcons(e.target);
		},
		[injectMapIcons],
	);

	// Re-inject icons when a full style swap rebuilds ImageManager or theme changes mid-load
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onStyleData = useCallback(
		(e: any) => {
			const map = mapRef.current ?? (e.target as Maplibre | undefined);
			if (!map || !map.getStyle()) return;

			setIsTilted(map.getPitch() > 10);

			const missingIcons =
				!map.hasImage("apt-ifr-civil") ||
				!map.hasImage("airway-bg-blue") ||
				!map.hasImage("pat-wind-farm");
			const needsEpochInject =
				missingIcons && lastInjectedEpochRef.current !== styleEpochRef.current;
			const themeMismatch = injectedThemeRef.current !== isDarkMap;

			if (needsEpochInject || themeMismatch) {
				lastInjectedEpochRef.current = styleEpochRef.current;
				injectMapIcons(map);
			}
		},
		[isDarkMap, injectMapIcons],
	);

	// Re-inject icons immediately when light/dark basemap theme changes via styleDiffing
	React.useEffect(() => {
		const map = mapRef.current;
		if (!map || !map.getStyle()) return;
		if (injectedThemeRef.current !== isDarkMap) {
			injectMapIcons(map);
		}
	}, [isDarkMap, injectMapIcons]);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const [hoverInfo, setHoverInfo] = useState<{
		lngLat: [number, number];
		features: any[];
	} | null>(null);

	React.useEffect(() => {
		if (!aeronauticalLayers.showAll) {
			setHoverInfo(null);
		}
	}, [aeronauticalLayers.showAll]);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const [localSelectedFeatures, setLocalSelectedFeatures] = useState<{
		lngLat: [number, number];
		features: any[];
	} | null>(null);
	const [isTilted, setIsTilted] = useState(() => {
		if (typeof window === "undefined") return false;
		const pitch = Number(
			window.location.hash.replace(/^#/, "").split("/")[4] ?? 0,
		);
		return Number.isFinite(pitch) && pitch > 10;
	});

	const show3dAirspace =
		isTilted &&
		aeronauticalLayers.showAll &&
		aeronauticalLayers.showAirspaceMaster &&
		(aeronauticalLayers.controlledAirspace ||
			aeronauticalLayers.suaMoa ||
			aeronauticalLayers.trsa);

	const [hasMountedAirspaceOverlay, setHasMountedAirspaceOverlay] =
		useState(show3dAirspace);

	React.useEffect(() => {
		if (show3dAirspace && !hasMountedAirspaceOverlay) {
			setHasMountedAirspaceOverlay(true);
		}
	}, [show3dAirspace, hasMountedAirspaceOverlay]);

	const selectedFeatures =
		propSelectedFeatures !== undefined
			? propSelectedFeatures
			: localSelectedFeatures;
	const setSelectedFeatures = onSelectFeatures || setLocalSelectedFeatures;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onMove = useCallback((e: any) => {
		setIsTilted(e.target.getPitch() > 10);
	}, []);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onMouseMove = useCallback(
		(e: any) => {
			if (showTooltip && e.features && e.features.length > 0) {
				setHoverInfo({
					lngLat: [e.lngLat.lng, e.lngLat.lat],
					features: e.features,
				});
			} else {
				setHoverInfo(null);
			}
		},
		[showTooltip],
	);

	const onMouseLeave = useCallback(() => {
		setHoverInfo(null);
	}, []);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onMapClick = useCallback(
		(e: any) => {
			if (e.features && e.features.length > 0) {
				setSelectedFeatures({
					lngLat: [e.lngLat.lng, e.lngLat.lat],
					features: e.features,
				});
			} else {
				setSelectedFeatures(null);
			}
		},
		[setSelectedFeatures],
	);

	const onMapContextMenu = useCallback(() => {
		// Note: react-map-gl's contextmenu event prevents default behavior by default if we use it this way
		setSelectedFeatures(null);
	}, [setSelectedFeatures]);

	const interactiveLayerIds = useMemo(
		() => [
			"grid-mora-labels",
			"boundary-artcc-hit",
			"boundary-cta-hit",
			"boundary-special-rules-hit",
			"boundary-special-rules-fill",
			"wind-farms-fill",
			"powerlines-hit",
			"airspaces-class-b",
			"airspaces-class-b-fill",
			"airspaces-class-c",
			"airspaces-class-c-fill",
			"airspaces-class-d",
			"airspaces-class-d-fill",
			"airspaces-sua",
			"airspaces-sua-fill",
			"airspaces-trsa",
			"airspaces-trsa-fill",
			"airspaces-mode-c-hit",
			"airspaces-class-e-fill",
			"parachute-areas-fill",
			"mtr-hit",
			"airways-low-line",
			"airways-high-line",
			"airports-public",
			"airports-private",
			"airports-heliport",
			"airports-other",
			"navaids-symbol",
			"waypoints-symbol",
			"vfr-waypoints-symbol",
			"vfr-sectional-fixes-symbol",
			"mountain-passes-symbol",
			"localizers-symbol",
			"obstacles-symbol",
			"runways-fill",
			"am-taxiways-fill",
		],
		[],
	);

	React.useEffect(() => {
		const pmtilesProtocol = new Protocol();
		maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

		return () => {
			maplibregl.removeProtocol("pmtiles");
		};
	}, []);

	const airwayLinePaint: maplibregl.LineLayerSpecification["paint"] = useMemo(
		() => ({
			"line-color": [
				"match",
				["get", "route_type"],
				"O",
				isDarkMap ? grayDark.gray11 : gray.gray11, // Official Designated (Victor/Jet)
				"R",
				blue.blue9, // RNAV/GPS
				"H",
				isDarkMap ? brownDark.brown9 : brown.brown9, // Helicopter
				isDarkMap ? grayDark.gray11 : gray.gray11, // fallback
			] as unknown as maplibregl.ExpressionSpecification,
			"line-width": [
				"interpolate",
				["linear"],
				["zoom"],
				3,
				1,
				7,
				2,
				10,
				4,
			] as unknown as maplibregl.ExpressionSpecification,
			"line-opacity": [
				"interpolate",
				["linear"],
				["zoom"],
				3,
				0.2,
				7,
				0.6,
			] as unknown as maplibregl.ExpressionSpecification,
		}),
		[isDarkMap],
	);

	const airwaySymbolLayout: maplibregl.SymbolLayerSpecification["layout"] =
		useMemo(() => {
			const minDetailZoom = Math.max(0, 10 - aeronauticalLayers.declutterLevel);
			return {
				"symbol-placement": [
					"step",
					["zoom"],
					"line",
					minDetailZoom,
					"line-center",
				] as unknown as maplibregl.ExpressionSpecification,
				"symbol-spacing": 500,
				"icon-image": [
					"step",
					["zoom"],
					"",
					minDetailZoom,
					[
						"match",
						["get", "route_type"],
						"O",
						"airway-bg-gray",
						"R",
						"airway-bg-blue",
						"H",
						"airway-bg-brown",
						"airway-bg-gray",
					],
				] as unknown as maplibregl.ExpressionSpecification,
				"icon-text-fit": "both",
				"icon-text-fit-padding": [-2, 4, -2, 4],
				"text-field": ["get", "airway"],
				"text-font": ["Open Sans Bold", "Arial Unicode MS Regular"],
				"text-size": 11,
				"text-allow-overlap": true,
				"text-ignore-placement": true,
				"text-rotation-alignment": "map",
				"text-pitch-alignment": "map",
			};
		}, [aeronauticalLayers.declutterLevel]);

	const airwayMeaLayout: maplibregl.SymbolLayerSpecification["layout"] =
		useMemo(() => {
			const minDetailZoom = Math.max(0, 10 - aeronauticalLayers.declutterLevel);
			return {
				"symbol-placement": "line-center",
				"symbol-spacing": 500,
				"text-field": [
					"step",
					["zoom"],
					"",
					minDetailZoom,
					["to-string", ["get", "mea"]],
				] as unknown as maplibregl.ExpressionSpecification,
				"text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
				"text-size": 10,
				"text-offset": [0, -1.5],
				"text-allow-overlap": true,
				"text-ignore-placement": true,
				"text-rotation-alignment": "map",
				"text-pitch-alignment": "map",
			};
		}, [aeronauticalLayers.declutterLevel]);

	const airwayDistLayout: maplibregl.SymbolLayerSpecification["layout"] =
		useMemo(() => {
			const minDetailZoom = Math.max(0, 10 - aeronauticalLayers.declutterLevel);
			return {
				"symbol-placement": "line-center",
				"symbol-spacing": 500,
				"text-field": [
					"step",
					["zoom"],
					"",
					minDetailZoom,
					["to-string", ["get", "distance"]],
				] as unknown as maplibregl.ExpressionSpecification,
				"text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
				"text-size": 10,
				"text-offset": [0, 1.5],
				"text-allow-overlap": true,
				"text-ignore-placement": true,
				"text-rotation-alignment": "map",
				"text-pitch-alignment": "map",
			};
		}, [aeronauticalLayers.declutterLevel]);

	const airwaySymbolPaint: maplibregl.SymbolLayerSpecification["paint"] =
		useMemo(() => {
			const minDetailZoom = Math.max(0, 10 - aeronauticalLayers.declutterLevel);
			return {
				"text-color": [
					"match",
					["get", "route_type"],
					"O",
					isDarkMap ? "#000000" : "#ffffff", // Contests against gray11
					"R",
					"#ffffff", // Contrasts against blue9
					"H",
					"#ffffff", // Contrasts against brown9
					isDarkMap ? "#000000" : "#ffffff", // Default
				] as unknown as maplibregl.ExpressionSpecification,
				"text-halo-color": [
					"match",
					["get", "route_type"],
					"O",
					isDarkMap ? grayDark.gray11 : gray.gray11,
					"R",
					blueDark.blue7,
					"H",
					isDarkMap ? brownDark.brown9 : brown.brown9,
					isDarkMap ? grayDark.gray11 : gray.gray11,
				] as unknown as maplibregl.ExpressionSpecification,
				"text-halo-width": [
					"step",
					["zoom"],
					1.5,
					minDetailZoom,
					0,
				] as unknown as maplibregl.ExpressionSpecification,
			};
		}, [isDarkMap, aeronauticalLayers.declutterLevel]);

	const airwayDetailPaint: maplibregl.SymbolLayerSpecification["paint"] =
		useMemo(
			() => ({
				"text-color": textColor,
				"text-halo-color": haloColor,
				"text-halo-width": 1.5,
			}),
			[textColor, haloColor],
		);

	const airportSymbolLayout: maplibregl.SymbolLayerSpecification["layout"] =
		useMemo(
			() => ({
				"icon-image": [
					"match",
					["get", "facility_type"],
					"civil_hard",
					"apt-ifr-civil",
					"civil_soft",
					"apt-civil-unpaved",
					"seaplane",
					"apt-seaplane",
					"military",
					"apt-ifr-military",
					"private",
					"apt-private",
					"seaplane_private",
					"apt-seaplane",
					"heliport",
					"apt-helipad",
					"ultralight",
					"apt-ultralight",
					"gliderport",
					"apt-gliderport",
					"balloonport",
					"apt-balloonport",
					"apt-ifr-civil", // default/fallback
				] as unknown as maplibregl.ExpressionSpecification,
				"icon-size": [
					"interpolate",
					["linear"],
					["zoom"],
					4,
					0.5,
					8,
					0.8,
				] as unknown as maplibregl.ExpressionSpecification,
				"icon-allow-overlap": true,
				"icon-ignore-placement": false,
				"text-field": ["get", "id"],
				"text-font": ["Open Sans Bold", "Arial Unicode MS Regular"],
				"text-size": [
					"interpolate",
					["linear"],
					["zoom"],
					4,
					9,
					8,
					12,
				] as unknown as maplibregl.ExpressionSpecification,
				"text-offset": [
					"interpolate",
					["linear"],
					["zoom"],
					4,
					["literal", [0, 0.7]],
					8,
					["literal", [0, 1.2]],
				] as unknown as maplibregl.ExpressionSpecification,
				"text-anchor": "top",
				"text-allow-overlap": false,
				"text-ignore-placement": false,
				"text-optional": true,
				"text-padding": 2,
				"symbol-sort-key": [
					"+",
					["*", ["to-number", ["get", "rank"], 5], 100],
					[
						"match",
						["get", "facility_type"],
						"civil_hard",
						1,
						"civil_soft",
						2,
						"military",
						3,
						"seaplane",
						4,
						"heliport",
						5,
						"private",
						6,
						"seaplane_private",
						7,
						"ultralight",
						8,
						"gliderport",
						9,
						"balloonport",
						10,
						11,
					],
				] as unknown as maplibregl.ExpressionSpecification,
			}),
			[],
		);

	const airportSymbolPaint: maplibregl.SymbolLayerSpecification["paint"] =
		useMemo(
			() => ({
				"text-color": crimson.crimson9,
				"text-halo-color": haloColor,
				"text-halo-width": 1.5,
			}),
			[haloColor],
		);

	const airspaceLabelLayout: maplibregl.SymbolLayerSpecification["layout"] =
		useMemo(
			() => ({
				"text-field": [
					"concat",
					[
						"case",
						["==", ["get", "is_sua"], true],
						["get", "name"],
						[
							"match",
							["get", "airspace_class"],
							"MODE_C",
							"MODE C",
							["coalesce", ["get", "airspace_class"], ["get", "type"]],
						],
					],

					"/",
					["get", "lower_limit"],
					"-",
					["get", "upper_limit"],
				] as unknown as maplibregl.ExpressionSpecification,
				"text-font": ["Open Sans Bold", "Arial Unicode MS Regular"],
				"text-size": 12,
				"symbol-placement": "line",
				"text-keep-upright": true,
				"text-max-angle": 30,
				"text-allow-overlap": false,
				"text-ignore-placement": false,
				"symbol-spacing": 350,
				"text-offset": [0, 1],
			}),
			[],
		);

	const boundaryLabelLayout: maplibregl.SymbolLayerSpecification["layout"] =
		useMemo(
			() => ({
				"text-field": [
					"concat",
					[
						"case",
						["!=", ["coalesce", ["get", "name"], ""], ""],
						["get", "name"],
						["!=", ["coalesce", ["get", "ident"], ""], ""],
						["get", "ident"],
						["coalesce", ["get", "type"], ""],
					],
					[
						"case",
						[
							"all",
							[
								"!=",
								["to-string", ["coalesce", ["get", "lower_limit"], ""]],
								"",
							],
							[
								"!=",
								["to-string", ["coalesce", ["get", "lower_limit"], ""]],
								"-9998",
							],
							[
								"!=",
								["to-string", ["coalesce", ["get", "upper_limit"], ""]],
								"",
							],
							[
								"!=",
								["to-string", ["coalesce", ["get", "upper_limit"], ""]],
								"-9998",
							],
						],
						[
							"concat",
							"/",
							["to-string", ["get", "lower_limit"]],
							"-",
							["to-string", ["get", "upper_limit"]],
						],
						[
							"all",
							[
								"!=",
								["to-string", ["coalesce", ["get", "lower_limit"], ""]],
								"",
							],
							[
								"!=",
								["to-string", ["coalesce", ["get", "lower_limit"], ""]],
								"-9998",
							],
						],
						["concat", "/", ["to-string", ["get", "lower_limit"]]],
						[
							"all",
							[
								"!=",
								["to-string", ["coalesce", ["get", "upper_limit"], ""]],
								"",
							],
							[
								"!=",
								["to-string", ["coalesce", ["get", "upper_limit"], ""]],
								"-9998",
							],
						],
						["concat", "/", ["to-string", ["get", "upper_limit"]]],
						"",
					],
				] as unknown as maplibregl.ExpressionSpecification,
				"text-font": ["Open Sans Bold", "Arial Unicode MS Regular"],
				"text-size": 11,
				"symbol-placement": "line",
				"text-keep-upright": true,
				"text-max-angle": 30,
				"text-allow-overlap": false,
				"text-ignore-placement": false,
				"symbol-spacing": 400,
				"text-offset": [0, 1],
			}),
			[],
		);

	const getZoomRankFilter = (
		baseZooms: Record<number, number>,
	): maplibregl.ExpressionSpecification => {
		const zooms = Object.keys(baseZooms)
			.map(Number)
			.sort((a, b) => a - b);
		const initialRank = baseZooms[zooms[0]] + aeronauticalLayers.declutterLevel;

		const stepExpr: unknown[] = [
			"step",
			["zoom"],
			Math.min(6, Math.max(1, initialRank)),
		];
		for (let i = 1; i < zooms.length; i++) {
			const z = zooms[i];
			const maxRank = baseZooms[z] + aeronauticalLayers.declutterLevel;
			stepExpr.push(z);
			stepExpr.push(Math.min(6, Math.max(1, maxRank)));
		}

		return [
			"<=",
			["to-number", ["get", "rank"], 5],
			stepExpr,
		] as unknown as maplibregl.ExpressionSpecification;
	};

	const showRunways =
		aeronauticalLayers.showAirportsMaster &&
		(aeronauticalLayers.publicAirports ||
			aeronauticalLayers.privateAirports ||
			aeronauticalLayers.heliports ||
			aeronauticalLayers.otherAirports);

	const getZoom = (baseZoom: number) => {
		return Math.max(0, baseZoom - aeronauticalLayers.declutterLevel);
	};

	const highlightData = useMemo(() => {
		const rawFeatures = aeronauticalLayers.showAll
			? selectedFeatures?.features || []
			: [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const features = rawFeatures.map((f: any) => ({
			type: "Feature",
			geometry: f.geometry,
			properties: f.properties,
			id: f.id,
		}));

		return {
			type: "FeatureCollection",
			features: features,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
	}, [aeronauticalLayers.showAll, selectedFeatures]);

	return (
		<ReactMap
			canvasContextAttributes={CANVAS_CONTEXT_ATTRIBUTES}
			onLoad={onMapLoad}
			onStyleData={onStyleData}
			onMouseMove={onMouseMove}
			onMove={onMove}
			onMouseLeave={onMouseLeave}
			onClick={onMapClick}
			onContextMenu={onMapContextMenu}
			interactiveLayerIds={
				aeronauticalLayers.showAll ? interactiveLayerIds : []
			}
			initialViewState={INITIAL_VIEW_STATE}
			maxPitch={85}
			// projection={{ type: 'globe' }}
			mapStyle={mapStyle}
			styleDiffing={false}
			style={MAP_CONTAINER_STYLE}
			hash={true}
			mapLib={maplibregl}
			terrain={
				showTerrain
					? TERRAIN_SPEC
					: (null as unknown as maplibregl.TerrainSpecification)
			}
		>
			<NavigationControl position="bottom-right" visualizePitch={true} />

			{/* Feature Sidebar (Left) */}
			{aeronauticalLayers.showAll && selectedFeatures && (
				<Box className="map-feature-panel desktop-only">
					<Card
						size="2"
						style={{
							width: "100%",
							height: "100%",
							backgroundColor: "transparent", // Handled by CSS class
							boxShadow: "none", // Handled by CSS class
							overflowY: "auto",
						}}
					>
						<Flex direction="column" gap="4">
							<Flex align="center" justify="between">
								<Heading size="3">Map Features</Heading>
								<IconButton
									size="2"
									variant="ghost"
									onClick={() => setSelectedFeatures(null)}
									title="Close Information"
								>
									<X size={18} />
								</IconButton>
							</Flex>

							<Text size="1" color={grayColor}>
								{selectedFeatures.lngLat[1].toFixed(5)},{" "}
								{selectedFeatures.lngLat[0].toFixed(5)}
							</Text>

							<Separator size="4" />

							<FeatureList features={selectedFeatures.features} />
						</Flex>
					</Card>
				</Box>
			)}

			{/* Permanent Invisible Anchor Layers for Deterministic Z-Order & Symbol Collision Priority */}
			<Layer
				id="anchor-dimmer"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-highlight"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-grid-mora"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-boundaries"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-boundary-cta"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-boundary-special"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-vfr-infra"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-diagrams"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airspaces"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airspace-mode-c"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airspace-pja"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airspace-trsa"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airspace-sua"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airspace-controlled"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-mtrs"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airways"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-obstacles"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-mountain-passes"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-waypoints"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-vfr-waypoints"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-navaids"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airports"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airports-heliport"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airports-private"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-airports-public"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-flight-plan"
				type="background"
				layout={{ visibility: "none" }}
			/>
			<Layer
				id="anchor-top"
				type="background"
				layout={{ visibility: "none" }}
			/>

			{/* 3D Terrain & Hillshade (separate raster-dem sources) */}
			{showTerrain && (
				<>
					<Source
						id="terrain"
						type="raster-dem"
						tiles={["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"]}
						tileSize={512}
						encoding="terrarium"
					/>
					<Source
						id="terrain-hillshade"
						type="raster-dem"
						tiles={["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"]}
						tileSize={512}
						encoding="terrarium"
					/>
				</>
			)}

			{/* Basemap Dimmer */}
			<Source
				id="basemap-dimmer-source"
				type="geojson"
				data={BASEMAP_DIMMER_DATA}
			>
				<Layer
					id="basemap-dimmer-layer"
					type="fill"
					beforeId="anchor-highlight"
					paint={{
						"fill-color": "#000000",
						"fill-opacity": 1 - basemapBrightness / 100,
					}}
				/>
			</Source>

			{/* 3D Terrain Shading Material */}
			{showTerrain && (
				<Layer
					id="hillshade-layer"
					type="hillshade"
					source="terrain-hillshade"
					beforeId="anchor-dimmer"
					paint={{
						"hillshade-exaggeration": 0.8,
						"hillshade-shadow-color": isDarkMap
							? "rgba(0, 0, 0, 0.6)"
							: "rgba(0, 0, 0, 0.2)",
						"hillshade-highlight-color": isDarkMap
							? "rgba(255, 255, 255, 0.15)"
							: "rgba(255, 255, 255, 0.4)",
						"hillshade-accent-color": "rgba(0, 0, 0, 0.3)",
					}}
				/>
			)}

			{/* Selected Feature Highlight */}
			<Source id="highlight-source" type="geojson" data={highlightData}>
				<Layer
					id="highlight-point"
					type="circle"
					beforeId="anchor-grid-mora"
					filter={["==", "$type", "Point"]}
					paint={{
						"circle-radius": 18,
						"circle-color": "#ffffff",
						"circle-opacity": 0.3,
						"circle-blur": 0.2,
					}}
				/>
				<Layer
					id="highlight-line"
					type="line"
					beforeId="anchor-grid-mora"
					filter={["in", "$type", "LineString", "Polygon"]}
					paint={{
						"line-color": "#ffffff",
						"line-width": 6,
						"line-opacity": 0.4,
						"line-blur": 1,
					}}
				/>
			</Source>

			{/* Aeronautical Data — separate PMTiles sources for optimal zoom ranges */}
			{aeronauticalLayers.showAll && (
				<>
					<Source
						id="src-airspaces"
						type="vector"
						url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}airspaces.pmtiles`}
						attribution={`FAA NFDC CIFP/DOF${cycle ? ` (Cycle ${cycle})` : ""}`}
					/>
					<Source
						id="src-enroute"
						type="vector"
						url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}enroute.pmtiles`}
						attribution={`FAA NFDC CIFP/DOF${cycle ? ` (Cycle ${cycle})` : ""}`}
					/>
					<Source
						id="src-boundary"
						type="vector"
						url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}boundary.pmtiles`}
						attribution={`FAA NFDC CIFP/DOF${cycle ? ` (Cycle ${cycle})` : ""}`}
					/>
					<Source
						id="src-airports-navaids"
						type="vector"
						url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}airports_navaids.pmtiles`}
						attribution={`FAA NFDC CIFP/DOF${cycle ? ` (Cycle ${cycle})` : ""}`}
					/>
					<Source
						id="src-waypoints-obstacles"
						type="vector"
						url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}waypoints_obstacles.pmtiles`}
						attribution={`FAA NFDC CIFP/DOF${cycle ? ` (Cycle ${cycle})` : ""}`}
					/>
					<Source
						id="src-diagrams"
						type="vector"
						url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}airport_diagrams.pmtiles`}
						attribution={`FAA NFDC CIFP/DOF${cycle ? ` (Cycle ${cycle})` : ""}`}
					/>
					<Source
						id="src-vfr"
						type="vector"
						url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}vfr.pmtiles`}
						attribution={`FAA NASR/ADDS/USWTDB/HIFLD/OSM${cycle ? ` (Cycle ${cycle})` : ""}`}
					/>
				</>
			)}
			{hasMountedAirspaceOverlay && (
				<AirspaceOverlay
					visible={show3dAirspace}
					layers={aeronauticalLayers}
					showTerrain={showTerrain}
				/>
			)}
			{aeronauticalLayers.showAll && (
				<>
					{/* Grid MORA */}
					{aeronauticalLayers.gridMora && (
						<>
							<Layer
								id="grid-mora-lines"
								type="line"
								source="src-enroute"
								source-layer="grid_mora_lines"
								beforeId="anchor-boundaries"
								paint={{
									"line-color": [
										"case",
										["boolean", ["get", "is_high"], false],
										isDarkMap ? crimsonDark.crimson9 : crimson.crimson9,
										isDarkMap ? tealDark.teal9 : teal.teal9,
									] as unknown as maplibregl.ExpressionSpecification,
									"line-width": 1,
									"line-opacity": 0.35,
								}}
							/>
							<Layer
								id="grid-mora-labels"
								type="symbol"
								source="src-enroute"
								source-layer="grid_mora_labels"
								beforeId="anchor-boundaries"
								minzoom={4}
								layout={{
									"text-field": [
										"format",
										["to-string", ["coalesce", ["get", "thousands"], ""]],
										{ "font-scale": 1.0 },
										["to-string", ["coalesce", ["get", "hundreds"], ""]],
										{ "font-scale": 0.65, "vertical-align": "top" },
									] as unknown as maplibregl.ExpressionSpecification,
									"text-font": ["Open Sans Bold", "Arial Unicode MS Regular"],
									"text-size": [
										"interpolate",
										["linear"],
										["zoom"],
										4,
										11,
										8,
										15,
									] as unknown as maplibregl.ExpressionSpecification,
									"text-allow-overlap": false,
									"text-ignore-placement": false,
								}}
								paint={{
									"text-color": [
										"case",
										["boolean", ["get", "is_high"], false],
										isDarkMap ? crimsonDark.crimson11 : crimson.crimson11,
										isDarkMap ? tealDark.teal11 : teal.teal11,
									] as unknown as maplibregl.ExpressionSpecification,
									"text-halo-color": haloColor,
									"text-halo-width": 1.5,
								}}
							/>
						</>
					)}

					{/* Boundaries (ARTCC / FIR, CTA / ACC, Special Rules / ADIZ) */}
					{aeronauticalLayers.showArtccMaster && (
						<>
							{aeronauticalLayers.artccFirs && (
								<>
									<Layer
										id="boundary-artcc-hit"
										type="line"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-boundary-cta"
										filter={[
											"all",
											["!=", ["get", "local_type"], "ARTCC_H"],
											["!=", ["get", "type"], "TRSA"],
											["!=", ["get", "type"], "CLASS"],
											[
												"any",
												[
													"in",
													["get", "type"],
													["literal", ["ARTCC", "FIR", "OCA", "UTA"]],
												],
												[
													"all",
													["==", ["get", "type"], "CTA"],
													["==", ["get", "local_type"], "ARTCC"],
												],
											],
										]}
										paint={{ "line-width": 8, "line-opacity": 0 }}
									/>
									<Layer
										id="boundary-artcc-line"
										type="line"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-boundary-cta"
										filter={[
											"all",
											["!=", ["get", "local_type"], "ARTCC_H"],
											["!=", ["get", "type"], "TRSA"],
											["!=", ["get", "type"], "CLASS"],
											[
												"any",
												[
													"in",
													["get", "type"],
													["literal", ["ARTCC", "FIR", "OCA", "UTA"]],
												],
												[
													"all",
													["==", ["get", "type"], "CTA"],
													["==", ["get", "local_type"], "ARTCC"],
												],
											],
										]}
										paint={{
											"line-color": getAirspaceColor("ARTCC"),
											"line-width": 1.2,
											"line-dasharray": [6, 3],
											"line-opacity": 0.75,
										}}
									/>
									<Layer
										id="boundary-artcc-label"
										type="symbol"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-boundary-cta"
										minzoom={4}
										filter={[
											"all",
											["!=", ["get", "local_type"], "ARTCC_H"],
											["!=", ["get", "type"], "TRSA"],
											["!=", ["get", "type"], "CLASS"],
											[
												"any",
												[
													"in",
													["get", "type"],
													["literal", ["ARTCC", "FIR", "OCA", "UTA"]],
												],
												[
													"all",
													["==", ["get", "type"], "CTA"],
													["==", ["get", "local_type"], "ARTCC"],
												],
											],
										]}
										layout={boundaryLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor(
												"ARTCC",
												false,
												isDarkMap,
											),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
							{aeronauticalLayers.ctaAcc && (
								<>
									<Layer
										id="boundary-cta-hit"
										type="line"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-boundary-special"
										filter={[
											"all",
											[
												"in",
												["get", "type"],
												["literal", ["CTA", "CTA-P", "ACC"]],
											],
											["!=", ["get", "local_type"], "ARTCC"],
										]}
										paint={{ "line-width": 8, "line-opacity": 0 }}
									/>
									<Layer
										id="boundary-cta-line"
										type="line"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-boundary-special"
										filter={[
											"all",
											[
												"in",
												["get", "type"],
												["literal", ["CTA", "CTA-P", "ACC"]],
											],
											["!=", ["get", "local_type"], "ARTCC"],
										]}
										paint={{
											"line-color": isDarkMap
												? getAirspaceColor("CTA")
												: getAirspaceTextColor("CTA", false, false),
											"line-width": 1.2,
											"line-dasharray": [4, 4],
											"line-opacity": 0.75,
										}}
									/>
									<Layer
										id="boundary-cta-label"
										type="symbol"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-boundary-special"
										minzoom={4}
										filter={[
											"all",
											[
												"in",
												["get", "type"],
												["literal", ["CTA", "CTA-P", "ACC"]],
											],
											["!=", ["get", "local_type"], "ARTCC"],
										]}
										layout={boundaryLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor(
												"CTA",
												false,
												isDarkMap,
											),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
							{aeronauticalLayers.specialRules && (
								<>
									<Layer
										id="boundary-special-rules-hit"
										type="line"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-vfr-infra"
										filter={["==", ["get", "type"], "ADIZ"]}
										paint={{ "line-width": 8, "line-opacity": 0 }}
									/>
									<Layer
										id="boundary-special-rules-fill"
										type="fill"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-vfr-infra"
										filter={[
											"in",
											["get", "type"],
											["literal", ["SATA", "NSA", "DEF"]],
										]}
										paint={{ "fill-opacity": 0 }}
									/>
									<Layer
										id="boundary-special-rules-band"
										type="line"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-vfr-infra"
										filter={[
											"in",
											["get", "type"],
											["literal", ["SATA", "ADIZ", "NSA", "DEF"]],
										]}
										paint={{
											"line-color": getAirspaceColor("SPECIAL_RULES"),
											"line-width": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												4,
												10,
												8,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-opacity": 0.18,
											"line-offset": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												2,
												10,
												4,
											] as unknown as maplibregl.ExpressionSpecification,
										}}
									/>
									<Layer
										id="boundary-special-rules-line"
										type="line"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-vfr-infra"
										filter={[
											"in",
											["get", "type"],
											["literal", ["SATA", "ADIZ", "NSA", "DEF"]],
										]}
										paint={{
											"line-color": getAirspaceColor("SPECIAL_RULES"),
											"line-width": 1.5,
											"line-dasharray": [6, 2, 2, 2],
											"line-opacity": 0.85,
										}}
									/>
									<Layer
										id="boundary-special-rules-label"
										type="symbol"
										source="src-boundary"
										source-layer="boundary_airspace"
										beforeId="anchor-vfr-infra"
										minzoom={4}
										filter={[
											"in",
											["get", "type"],
											["literal", ["SATA", "ADIZ", "NSA", "DEF"]],
										]}
										layout={boundaryLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor(
												"SPECIAL_RULES",
												false,
												isDarkMap,
											),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
						</>
					)}

					{/* VFR Infrastructure (Wind Farms & Powerlines) */}
					{aeronauticalLayers.showVfrMaster && (
						<>
							{aeronauticalLayers.windFarms && (
								<>
									<Layer
										id="wind-farms-fill"
										type="fill"
										source="src-vfr"
										source-layer="wind_farms"
										beforeId="anchor-diagrams"
										minzoom={getZoom(5)}
										filter={getZoomRankFilter({ 0: 2, 7: 3, 9: 6 })}
										paint={{
											"fill-pattern": "pat-wind-farm",
											"fill-opacity": 0.65,
										}}
									/>
									<Layer
										id="wind-farms-outline"
										type="line"
										source="src-vfr"
										source-layer="wind_farms"
										beforeId="anchor-diagrams"
										minzoom={getZoom(5)}
										filter={getZoomRankFilter({ 0: 2, 7: 3, 9: 6 })}
										paint={{
											"line-color": isDarkMap
												? purpleDark.purple9
												: purple.purple9,
											"line-width": 1.2,
											"line-opacity": 0.7,
										}}
									/>
									<Layer
										id="wind-farms-label"
										type="symbol"
										source="src-vfr"
										source-layer="wind_farms"
										beforeId="anchor-diagrams"
										minzoom={getZoom(8)}
										maxzoom={12}
										filter={getZoomRankFilter({ 0: 2, 7: 3, 9: 6 })}
										layout={{
											"text-field": [
												"let",
												"nm",
												["to-string", ["coalesce", ["get", "name"], ""]],
												"amsl",
												["to-number", ["get", "max_amsl_ft"], 0],
												"agl",
												["to-number", ["get", "max_agl_ft"], 0],
												"tip",
												["to-number", ["get", "max_tip_ft"], 0],
												[
													"let",
													"ht",
													[
														"case",
														[
															"all",
															[">", ["var", "amsl"], 0],
															[">", ["var", "agl"], 0],
														],
														[
															"concat",
															["to-string", ["var", "amsl"]],
															" (",
															["to-string", ["var", "agl"]],
															")",
														],
														[">", ["var", "amsl"], 0],
														["concat", ["to-string", ["var", "amsl"]], "'"],
														[">", ["var", "agl"], 0],
														[
															"concat",
															"(",
															["to-string", ["var", "agl"]],
															"' AGL)",
														],
														[">", ["var", "tip"], 0],
														[
															"concat",
															"(",
															["to-string", ["var", "tip"]],
															"' AGL)",
														],
														"",
													],
													[
														"case",
														[
															"all",
															["!=", ["var", "nm"], ""],
															["!=", ["var", "ht"], ""],
														],
														["concat", ["var", "nm"], "\n", ["var", "ht"]],
														["!=", ["var", "nm"], ""],
														["var", "nm"],
														["var", "ht"],
													],
												],
											] as unknown as maplibregl.ExpressionSpecification,
											"text-font": [
												"Open Sans Regular",
												"Arial Unicode MS Regular",
											],
											"text-size": 10,
											"text-allow-overlap": false,
											"text-ignore-placement": false,
											"text-optional": true,
										}}
										paint={{
											"text-color": isDarkMap
												? purpleDark.purple11
												: purple.purple11,
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
							{aeronauticalLayers.powerlines && (
								<>
									<Layer
										id="powerlines-hit"
										type="line"
										source="src-vfr"
										source-layer="powerlines"
										beforeId="anchor-diagrams"
										minzoom={getZoom(6)}
										filter={getZoomRankFilter({ 0: 1, 6: 2, 7: 3, 9: 6 })}
										paint={{ "line-width": 8, "line-opacity": 0 }}
									/>
									<Layer
										id="powerlines-line"
										type="line"
										source="src-vfr"
										source-layer="powerlines"
										beforeId="anchor-diagrams"
										minzoom={getZoom(6)}
										filter={getZoomRankFilter({ 0: 1, 6: 2, 7: 3, 9: 6 })}
										paint={{
											"line-color": isDarkMap ? amberDark.amber9 : amber.amber9,
											"line-width": [
												"interpolate",
												["linear"],
												[
													"to-number",
													["coalesce", ["get", "voltage_kv"], 115],
													115,
												],
												115,
												1,
												500,
												1.6,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-dasharray": [4, 3],
											"line-opacity": 0.55,
										}}
									/>
								</>
							)}
						</>
					)}

					{/* Airports Base */}
					{aeronauticalLayers.showAirportsMaster && (
						<>
							{/* Airport Diagram Polygons (high zoom) */}
							{showRunways && (
								<>
									<Layer
										id="am-taxiways-fill"
										type="fill"
										source="src-diagrams"
										source-layer="am_taxiways"
										beforeId="anchor-airspaces"
										minzoom={9}
										paint={{
											"fill-color": isDarkMap ? "#3a3a4a" : "#bbbbbb",
											"fill-opacity": 0.7,
										}}
									/>
									<Layer
										id="runways-fill"
										type="fill"
										source="src-diagrams"
										source-layer="runways"
										beforeId="anchor-airspaces"
										minzoom={9}
										paint={{
											"fill-color": isDarkMap ? "#555566" : "#666666",
											"fill-opacity": 0.85,
										}}
									/>
									<Layer
										id="runways-outline"
										type="line"
										source="src-diagrams"
										source-layer="runways"
										beforeId="anchor-airspaces"
										minzoom={9}
										paint={{
											"line-color": isDarkMap ? "#777788" : "#444444",
											"line-width": 1,
										}}
									/>
									<Layer
										id="runways-label"
										type="symbol"
										source="src-diagrams"
										source-layer="runway_labels"
										beforeId="anchor-airspaces"
										minzoom={12}
										layout={{
											"text-field": ["get", "label"],
											"text-font": [
												"Open Sans Bold",
												"Arial Unicode MS Regular",
											],
											"text-size": 11,
											"text-allow-overlap": true,
											"symbol-placement": "point",
											// 'text-rotate': ['get', 'bearing'],
											// 'text-rotation-alignment': 'map',
											"text-pitch-alignment": "map",
										}}
										paint={{
											"text-color": isDarkMap ? "#e0e0e0" : "#222222",
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
						</>
					)}
					{/* Airspaces */}
					{aeronauticalLayers.showAirspaceMaster && (
						<>
							{aeronauticalLayers.controlledAirspace && (
								<>
									<Layer
										id="airspaces-class-b-hairline"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "B"],
										]}
										paint={{
											"line-color": getAirspaceColor("B"),
											"line-width": 1,
										}}
									/>
									<Layer
										id="airspaces-class-b"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "B"],
										]}
										paint={{
											"line-color": getAirspaceColor("B"),
											"line-width": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												4,
												10,
												8,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-opacity": 0.2,
											"line-offset": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												2,
												10,
												4,
											] as unknown as maplibregl.ExpressionSpecification,
										}}
									/>
									<Layer
										id="airspaces-class-b-fill"
										type="fill"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "B"],
										]}
										paint={{ "fill-opacity": 0 }}
									/>
									<Layer
										id="airspaces-class-c-hairline"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "C"],
										]}
										paint={{
											"line-color": getAirspaceColor("C"),
											"line-width": 1,
										}} // crimson-9
									/>
									<Layer
										id="airspaces-class-c"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "C"],
										]}
										paint={{
											"line-color": getAirspaceColor("C"),
											"line-width": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												4,
												10,
												8,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-opacity": 0.2,
											"line-offset": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												2,
												10,
												4,
											] as unknown as maplibregl.ExpressionSpecification,
										}} // crimson-9
									/>
									<Layer
										id="airspaces-class-c-fill"
										type="fill"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "C"],
										]}
										paint={{ "fill-opacity": 0 }}
									/>
									<Layer
										id="airspaces-class-d-hairline"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "D"],
										]}
										paint={{
											"line-color": getAirspaceColor("D"),
											"line-width": 1,
											"line-dasharray": [4, 4],
										}}
									/>
									<Layer
										id="airspaces-class-d-fill"
										type="fill"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "D"],
										]}
										paint={{ "fill-opacity": 0 }}
									/>
									<Layer
										id="airspaces-class-d-label"
										type="symbol"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										minzoom={8}
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "D"],
										]}
										layout={airspaceLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor("D", false, isDarkMap),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
									<Layer
										id="airspaces-class-c-label"
										type="symbol"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										minzoom={8}
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "C"],
										]}
										layout={airspaceLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor("C", false, isDarkMap),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
									<Layer
										id="airspaces-class-b-label"
										type="symbol"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-mtrs"
										minzoom={8}
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "B"],
										]}
										layout={airspaceLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor("B", false, isDarkMap),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
							{aeronauticalLayers.suaMoa && (
								<>
									<Layer
										id="airspaces-sua-hairline"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-controlled"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "is_sua"], true],
										]}
										paint={{
											"line-color": getAirspaceColor("SUA", true),
											"line-width": 1,
										}}
									/>
									<Layer
										id="airspaces-sua"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-controlled"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "is_sua"], true],
										]}
										paint={{
											"line-color": getAirspaceColor("SUA", true),
											"line-width": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												4,
												10,
												8,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-opacity": 0.2,
											"line-offset": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												2,
												10,
												4,
											] as unknown as maplibregl.ExpressionSpecification,
										}}
									/>
									<Layer
										id="airspaces-sua-fill"
										type="fill"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-controlled"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "is_sua"], true],
										]}
										paint={{ "fill-opacity": 0 }}
									/>
									<Layer
										id="airspaces-sua-label"
										type="symbol"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-controlled"
										minzoom={8}
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "is_sua"], true],
										]}
										layout={airspaceLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor(
												"SUA",
												true,
												isDarkMap,
											),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
							{aeronauticalLayers.trsa && (
								<>
									<Layer
										id="airspaces-trsa-hairline"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-sua"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "TRSA"],
										]}
										paint={{
											"line-color": getAirspaceColor("TRSA"),
											"line-width": 1,
										}}
									/>
									<Layer
										id="airspaces-trsa"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-sua"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "TRSA"],
										]}
										paint={{
											"line-color": getAirspaceColor("TRSA"),
											"line-width": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												4,
												10,
												8,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-opacity": 0.2,
											"line-offset": [
												"interpolate",
												["linear"],
												["zoom"],
												4,
												2,
												10,
												4,
											] as unknown as maplibregl.ExpressionSpecification,
										}}
									/>
									<Layer
										id="airspaces-trsa-fill"
										type="fill"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-sua"
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "TRSA"],
										]}
										paint={{ "fill-opacity": 0 }}
									/>
									<Layer
										id="airspaces-trsa-label"
										type="symbol"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-sua"
										minzoom={8}
										filter={[
											"all",
											["!=", ["get", "type"], "E"],
											["==", ["get", "airspace_class"], "TRSA"],
										]}
										layout={airspaceLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor(
												"TRSA",
												false,
												isDarkMap,
											),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
							{/* Class E Vignette */}
							{aeronauticalLayers.classE && (
								<>
									<Layer
										id="airspaces-class-e"
										type="line"
										source="src-enroute"
										source-layer="airspaces"
										beforeId="anchor-airspace-mode-c"
										filter={[
											"all",
											["==", ["get", "type"], "E"],
											["!=", ["get", "lower_limit"], "0"],
											["!=", ["get", "lower_limit"], "SFC"],
										]}
										paint={{
											"line-color": getAirspaceColor("E"), // crimson-9
											"line-width": [
												"interpolate",
												["linear"],
												["zoom"],
												2,
												1,
												10,
												12,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-offset": [
												"interpolate",
												["linear"],
												["zoom"],
												2,
												0.5,
												10,
												6,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-opacity": 0.1,
										}}
									/>
									{/* E2 (from surface)*/}
									<Layer
										id="airspaces-class-e-hairline"
										type="line"
										source="src-enroute"
										source-layer="airspaces"
										beforeId="anchor-airspace-mode-c"
										filter={[
											"all",
											["==", ["get", "type"], "E"],
											[
												"any",
												["==", ["get", "lower_limit"], "0"],
												["==", ["get", "lower_limit"], "SFC"],
											],
										]}
										paint={{
											"line-color": getAirspaceColor("E"), // crimson-9
											"line-width": 1,
											"line-offset": 1,
											"line-dasharray": [8, 8],
										}}
									/>
									<Layer
										id="airspaces-class-e-fill"
										type="fill"
										source="src-enroute"
										source-layer="airspaces"
										beforeId="anchor-airspace-mode-c"
										filter={["==", ["get", "type"], "E"]}
										paint={{ "fill-opacity": 0 }}
									/>
									<Layer
										id="airspaces-class-e-label"
										type="symbol"
										source="src-enroute"
										source-layer="airspaces"
										beforeId="anchor-airspace-mode-c"
										minzoom={8}
										filter={[
											"all",
											["==", ["get", "type"], "E"],
											[
												"any",
												["==", ["get", "lower_limit"], "0"],
												["==", ["get", "lower_limit"], "SFC"],
											],
										]}
										layout={airspaceLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor("E", false, isDarkMap),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
							{/* Mode C Veils */}
							{aeronauticalLayers.modeC && (
								<>
									<Layer
										id="airspaces-mode-c-hit"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-pja"
										filter={["==", ["get", "airspace_class"], "MODE_C"]}
										paint={{ "line-width": 8, "line-opacity": 0 }}
									/>
									<Layer
										id="airspaces-mode-c"
										type="line"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-pja"
										filter={["==", ["get", "airspace_class"], "MODE_C"]}
										paint={{
											"line-color": getAirspaceColor("MODE_C"),
											"line-width": 1.2,
											"line-opacity": 0.8,
										}}
									/>
									<Layer
										id="airspaces-mode-c-label"
										type="symbol"
										source="src-airspaces"
										source-layer="airspaces"
										beforeId="anchor-airspace-pja"
										minzoom={8}
										filter={["==", ["get", "airspace_class"], "MODE_C"]}
										layout={airspaceLabelLayout}
										paint={{
											"text-color": getAirspaceTextColor(
												"MODE_C",
												false,
												isDarkMap,
											),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
							{/* Parachute Jump Areas */}
							{aeronauticalLayers.parachuteArea && (
								<>
									<Layer
										id="parachute-areas-fill"
										type="fill"
										source="src-waypoints-obstacles"
										source-layer="parachute_areas"
										beforeId="anchor-airspace-trsa"
										paint={{ "fill-opacity": 0 }}
									/>
									<Layer
										id="parachute-areas-band"
										type="line"
										source="src-waypoints-obstacles"
										source-layer="parachute_areas"
										beforeId="anchor-airspace-trsa"
										paint={{
											"line-color": getAirspaceColor("PARACHUTE"),
											"line-width": [
												"interpolate",
												["linear"],
												["zoom"],
												6,
												3,
												11,
												6,
											] as unknown as maplibregl.ExpressionSpecification,
											"line-opacity": 0.2,
											"line-offset": [
												"interpolate",
												["linear"],
												["zoom"],
												6,
												1.5,
												11,
												3,
											] as unknown as maplibregl.ExpressionSpecification,
										}}
									/>
									<Layer
										id="parachute-areas"
										type="line"
										source="src-waypoints-obstacles"
										source-layer="parachute_areas"
										beforeId="anchor-airspace-trsa"
										paint={{
											"line-color": getAirspaceColor("PARACHUTE"),
											"line-width": 1.3,
											"line-dasharray": [4, 3],
										}}
									/>
									<Layer
										id="parachute-areas-label"
										type="symbol"
										source="src-waypoints-obstacles"
										source-layer="parachute_areas"
										beforeId="anchor-airspace-trsa"
										minzoom={9}
										layout={{
											"text-field": [
												"concat",
												"PJA ",
												[
													"case",
													["!=", ["coalesce", ["get", "name"], ""], ""],
													["get", "name"],
													["!=", ["coalesce", ["get", "ident"], ""], ""],
													["get", "ident"],
													"",
												],
												[
													"let",
													"alt",
													["to-string", ["coalesce", ["get", "max_alt"], ""]],
													[
														"case",
														["==", ["var", "alt"], ""],
														"",
														[
															"all",
															[">", ["length", ["var", "alt"]], 4],
															[
																"==",
																[
																	"slice",
																	["var", "alt"],
																	["-", ["length", ["var", "alt"]], 4],
																],
																" MSL",
															],
														],
														[
															"concat",
															"/",
															[
																"slice",
																["var", "alt"],
																0,
																["-", ["length", ["var", "alt"]], 4],
															],
														],
														["concat", "/", ["var", "alt"]],
													],
												],
											] as unknown as maplibregl.ExpressionSpecification,
											"text-font": [
												"Open Sans Bold",
												"Arial Unicode MS Regular",
											],
											"text-size": [
												"interpolate",
												["linear"],
												["zoom"],
												9,
												9,
												12,
												11,
											] as unknown as maplibregl.ExpressionSpecification,
											"symbol-placement": "line",
											"text-keep-upright": true,
											"text-max-angle": 55,
											"text-allow-overlap": false,
											"text-ignore-placement": false,
											"symbol-spacing": 180,
											"text-offset": [0, 1],
										}}
										paint={{
											"text-color": getAirspaceTextColor(
												"PARACHUTE",
												false,
												isDarkMap,
											),
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								</>
							)}
						</>
					)}

					{/* Military Training Routes (MTRs) */}
					{aeronauticalLayers.showVfrMaster && aeronauticalLayers.mtrs && (
						<>
							<Layer
								id="mtr-corridors-fill"
								type="fill"
								source="src-vfr"
								source-layer="mtr_corridors"
								beforeId="anchor-airways"
								minzoom={getZoom(6)}
								filter={getZoomRankFilter({ 0: 2, 4: 3, 6: 6 })}
								paint={{
									"fill-color": [
										"match",
										["get", "mtr_type"],
										"IR",
										isDarkMap ? indigoDark.indigo9 : indigo.indigo9,
										"VR",
										isDarkMap ? amberDark.amber9 : amber.amber9,
										"SR",
										isDarkMap ? tealDark.teal9 : teal.teal9,
										isDarkMap ? slateDark.slate9 : slate.slate9,
									] as unknown as maplibregl.ExpressionSpecification,
									"fill-opacity": 0.08,
								}}
							/>
							<Layer
								id="mtr-hit"
								type="line"
								source="src-vfr"
								source-layer="mtrs"
								beforeId="anchor-airways"
								minzoom={getZoom(4)}
								filter={getZoomRankFilter({ 0: 2, 4: 3, 6: 6 })}
								paint={{ "line-width": 10, "line-opacity": 0 }}
							/>
							<Layer
								id="mtr-lines"
								type="line"
								source="src-vfr"
								source-layer="mtrs"
								beforeId="anchor-airways"
								minzoom={getZoom(4)}
								filter={getZoomRankFilter({ 0: 2, 4: 3, 6: 6 })}
								paint={{
									"line-color": [
										"match",
										["get", "mtr_type"],
										"IR",
										isDarkMap ? indigoDark.indigo9 : indigo.indigo9,
										"VR",
										isDarkMap ? amberDark.amber9 : amber.amber9,
										"SR",
										isDarkMap ? tealDark.teal9 : teal.teal9,
										isDarkMap ? slateDark.slate9 : slate.slate9,
									] as unknown as maplibregl.ExpressionSpecification,
									"line-width": 1.4,
									"line-dasharray": [6, 3],
									"line-opacity": 0.75,
								}}
							/>
							<Layer
								id="mtr-labels"
								type="symbol"
								source="src-vfr"
								source-layer="mtrs"
								beforeId="anchor-airways"
								minzoom={getZoom(6)}
								filter={getZoomRankFilter({ 0: 2, 4: 3, 6: 6 })}
								layout={{
									"symbol-placement": "line",
									"symbol-spacing": 250,
									"text-field": [
										"let",
										"rid",
										[
											"case",
											["!=", ["coalesce", ["get", "route_id"], ""], ""],
											["to-string", ["get", "route_id"]],
											["!=", ["coalesce", ["get", "name"], ""], ""],
											["to-string", ["get", "name"]],
											["to-string", ["coalesce", ["get", "ident"], ""]],
										],
										"lo",
										["to-string", ["coalesce", ["get", "lower_alt"], ""]],
										"hi",
										["to-string", ["coalesce", ["get", "upper_alt"], ""]],
										[
											"concat",
											["var", "rid"],
											[
												"case",
												[
													"all",
													["!=", ["var", "lo"], ""],
													["!=", ["var", "lo"], "-9998"],
													["!=", ["var", "hi"], ""],
													["!=", ["var", "hi"], "-9998"],
												],
												["concat", " ", ["var", "lo"], "-", ["var", "hi"]],
												[
													"all",
													["!=", ["var", "lo"], ""],
													["!=", ["var", "lo"], "-9998"],
												],
												["concat", " ", ["var", "lo"]],
												[
													"all",
													["!=", ["var", "hi"], ""],
													["!=", ["var", "hi"], "-9998"],
												],
												["concat", " ", ["var", "hi"]],
												"",
											],
										],
									] as unknown as maplibregl.ExpressionSpecification,
									"text-font": ["Open Sans Bold", "Arial Unicode MS Regular"],
									"text-size": 10,
									"text-keep-upright": true,
									"text-max-angle": 30,
									"text-allow-overlap": false,
									"text-ignore-placement": false,
								}}
								paint={{
									"text-color": [
										"match",
										["get", "mtr_type"],
										"IR",
										isDarkMap ? indigoDark.indigo11 : indigo.indigo11,
										"VR",
										isDarkMap ? amberDark.amber11 : amber.amber11,
										"SR",
										isDarkMap ? tealDark.teal11 : teal.teal11,
										isDarkMap ? slateDark.slate11 : slate.slate11,
									] as unknown as maplibregl.ExpressionSpecification,
									"text-halo-color": haloColor,
									"text-halo-width": 1.5,
								}}
							/>
						</>
					)}

					{/* Airways */}
					{aeronauticalLayers.showAirwaysMaster && (
						<>
							{aeronauticalLayers.enrouteLow && (
								<>
									<Layer
										id="airways-low-line"
										type="line"
										source="src-enroute"
										source-layer="airways"
										beforeId="anchor-obstacles"
										filter={["==", ["get", "structure"], "Low"]}
										paint={airwayLinePaint}
									/>
									{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
									<Layer
										id="airways-low-symbol"
										type="symbol"
										source="src-enroute"
										source-layer="airways"
										beforeId="anchor-obstacles"
										minzoom={getZoom(6)}
										filter={["==", ["get", "structure"], "Low"]}
										layout={
											{
												...airwaySymbolLayout,
												"symbol-sort-key": 20,
											} as any
										}
										paint={airwaySymbolPaint}
									/>
									{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
									<Layer
										id="airways-low-mea"
										type="symbol"
										source="src-enroute"
										source-layer="airways"
										beforeId="anchor-obstacles"
										minzoom={getZoom(6)}
										filter={["==", ["get", "structure"], "Low"]}
										layout={
											{ ...airwayMeaLayout, "symbol-sort-key": 21 } as any
										}
										paint={airwayDetailPaint}
									/>
									{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
									<Layer
										id="airways-low-dist"
										type="symbol"
										source="src-enroute"
										source-layer="airways"
										beforeId="anchor-obstacles"
										minzoom={getZoom(6)}
										filter={["==", ["get", "structure"], "Low"]}
										layout={
											{ ...airwayDistLayout, "symbol-sort-key": 21 } as any
										}
										paint={airwayDetailPaint}
									/>
								</>
							)}
							{aeronauticalLayers.enrouteHigh && (
								<>
									<Layer
										id="airways-high-line"
										type="line"
										source="src-enroute"
										source-layer="airways"
										beforeId="anchor-obstacles"
										filter={["==", ["get", "structure"], "High"]}
										paint={airwayLinePaint}
									/>
									{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
									<Layer
										id="airways-high-symbol"
										type="symbol"
										source="src-enroute"
										source-layer="airways"
										beforeId="anchor-obstacles"
										minzoom={getZoom(6)}
										filter={["==", ["get", "structure"], "High"]}
										layout={
											{
												...airwaySymbolLayout,
												"symbol-sort-key": 20,
											} as any
										}
										paint={airwaySymbolPaint}
									/>
									{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
									<Layer
										id="airways-high-mea"
										type="symbol"
										source="src-enroute"
										source-layer="airways"
										beforeId="anchor-obstacles"
										minzoom={getZoom(6)}
										filter={["==", ["get", "structure"], "High"]}
										layout={
											{ ...airwayMeaLayout, "symbol-sort-key": 21 } as any
										}
										paint={airwayDetailPaint}
									/>
									{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
									<Layer
										id="airways-high-dist"
										type="symbol"
										source="src-enroute"
										source-layer="airways"
										beforeId="anchor-obstacles"
										minzoom={getZoom(6)}
										filter={["==", ["get", "structure"], "High"]}
										layout={
											{ ...airwayDistLayout, "symbol-sort-key": 21 } as any
										}
										paint={airwayDetailPaint}
									/>
								</>
							)}
						</>
					)}

					{/* Obstacles (DOF) */}
					{aeronauticalLayers.obstacles && (
						<Layer
							id="obstacles-symbol"
							type="symbol"
							source="src-waypoints-obstacles"
							source-layer="obstacles"
							beforeId="anchor-mountain-passes"
							minzoom={10}
							filter={getZoomRankFilter({ 0: 0, 7: 2, 9: 3, 11: 6 })}
							layout={{
								"icon-image": [
									"case",
									["==", ["get", "type"], "WINDMILL"],
									"obs-wind-turbine",
									["==", ["get", "lighting"], "R"],
									"obs-major-lit", // Simplified for now, could be minor-lit
									[">=", ["to-number", ["get", "agl"], 0], 1000],
									"obs-major",
									"obs-minor",
								] as unknown as maplibregl.ExpressionSpecification,
								"icon-size": [
									"interpolate",
									["linear"],
									["zoom"],
									7,
									0.35,
									12,
									0.6,
								] as unknown as maplibregl.ExpressionSpecification,
								"icon-allow-overlap": false,
								"icon-ignore-placement": false,
								"icon-padding": 2,
								"text-field": [
									"step",
									["zoom"],
									"", // no label below z10
									10,
									["concat", ["to-string", ["get", "agl"]], "'"],
								] as unknown as maplibregl.ExpressionSpecification,
								"text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
								"text-size": 9,
								"text-offset": [0, 1.2],
								"text-anchor": "top",
								"text-allow-overlap": false,
								"text-optional": true,
								"symbol-sort-key": [
									"+",
									100,
									["to-number", ["get", "agl"], 0],
								] as unknown as maplibregl.ExpressionSpecification,
							}}
							paint={{
								"text-color": obstacleTextColor,
								"text-halo-color": haloColor,
								"text-halo-width": 1,
							}}
						/>
					)}

					{/* Mountain Passes */}
					{aeronauticalLayers.showVfrMaster &&
						aeronauticalLayers.mountainPasses && (
							<Layer
								id="mountain-passes-symbol"
								type="symbol"
								source="src-vfr"
								source-layer="mountain_passes"
								beforeId="anchor-waypoints"
								minzoom={getZoom(7)}
								filter={getZoomRankFilter({ 0: 1, 7: 3, 9: 6 })}
								layout={{
									"icon-image": "pass-mountain",
									"icon-size": 0.65,
									"icon-allow-overlap": false,
									"icon-ignore-placement": false,
									"icon-padding": 2,
									"text-field": [
										"let",
										"nm",
										["to-string", ["coalesce", ["get", "name"], ""]],
										"hasElev",
										[
											"all",
											["has", "elev_ft"],
											["!=", ["get", "elev_ft"], null],
											["!=", ["to-string", ["get", "elev_ft"]], ""],
										],
										"elev",
										["to-string", ["to-number", ["get", "elev_ft"], 0]],
										[
											"case",
											["all", ["!=", ["var", "nm"], ""], ["var", "hasElev"]],
											["concat", ["var", "nm"], "\n", ["var", "elev"], "'"],
											["!=", ["var", "nm"], ""],
											["var", "nm"],
											["var", "hasElev"],
											["concat", ["var", "elev"], "'"],
											"",
										],
									] as unknown as maplibregl.ExpressionSpecification,
									"text-font": [
										"Open Sans Regular",
										"Arial Unicode MS Regular",
									],
									"text-size": 10,
									"text-offset": [0, 1.1],
									"text-anchor": "top",
									"text-allow-overlap": false,
									"text-ignore-placement": false,
									"text-optional": true,
								}}
								paint={{
									"text-color": isDarkMap ? brownDark.brown11 : brown.brown11,
									"text-halo-color": haloColor,
									"text-halo-width": 1.5,
								}}
							/>
						)}

					{/* Localizers */}
					{/* {aeronauticalLayers.showAirportsMaster && aeronauticalLayers.publicAirports && (
            <Layer
              id="localizers-symbol"
              type="symbol"
              source="src-airports-navaids"
              source-layer="localizers"
              minzoom={9}
              layout={{
                'icon-image': 'nav-vor',
                'icon-size': 0.5,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'text-field': ['get', 'ident'],
                'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                'text-size': 9,
                'text-offset': [1, 0],
                'text-anchor': 'left',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'symbol-sort-key': 30
              }}
              paint={{
                'text-color': textColor,
                'text-halo-color': haloColor,
                'text-halo-width': 1
              }}
            />
          )} */}

					{/* Waypoints */}
					{aeronauticalLayers.showWaypointsMaster &&
						aeronauticalLayers.waypoints && (
							<Layer
								id="waypoints-symbol"
								type="symbol"
								source="src-waypoints-obstacles"
								source-layer="waypoints"
								beforeId="anchor-vfr-waypoints"
								minzoom={getZoom(4)}
								filter={
									(aeronauticalLayers.waypointUsage === "all"
										? [
												"all",
												["!=", ["get", "type"], "vfr"],
												getZoomRankFilter({ 0: 2, 5: 3, 7: 4, 9: 6 }),
											]
										: [
												"all",
												["!=", ["get", "type"], "vfr"],
												[
													"in",
													["get", "usage"],
													[
														"literal",
														aeronauticalLayers.waypointUsage === "high"
															? ["H", "B"]
															: ["L", "B"],
													],
												],
												getZoomRankFilter({ 0: 3, 5: 4, 7: 6 }),
											]) as maplibregl.ExpressionSpecification
								}
								layout={{
									"icon-image": [
										"match",
										["get", "type"],
										"compulsory",
										"fix-compulsory",
										"rnav",
										"wpt-rnav-open",
										"fix-non-compulsory",
									] as unknown as maplibregl.ExpressionSpecification,
									"icon-size": 0.7,
									"icon-allow-overlap": false,
									"icon-ignore-placement": false,
									"text-field": ["get", "id"],
									"text-font": [
										"Open Sans Regular",
										"Arial Unicode MS Regular",
									],
									"text-size": 9,
									"text-offset": [0, 1.2],
									"text-anchor": "top",
									"text-allow-overlap": false,
									"text-ignore-placement": false,
									"symbol-sort-key": [
										"match",
										["get", "type"],
										"compulsory",
										10,
										"named",
										15,
										20,
									] as unknown as maplibregl.ExpressionSpecification,
								}}
								paint={{
									"text-color": waypointTextColor,
									"text-halo-color": haloColor,
									"text-halo-width": 1.5,
								}}
							/>
						)}

					{/* VFR Waypoints & Sectional Fixes */}
					{aeronauticalLayers.showWaypointsMaster &&
						aeronauticalLayers.vfrWaypoints && (
							<>
								<Layer
									id="vfr-waypoints-symbol"
									type="symbol"
									source="src-vfr"
									source-layer="vfr_waypoints"
									beforeId="anchor-navaids"
									minzoom={getZoom(5)}
									filter={
										[
											"all",
											["==", ["get", "type"], "vfr"],
											getZoomRankFilter({ 0: 2, 6: 3, 8: 6 }),
										] as maplibregl.ExpressionSpecification
									}
									layout={{
										"icon-image": "wpt-rnav-solid",
										"icon-size": [
											"interpolate",
											["linear"],
											["zoom"],
											5,
											0.5,
											10,
											0.7,
										] as unknown as maplibregl.ExpressionSpecification,
										"icon-allow-overlap": false,
										"icon-ignore-placement": false,
										"text-field": ["get", "id"],
										"text-font": [
											"Open Sans Regular",
											"Arial Unicode MS Regular",
										],
										"text-size": 9,
										"text-offset": [0, 1.2],
										"text-anchor": "top",
										"text-allow-overlap": false,
										"text-ignore-placement": false,
										"text-optional": true,
									}}
									paint={{
										"text-color": isDarkMap
											? crimsonDark.crimson11
											: crimson.crimson11,
										"text-halo-color": haloColor,
										"text-halo-width": 1.5,
									}}
								/>
								{!aeronauticalLayers.waypoints && (
									<Layer
										id="vfr-sectional-fixes-symbol"
										type="symbol"
										source="src-vfr"
										source-layer="vfr_waypoints"
										beforeId="anchor-navaids"
										minzoom={getZoom(7)}
										filter={
											[
												"all",
												["==", ["get", "type"], "sectional_fix"],
												getZoomRankFilter({ 0: 2, 7: 4, 9: 6 }),
											] as maplibregl.ExpressionSpecification
										}
										layout={{
											"icon-image": [
												"case",
												["boolean", ["get", "compulsory"], false],
												"fix-compulsory",
												"fix-non-compulsory",
											] as unknown as maplibregl.ExpressionSpecification,
											"icon-size": 0.7,
											"icon-allow-overlap": false,
											"icon-ignore-placement": false,
											"text-field": ["get", "id"],
											"text-font": [
												"Open Sans Regular",
												"Arial Unicode MS Regular",
											],
											"text-size": 9,
											"text-offset": [0, 1.2],
											"text-anchor": "top",
											"text-allow-overlap": false,
											"text-ignore-placement": false,
										}}
										paint={{
											"text-color": waypointTextColor,
											"text-halo-color": haloColor,
											"text-halo-width": 1.5,
										}}
									/>
								)}
							</>
						)}

					{/* Navaids Points */}
					{aeronauticalLayers.showWaypointsMaster &&
						aeronauticalLayers.navaids && (
							<Layer
								id="navaids-symbol"
								type="symbol"
								source="src-airports-navaids"
								source-layer="navaids"
								beforeId="anchor-airports"
								filter={getZoomRankFilter({ 0: 1, 5: 2, 6: 3, 7: 4, 8: 6 })}
								layout={{
									"icon-image": [
										"match",
										["get", "type"],
										"ndb",
										"nav-ndb",
										"vor",
										"nav-vor",
										"vordme",
										"nav-vordme",
										"vortac",
										"nav-vortac",
										"tacan",
										"nav-tacan",
										"nav-vor",
									],
									"icon-size": 0.8,
									"icon-allow-overlap": true,
									"icon-ignore-placement": true,
									"text-field": ["get", "id"],
									"text-font": ["Open Sans Bold", "Arial Unicode MS Regular"],
									"text-size": 11,
									"text-offset": [0, 1.2],
									"text-anchor": "top",
									"text-allow-overlap": false,
									"text-ignore-placement": false,
									"text-padding": 2,
									"symbol-sort-key": 10,
								}}
								paint={{
									"text-color": accentTextColor,
									"text-halo-color": haloColor,
									"text-halo-width": 1.5,
								}}
							/>
						)}

					{/* Airports */}
					{aeronauticalLayers.showAirportsMaster && (
						<>
							{/* Fuel Ticks Underlay */}
							{/* Fuel Ticks Underlay - disabled per request for IFR style */}
							{/* <Layer
                id="airports-fuel-ticks"
                type="symbol"
                source="src-airports-navaids"
                source-layer="airports"
                filter={["all", ["==", ["get", "has_fuel"], true], getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 })] as maplibregl.ExpressionSpecification}
                layout={{
                  'icon-image': 'apt-fuel-ticks',
                  'icon-size': 0.8,
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true,
                  'symbol-sort-key': 1
                }}
              /> */}
							{aeronauticalLayers.publicAirports && (
								<Layer
									id="airports-public"
									type="symbol"
									source="src-airports-navaids"
									source-layer="airports"
									beforeId="anchor-flight-plan"
									filter={
										[
											"all",
											[
												"in",
												["get", "facility_type"],
												[
													"literal",
													["civil_hard", "civil_soft", "seaplane", "military"],
												],
											],
											getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 }),
										] as maplibregl.ExpressionSpecification
									}
									layout={airportSymbolLayout}
									paint={airportSymbolPaint}
								/>
							)}
							{aeronauticalLayers.privateAirports && (
								<Layer
									id="airports-private"
									type="symbol"
									source="src-airports-navaids"
									source-layer="airports"
									beforeId="anchor-airports-public"
									filter={
										[
											"all",
											[
												"in",
												["get", "facility_type"],
												["literal", ["private", "seaplane_private"]],
											],
											getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 }),
										] as maplibregl.ExpressionSpecification
									}
									layout={airportSymbolLayout}
									paint={airportSymbolPaint}
								/>
							)}
							{aeronauticalLayers.heliports && (
								<Layer
									id="airports-heliport"
									type="symbol"
									source="src-airports-navaids"
									source-layer="airports"
									beforeId="anchor-airports-private"
									filter={
										[
											"all",
											["==", ["get", "facility_type"], "heliport"],
											getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 }),
										] as maplibregl.ExpressionSpecification
									}
									layout={airportSymbolLayout}
									paint={airportSymbolPaint}
								/>
							)}
							{aeronauticalLayers.otherAirports && (
								<Layer
									id="airports-other"
									type="symbol"
									source="src-airports-navaids"
									source-layer="airports"
									beforeId="anchor-airports-heliport"
									filter={
										[
											"all",
											[
												"!",
												[
													"in",
													["get", "facility_type"],
													[
														"literal",
														[
															"civil_hard",
															"civil_soft",
															"seaplane",
															"seaplane_private",
															"military",
															"private",
															"heliport",
														],
													],
												],
											],
											getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 }),
										] as maplibregl.ExpressionSpecification
									}
									layout={airportSymbolLayout}
									paint={airportSymbolPaint}
								/>
							)}
						</>
					)}
				</>
			)}

			{/* Flight Plan */}
			{flightPlan && (
				<Source
					id="flight-plan-source"
					type="geojson"
					data={flightPlan.geometry}
				>
					<Layer
						id="flight-plan-line-casing"
						type="line"
						beforeId="anchor-top"
						filter={["==", "$type", "LineString"]}
						paint={{
							"line-color": isDarkMap ? "#000000" : "#ffffff",
							"line-width": 7,
							"line-opacity": 0.8,
						}}
					/>
					<Layer
						id="flight-plan-line"
						type="line"
						beforeId="anchor-top"
						filter={["==", "$type", "LineString"]}
						paint={{
							"line-color": cyan.cyan9,
							"line-width": 4,
							"line-opacity": 1,
						}}
					/>
					<Layer
						id="flight-plan-point"
						type="symbol"
						beforeId="anchor-top"
						filter={["==", "$type", "Point"]}
						layout={{
							"icon-image": [
								"match",
								["get", "type"],
								"compulsory",
								"fix-compulsory-cyan",
								"waypoint",
								"fix-non-compulsory-cyan",
								"vfr",
								"wpt-rnav-solid-cyan",
								"vor",
								"nav-vor-cyan",
								"vortac",
								"nav-vortac-cyan",
								"vordme",
								"nav-vordme-cyan",
								"tacan",
								"nav-tacan-cyan",
								"dme",
								"nav-dme-cyan",
								"ndb",
								"nav-ndb-cyan",
								"airport",
								"apt-ifr-civil-cyan",
								"fix-non-compulsory-cyan", // default
							] as unknown as maplibregl.ExpressionSpecification,
							"icon-size": 0.8,
							"icon-allow-overlap": true,
							"icon-ignore-placement": true,
						}}
						paint={{
							"icon-halo-color": isDarkMap ? "#000000" : "#ffffff",
							"icon-halo-width": 1,
						}}
					/>
					<Layer
						id="flight-plan-label"
						type="symbol"
						beforeId="anchor-top"
						filter={["==", "$type", "Point"]}
						layout={{
							"text-field": ["get", "id"],
							"text-font": ["Open Sans Bold", "Arial Unicode MS Regular"],
							"text-size": 12,
							"text-offset": [1.2, 0],
							"text-anchor": "left",
							"text-allow-overlap": false,
						}}
						paint={{
							"text-color": cyanDark.cyan11,
							"text-halo-color": haloColor,
							"text-halo-width": 2,
						}}
					/>
				</Source>
			)}

			{/* Hover Tooltip */}
			{aeronauticalLayers.showAll && hoverInfo && (
				<Popup
					longitude={hoverInfo.lngLat[0]}
					latitude={hoverInfo.lngLat[1]}
					closeButton={false}
					closeOnClick={false}
					anchor="bottom"
					offset={15}
					maxWidth="320px"
					style={{ zIndex: 100 }}
				>
					<Card
						size="2"
						style={{
							backgroundColor: "var(--glass-bg)",
							backdropFilter: "blur(12px)",
						}}
					>
						<FeatureList
							features={hoverInfo.features}
							limit={2}
							separatorMargin="2"
							titleBottomMargin="1"
						/>
						{hoverInfo.features.length > 2 && (
							<Box pt="2">
								<Separator size="4" mb="2" />
								<Text
									size="1"
									color={grayColor}
									weight="medium"
									style={{ fontStyle: "italic" }}
								>
									+ {hoverInfo.features.length - 2} more features...
								</Text>
								<Text
									size="1"
									color={accentColor}
									weight="bold"
									as="div"
									mt="1"
								>
									Click to see all
								</Text>
							</Box>
						)}
					</Card>
				</Popup>
			)}
		</ReactMap>
	);
};
