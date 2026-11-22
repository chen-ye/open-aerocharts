import { MapLibreOverlay } from "@deck.gl/maplibre";
import { PathLayer, PolygonLayer } from "deck.gl";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useControl, useMap } from "react-map-gl/maplibre";
import { AirspaceWallLayer } from "../../layers/AirspaceWallLayer";
import type { AeronauticalLayerState } from "../../types/AeronauticalLayerState";
import {
	type AirspaceCap3d,
	type AirspaceEdge3d,
	getAirspace3dPalette,
	getAirspace3dVisibleMask,
	loadAirspaces3d,
	type ParsedAirspaces3d,
	pickAirspaceMaskColorRgb,
} from "../../utils/airspaces3d";

interface AirspaceOverlayProps {
	visible: boolean;
	layers: AeronauticalLayerState;
	showTerrain?: boolean;
}

const AIRSPACE_FILL_ALPHA = 35;

export const AirspaceOverlay: React.FC<AirspaceOverlayProps> = ({
	visible,
	layers,
	showTerrain = false,
}) => {
	const { showAirspaceMaster, controlledAirspace, suaMoa, trsa } = layers;
	const { current: mapRef } = useMap();
	const overlayElRef = useRef<HTMLElement | null>(null);
	const [data3d, setData3d] = useState<ParsedAirspaces3d | null>(null);

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

	const visibleCaps = useMemo(() => {
		if (!data3d || visibleMask === 0) return [];
		return data3d.caps.filter((c) => (c.mask & visibleMask) !== 0);
	}, [data3d, visibleMask]);

	const visibleEdges = useMemo(() => {
		if (!data3d || visibleMask === 0) return [];
		return data3d.edges.filter((e) => (e.mask & visibleMask) !== 0);
	}, [data3d, visibleMask]);

	const deckLayers = useMemo(() => {
		if (!data3d) return [];
		const isRendered = visible && visibleMask !== 0;
		return [
			new AirspaceWallLayer({
				id: "airspace-3d-walls",
				data: data3d.walls,
				visible: isRendered,
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
				data: visibleCaps,
				visible: isRendered,
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
				data: visibleEdges,
				visible: isRendered,
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
		visible,
		visibleMask,
		showTerrain,
		palette,
		visibleCaps,
		visibleEdges,
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
