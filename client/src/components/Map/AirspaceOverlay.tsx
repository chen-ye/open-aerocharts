import { MapboxOverlay } from "@deck.gl/mapbox";
import { PMTilesSource } from "@loaders.gl/pmtiles";
import { crimson, indigo, slateDark, violet } from "@radix-ui/colors";
import { PathLayer, PolygonLayer, TileLayer } from "deck.gl";
import { Fp64Extension } from "@deck.gl/extensions";
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

        // Flatten features for PolygonLayer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const flatFeatures = filteredFeatures.flatMap((f: any) => {
             if (f.geometry.type === 'Polygon') {
                 return f;
             }
             if (f.geometry.type === 'MultiPolygon') {
                 // eslint-disable-next-line @typescript-eslint/no-explicit-any
                 return f.geometry.coordinates.map((coords: any) => ({
                     ...f,
                     geometry: { type: 'Polygon', coordinates: coords }
                 }));
             }
             return [];
        });

        const pathOffset = 30;

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
                        coord.map((p: any) => [p[0], p[1], lowerM])
                    );
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getElevation: (f: any) => (f.properties.upper_m || 0) - (f.properties.lower_m || 0),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getFillColor: (f: any) => [...getColor(f.properties), 35],
                extruded: true,
                wireframe: false,
                getPolygonOffset: ({layerIndex}) => [0, layerIndex * -10000],
            }),
            new PathLayer(props, {
                id: `${props.id}-edges-upper`,
                data: flatFeatures,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getPath: (f: any) => {
                    const upperM = f.properties.upper_m || 0;
                    // Outer ring only
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return f.geometry.coordinates[0].map((p: any) => [p[0], p[1], upperM + pathOffset]);
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getColor: (f: any) => getColor(f.properties),
                widthMinPixels: 1,
                opacity: 1.0,
                getPolygonOffset: ({layerIndex}) => [0, layerIndex * -10000],
            }),
            new PathLayer(props, {
                id: `${props.id}-edges-upper`,
                data: flatFeatures,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getPath: (f: any) => {
                    const lowerM = f.properties.lower_m || 0;
                    // Outer ring only
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return f.geometry.coordinates[0].map((p: any) => [p[0], p[1], lowerM - pathOffset]);
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getColor: (f: any) => getColor(f.properties),
                widthMinPixels: 1,
                opacity: 1.0,
                getPolygonOffset: ({layerIndex}) => [0, layerIndex * -10000],
            })
        ];
			},
		});

		overlay.setProps({
			layers: [layer],
		});
	}, [overlay, visible, pmTilesSource, layers]);

	return null;
};
