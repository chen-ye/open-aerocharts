import { MapLibreOverlay } from "@deck.gl/maplibre";
import { PathLayer, PolygonLayer } from "deck.gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useControl, useMap } from "react-map-gl/maplibre";
import { AirspaceWallLayer } from "../../layers/AirspaceWallLayer";
import type { AeronauticalLayerState } from "../../types/AeronauticalLayerState";
import {
	type AirspaceCap3d,
	type AirspaceEdge3d,
	computePaddedCullBounds,
	EMPTY_AIRSPACES_3D,
	type GeoViewportBounds,
	getAirspace3dPalette,
	getAirspace3dVisibleMask,
	isViewInsideCullBounds,
	loadAirspaces3d,
	type ParsedAirspaces3d,
	pickAirspaceMaskColorRgb,
	selectVisibleAirspaces3d,
} from "../../utils/airspaces3d";

interface AirspaceOverlayProps {
	visible: boolean;
	layers: AeronauticalLayerState;
	showTerrain?: boolean;
}

const AIRSPACE_FILL_ALPHA = 35;

function readViewportBounds(map: MapLibreMap): GeoViewportBounds {
	const b = map.getBounds();
	return {
		west: b.getWest(),
		south: b.getSouth(),
		east: b.getEast(),
		north: b.getNorth(),
	};
}

