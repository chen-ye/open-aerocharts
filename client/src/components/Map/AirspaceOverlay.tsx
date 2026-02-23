import { MapboxOverlay } from "@deck.gl/mapbox";
import { PMTilesSource } from "@loaders.gl/pmtiles";
import { crimson, indigo, slateDark, violet } from "@radix-ui/colors";
import { PathLayer, PolygonLayer, TileLayer } from "deck.gl";
import type React from "react";
import { useEffect, useMemo } from "react";
import { useControl } from "react-map-gl/maplibre";
import type { AeronauticalLayerState } from "../../types/AeronauticalLayerState";

interface AirspaceOverlayProps {
	visible: boolean;
	layers: AeronauticalLayerState;
}

// Helper to convert hex to [r, g, b]
const hexToRgb = (hex: string): [number, number, number] => {
	const c = hex.substring(1);
	const r = parseInt(c.substring(0, 2), 16);
	const g = parseInt(c.substring(2, 4), 16);
	const b = parseInt(c.substring(4, 6), 16);
	return [r, g, b];
};

const COLORS = {
	B: hexToRgb(violet.violet9),
	C: hexToRgb(crimson.crimson9),
	D: hexToRgb(indigo.indigo9),
	SUA: hexToRgb(slateDark.slate8),
	TRSA: hexToRgb(slateDark.slate8),
};

export const AirspaceOverlay: React.FC<AirspaceOverlayProps> = ({
	visible,
	layers,
}) => {
	const overlay = useControl<MapboxOverlay>(
		() =>
			new MapboxOverlay({
				interleaved: true,
				layers: [],
			}),
	);

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
			// We want to render outlines at altitude (upper_m).
			// Since MVTLayer features are 2D, we must modify them in renderSubLayers.
			renderSubLayers: (props) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const { data } = props as any; // Should be GeoJSONFeatureCollection
				if (!data) return null;

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const getColor = (p: any) => {
					const cls = p.airspace_class;
					const isSua = p.is_sua;
					if (isSua) return COLORS.SUA;
					if (cls === "B") return COLORS.B;
					if (cls === "C") return COLORS.C;
					if (cls === "D") return COLORS.D;
					if (cls === "TRSA") return COLORS.TRSA;
					return [150, 150, 150];
				};

				// Filter features based on layer state
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const filteredFeatures = data.features.filter((f: any) => {
					const cls = f.properties.airspace_class;
					const isSua = f.properties.is_sua;

					if (isSua) return layers.suaMoa;
					if (cls === "B" || cls === "C" || cls === "D")
						return layers.controlledAirspace;
					if (cls === "TRSA") return layers.trsa;
					return false;
				});

				// Generate 3D volume polygons and edge paths
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const volumeData: any[] = [];
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const edgeData: any[] = [];

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				for (const f of filteredFeatures) {
					const upperM = f.properties.upper_m || 0;
					const lowerM = f.properties.lower_m || 0;
					const color = getColor(f.properties);

					// Function to add Z=lowerM to coordinates
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const to3D = (coords: any[]) => {
						// coords is a Polygon geometry's coordinates: [ring1, ring2...]
						// Each ring is [ [x,y], [x,y]...]
						// We map to [ [x,y,lowerM], ... ]
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						return coords.map((ring: any[]) =>
							ring.map((p: any) => [p[0], p[1], lowerM]),
						);
					};

					// Function to extract Outer Ring at Z=upperM+offset
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const to3DLine = (coords: any[]) => {
						// Outer ring is coords[0]
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						return coords[0].map((p: any) => [p[0], p[1], upperM + 10]);
					};

					if (f.geometry.type === "Polygon") {
						volumeData.push({
							polygon: to3D(f.geometry.coordinates),
							elevation: upperM - lowerM,
							fillColor: [...color, 35],
						});
						edgeData.push({
							path: to3DLine(f.geometry.coordinates),
							color: color,
						});
					} else if (f.geometry.type === "MultiPolygon") {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						f.geometry.coordinates.forEach((polyCoords: any[]) => {
							volumeData.push({
								polygon: to3D(polyCoords),
								elevation: upperM - lowerM,
								fillColor: [...color, 35],
							});
							edgeData.push({
								path: to3DLine(polyCoords),
								color: color,
							});
						});
					}
				}

				return [
					new PolygonLayer(props, {
						id: `${props.id}-volume`,
						data: volumeData,
						// data: edgeData,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getPolygon: (d: any) => d.polygon,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getElevation: (d: any) => d.elevation,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getFillColor: (d: any) => d.fillColor,
						extruded: true,
						wireframe: false,
						parameters: {
							// Push back volume to avoid z-fighting with edges
							// polygonOffset: [1, 1],
						},
						// _normalize: false, // Optimization since we pass array of points
					}),
					new PathLayer(props, {
						id: `${props.id}-edges`,
						data: edgeData,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getPath: (d: any) => d.path,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						getColor: (d: any) => d.color,
						widthMinPixels: 1,
						opacity: 1.0,
						parameters: {
							polygonOffset: [-1, -1],
						},
					}),
				];
			},
		});

		overlay.setProps({
			layers: [layer],
		});
	}, [overlay, visible, pmTilesSource, layers]);

	return null;
};
