import { Fp64Extension } from "@deck.gl/extensions";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { PMTilesSource } from "@loaders.gl/pmtiles";
import { PathLayer, PolygonLayer, TileLayer } from "deck.gl";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { useControl, useMap } from "react-map-gl/maplibre";
import type { AeronauticalLayerState } from "../../types/AeronauticalLayerState";
import { getAirspaceColorRgb } from "../../utils/airspaceColors";

interface AirspaceOverlayProps {
	visible: boolean;
	layers: AeronauticalLayerState;
}

export const AirspaceOverlay: React.FC<AirspaceOverlayProps> = ({
	visible,
	layers,
}) => {
	const { showAirspaceMaster, controlledAirspace, suaMoa, trsa } = layers;
	const { current: mapRef } = useMap();
	const overlayElRef = useRef<HTMLElement | null>(null);

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

	const pmTilesSource = useMemo(() => {
		const tileUrl = `${window.location.origin}${import.meta.env.BASE_URL}airspaces.pmtiles`;
		return PMTilesSource.createDataSource(tileUrl, {
			pmtiles: {
				loadOptions: {},
			},
		});
	}, []);

	useEffect(() => {
		const layer = new TileLayer({
			id: "airspace-edges-3d",
			getTileData: pmTilesSource.getTileData,
			tileSource: pmTilesSource,
			visible,
			minZoom: 0,
			maxZoom: 8,
			tileSize: 256,

			zoomOffset: window.devicePixelRatio === 1 ? -1 : 0,
			updateTriggers: {
				renderSubLayers: [showAirspaceMaster, controlledAirspace, suaMoa, trsa],
			},
			// We want to render outlines at altitude (upper_m).
			// Since MVTLayer features are 2D, we must modify them in renderSubLayers.
			renderSubLayers: (props) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const { data } = props as any; // Should be GeoJSONFeatureCollection
				if (!data) return null;

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const getColor = (p: any) => {
					return getAirspaceColorRgb(p.airspace_class, p.is_sua);
				};

				// Filter features based on layer state
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const filteredFeatures = data.features.filter((f: any) => {
					if (!showAirspaceMaster) return false;
					const cls = f.properties.airspace_class;
					const isSua = f.properties.is_sua;

					if (isSua) return suaMoa;
					if (cls === "B" || cls === "C" || cls === "D")
						return controlledAirspace;
					if (cls === "TRSA") return trsa;
					return false;
				});

				// Flatten features for PolygonLayer
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const flatFeatures = filteredFeatures.flatMap((f: any) => {
					if (f.geometry.type === "Polygon") {
						return f;
					}
					if (f.geometry.type === "MultiPolygon") {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						return f.geometry.coordinates.map((coords: any) => ({
							...f,
							geometry: { type: "Polygon", coordinates: coords },
						}));
					}
					return [];
				});

				const pathOffset = 15;

				return [
					new PolygonLayer(props, {
						id: `${props.id}-volume`,
						data: flatFeatures,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getPolygon: (f: any) => {
							const lowerM = f.properties.lower_m || 0;
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							return f.geometry.coordinates.map((coord: any[]) =>
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								coord.map((p: any) => [p[0], p[1], lowerM]),
							);
						},
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getElevation: (f: any) =>
							(f.properties.upper_m || 0) - (f.properties.lower_m || 0),
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getFillColor: (f: any) =>
							[...getColor(f.properties), 35] as [
								number,
								number,
								number,
								number,
							],
						extruded: true,
						wireframe: false,
						getPolygonOffset: ({ layerIndex }) => [0, layerIndex * -10000],
						extensions: [new Fp64Extension()],
					}),
					new PathLayer(props, {
						id: `${props.id}-edges-upper`,
						data: flatFeatures,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getPath: (f: any) => {
							const upperM = f.properties.upper_m || 0;
							// Outer ring only
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							return f.geometry.coordinates[0].map((p: any) => [
								p[0],
								p[1],
								upperM + pathOffset,
							]);
						},
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getColor: (f: any) =>
							getColor(f.properties) as [number, number, number],
						widthMinPixels: 1,
						opacity: 1.0,
						getPolygonOffset: ({ layerIndex }) => [0, layerIndex * -10000],
					}),
					new PathLayer(props, {
						id: `${props.id}-edges-lower`,
						data: flatFeatures,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getPath: (f: any) => {
							const lowerM = f.properties.lower_m || 0;
							// Outer ring only
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							return f.geometry.coordinates[0].map((p: any) => [
								p[0],
								p[1],
								lowerM - pathOffset,
							]);
						},
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getColor: (f: any) =>
							getColor(f.properties) as [number, number, number],
						widthMinPixels: 1,
						opacity: 1.0,
						getPolygonOffset: ({ layerIndex }) => [0, layerIndex * -10000],
					}),
				];
			},
		});

		overlay.setProps({
			layers: [layer],
		});
		if (!visible) {
			mapRef?.getMap()?.triggerRepaint();
		}
	}, [
		overlay,
		mapRef,
		visible,
		pmTilesSource,
		showAirspaceMaster,
		controlledAirspace,
		suaMoa,
		trsa,
	]);

	return null;
};