export const AirspaceOverlay: React.FC<AirspaceOverlayProps> = ({
	visible,
	layers,
	showTerrain = false,
}) => {
	const { showAirspaceMaster, controlledAirspace, suaMoa, trsa } = layers;
	const { current: mapRef } = useMap();
	const overlayElRef = useRef<HTMLElement | null>(null);
	const [data3d, setData3d] = useState<ParsedAirspaces3d | null>(null);
	const [cullBounds, setCullBounds] = useState<
		GeoViewportBounds | null | undefined
	>(undefined);
	const cullBoundsRef = useRef<GeoViewportBounds | null | undefined>(undefined);

	const overlay = useControl<MapLibreOverlay>(() => {
		const ctrl = new MapLibreOverlay({
			interleaved: true,
			layers: [],
		});
		const origOnAdd = ctrl.onAdd.bind(ctrl);
		ctrl.onAdd = (map) => {
			const el = origOnAdd(map);
			overlayElRef.current = el;
			return el;
		};
		return ctrl;
	});

	// Ensure deck.gl's interleaved control element and layer group are removed even if
	// unmount happens while MapLibre has in-flight tiles (!map.isStyleLoaded()), and repaint 2D.
	useEffect(() => {
		return () => {
			overlayElRef.current?.remove();
			overlayElRef.current = null;
			const rawMap = mapRef?.getMap();
			if (!rawMap?.getStyle()) return;
			if (rawMap.getLayer("deck-maplibre-layer-group-last")) {
				rawMap.removeLayer("deck-maplibre-layer-group-last");
			} else {
				rawMap.triggerRepaint();
			}
		};
	}, [mapRef]);

	useEffect(() => {
		let cancelled = false;
		const dataUrl = `${window.location.origin}${import.meta.env.BASE_URL}airspaces_3d.bin`;
		loadAirspaces3d(dataUrl)
			.then((parsed) => {
				if (!cancelled) {
					setData3d(parsed);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					console.error("Failed to load 3D airspace geometry:", err);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useLayoutEffect(() => {
		const rawMap = mapRef?.getMap();
		if (!visible || !rawMap) return;
		const view = readViewportBounds(rawMap);
		if (
			cullBoundsRef.current === undefined ||
			!isViewInsideCullBounds(view, cullBoundsRef.current)
		) {
			const next = computePaddedCullBounds(view);
			cullBoundsRef.current = next;
			setCullBounds(next);
		}
	}, [mapRef, visible]);

	useEffect(() => {
		const rawMap = mapRef?.getMap();
		if (!visible || !rawMap) return undefined;

		const syncCullBounds = () => {
			const view = readViewportBounds(rawMap);
			if (
				cullBoundsRef.current === undefined ||
				!isViewInsideCullBounds(view, cullBoundsRef.current)
			) {
				const next = computePaddedCullBounds(view);
				cullBoundsRef.current = next;
				setCullBounds(next);
			}
		};

		rawMap.on("move", syncCullBounds);
		rawMap.on("resize", syncCullBounds);
		return () => {
			rawMap.off("move", syncCullBounds);
			rawMap.off("resize", syncCullBounds);
		};
	}, [mapRef, visible]);

	const visibleMask = useMemo(
		() =>
			getAirspace3dVisibleMask({
				showAirspaceMaster,
				controlledAirspace,
				suaMoa,
				trsa,
			}),
		[showAirspaceMaster, controlledAirspace, suaMoa, trsa],
	);

	const palette = useMemo(() => getAirspace3dPalette(AIRSPACE_FILL_ALPHA), []);

	const selected3d = useMemo(() => {
		if (!data3d || cullBounds === undefined || visibleMask === 0) {
			return EMPTY_AIRSPACES_3D;
		}
		return selectVisibleAirspaces3d(data3d, visibleMask, cullBounds);
	}, [data3d, visibleMask, cullBounds]);

	const deckLayers = useMemo(() => {
		if (!data3d || cullBounds === undefined) return [];
		const isRendered = visible && visibleMask !== 0;
		return [
			new AirspaceWallLayer({
				id: "airspace-3d-walls",
				data: selected3d.walls,
				visible: isRendered && selected3d.walls.length > 0,
				visibleMask,
				terrainScale: showTerrain ? 1 : 0,
				palette,
				parameters: {
					cullMode: "none",
					depthWriteEnabled: false,
					depthCompare: "less-equal",
				},
			}),
			new PolygonLayer<AirspaceCap3d>({
				id: "airspace-3d-caps",
				data: selected3d.caps,
				visible: isRendered && selected3d.caps.length > 0,
				getPolygon: (c) => (showTerrain ? c.polygonTerrain : c.polygonFlat),
				getFillColor: (c) =>
					[
						...(pickAirspaceMaskColorRgb(c.mask, visibleMask) ?? [
							150, 150, 150,
						]),
						AIRSPACE_FILL_ALPHA,
					] as [number, number, number, number],
				updateTriggers: {
					getPolygon: [showTerrain],
					getFillColor: [visibleMask],
				},
				extruded: false,
				filled: true,
				stroked: false,
				parameters: {
					cullMode: "none",
					depthWriteEnabled: false,
					depthCompare: "less-equal",
				},
			}),
			new PathLayer<AirspaceEdge3d>({
				id: "airspace-3d-edges",
				data: selected3d.edges,
				visible: isRendered && selected3d.edges.length > 0,
				getPath: (e) => (showTerrain ? e.pathTerrain : e.pathFlat),
				getColor: (e) =>
					pickAirspaceMaskColorRgb(e.mask, visibleMask) ?? [150, 150, 150],
				updateTriggers: {
					getPath: [showTerrain],
					getColor: [visibleMask],
				},
				widthMinPixels: 1,
				opacity: 1.0,
				parameters: {
					depthWriteEnabled: false,
					depthCompare: "less-equal",
				},
			}),
		];
	}, [
		data3d,
		cullBounds,
		visible,
		visibleMask,
		showTerrain,
		palette,
		selected3d,
	]);

	useEffect(() => {
		overlay.setProps({ layers: deckLayers });
		const rawMap = mapRef?.getMap();
		rawMap?.triggerRepaint();

		if (!rawMap || deckLayers.length === 0) return undefined;

		// @deck.gl/maplibre skips adding deck-maplibre-layer-group-last while tiles are
		// in-flight (!map.isStyleLoaded()) and only retries on styledata, not tile completion.
		const syncLayerGroup = () => {
			if (
				rawMap.isStyleLoaded() &&
				!rawMap.getLayer("deck-maplibre-layer-group-last")
			) {
				overlay.setProps({ layers: deckLayers });
				rawMap.triggerRepaint();
			}
		};

		rawMap.on("styledata", syncLayerGroup);
		rawMap.on("sourcedata", syncLayerGroup);
		rawMap.on("idle", syncLayerGroup);
		return () => {
			rawMap.off("styledata", syncLayerGroup);
			rawMap.off("sourcedata", syncLayerGroup);
			rawMap.off("idle", syncLayerGroup);
		};
	}, [overlay, mapRef, deckLayers]);

	return null;
};
