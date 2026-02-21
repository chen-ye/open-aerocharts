import React, { useMemo, useCallback, useState } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { Card, Box, Text, Flex, Heading, IconButton, Separator } from '@radix-ui/themes';
import { X } from 'lucide-react';
import { addAeroIcons } from '../../utils/aeroIcons.ts';
import styles from '../../mapStyles';
import type { AeronauticalLayerState } from '../../types/AeronauticalLayerState';
import type { FlightPlan } from '../../types/FlightPlan';
import { accentColor, grayColor } from '../../App.tsx';
import { crimson, crimsonDark, indigo, indigoDark, violet, violetDark, blue, gray, grayDark, purple, purpleDark, slate, slateDark, brown, brownDark, blueDark, cyan, cyanDark } from '@radix-ui/colors';
import { FeatureList } from './FeatureList';

interface AeroMapProps {
  basemapUrlOrId: string;
  showTerrain: boolean;
  aeronauticalLayers: AeronauticalLayerState;
  basemapBrightness: number;
  flightPlan: FlightPlan | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSelectFeatures?: (features: { lngLat: [number, number]; features: any[] } | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedFeatures?: { lngLat: [number, number]; features: any[] } | null;
}

export const AeroMap: React.FC<AeroMapProps> = ({
  basemapUrlOrId,
  showTerrain,
  aeronauticalLayers,
  basemapBrightness,
  flightPlan,
  onSelectFeatures,
  selectedFeatures: propSelectedFeatures
}) => {
  const mapStyle = useMemo<string | maplibregl.StyleSpecification>(() => {
    // If the basemapUrlOrId is a URL, treat it as a style URL
    if (URL.canParse(basemapUrlOrId)) {
      return basemapUrlOrId;
    }
    const style = styles[basemapUrlOrId as keyof typeof styles] ?? styles['faa-sectional'];
    return style;
  }, [basemapUrlOrId]);

  // Derive light/dark mode from basemap identifier
  const isDarkMap = useMemo(() => {
    const id = basemapUrlOrId.toLowerCase();
    return id.includes('dark') || id.includes('faa-');
  }, [basemapUrlOrId]);

  // Theme-dependent colors
  const textColor = isDarkMap ? '#ffffff' : '#000000';
  const haloColor = isDarkMap ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.95)';
  const accentTextColor = isDarkMap ? indigoDark.indigo11 : indigo.indigo11;
  const waypointTextColor = isDarkMap ? grayDark.gray11 : gray.gray11;
  const obstacleTextColor = isDarkMap ? purpleDark.purple11 : purple.purple11;

  const mapRef = React.useRef<maplibregl.Map | null>(null);

  const addAirwayBgIcon = (map: maplibregl.Map, isDark: boolean) => {
    const definitions = [
      { id: 'airway-bg-gray', color: isDark ? grayDark.gray11 : gray.gray11 },
      { id: 'airway-bg-blue', color: blueDark.blue8 },
      { id: 'airway-bg-brown', color: isDark ? brownDark.brown9 : brown.brown9 }
    ];

    definitions.forEach(def => {
      const svgStr = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="22" height="22" rx="4" fill="${def.color}"/>
        </svg>
      `;
      const img = new Image(24, 24);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        if (map.hasImage(def.id)) map.removeImage(def.id);
        map.addImage(def.id, img, {
          stretchX: [[8, 16]],
          stretchY: [[8, 16]],
          content: [4, 4, 20, 20],
          pixelRatio: 1
        });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMapLoad = useCallback((e: any) => {
    mapRef.current = e.target;
    const svgHaloColor = isDarkMap ? '#000000' : '#ffffff';
    addAeroIcons(e.target, svgHaloColor, 0.95);
    addAirwayBgIcon(e.target, isDarkMap);
  }, [isDarkMap]);

  // Re-inject icons every time the base Map Style finishes mutating/swapping
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onStyleData = useCallback((e: any) => {
    if (!mapRef.current) return;
    // We only care when the style explicitly finishes loading its base sprite sheet
    if (!e.target.isStyleLoaded()) return;
    const svgHaloColor = isDarkMap ? '#000000' : '#ffffff';

    // Only inject if missing
    if (!mapRef.current.hasImage('airway-bg-blue')) {
      addAeroIcons(mapRef.current, svgHaloColor, 0.95);
      addAirwayBgIcon(mapRef.current, isDarkMap);
    }
  }, [isDarkMap]);

  // Reload icons when dark/light mode changes
  React.useEffect(() => {
    if (!mapRef.current) return;
    const svgHaloColor = isDarkMap ? '#000000' : '#ffffff';
    addAeroIcons(mapRef.current, svgHaloColor, 0.95);
    addAirwayBgIcon(mapRef.current, isDarkMap);
  }, [isDarkMap]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hoverInfo, setHoverInfo] = useState<{ lngLat: [number, number]; features: any[] } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [localSelectedFeatures, setLocalSelectedFeatures] = useState<{ lngLat: [number, number]; features: any[] } | null>(null);

  const selectedFeatures = propSelectedFeatures !== undefined ? propSelectedFeatures : localSelectedFeatures;
  const setSelectedFeatures = onSelectFeatures || setLocalSelectedFeatures;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMouseMove = useCallback((e: any) => {
    if (e.features && e.features.length > 0) {
      setHoverInfo({
        lngLat: [e.lngLat.lng, e.lngLat.lat],
        features: e.features,
      });
    } else {
      setHoverInfo(null);
    }
  }, []);

  const onMouseLeave = useCallback(() => {
    setHoverInfo(null);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMapClick = useCallback((e: any) => {
    if (e.features && e.features.length > 0) {
      setSelectedFeatures({
        lngLat: [e.lngLat.lng, e.lngLat.lat],
        features: e.features,
      });
    } else {
      setSelectedFeatures(null);
    }
  }, [setSelectedFeatures]);

  const interactiveLayerIds = useMemo(() => [
    'airspaces-class-b',
    'airspaces-class-b-fill',
    'airspaces-class-c',
    'airspaces-class-c-fill',
    'airspaces-class-d',
    'airspaces-class-d-fill',
    'airspaces-sua',
    'airspaces-sua-fill',
    'airspaces-trsa',
    'airspaces-trsa-fill',
    'airspaces-class-e-fill',
    'airways-low-line',
    'airways-high-line',
    'airports-public',
    'airports-private',
    'airports-heliport',
    'airports-other',
    'navaids-symbol',
    'waypoints-symbol',
    'localizers-symbol',
    'obstacles-symbol',
    'am-runways-fill',
    'am-taxiways-fill',
  ], []);

  React.useEffect(() => {
    const pmtilesProtocol = new Protocol();
    maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);

  const airwayLinePaint: maplibregl.LineLayerSpecification['paint'] = useMemo(() => ({
    'line-color': [
      'match',
      ['get', 'route_type'],
      'O', isDarkMap ? grayDark.gray11 : gray.gray11, // Official Designated (Victor/Jet)
      'R', blue.blue9, // RNAV/GPS
      'H', isDarkMap ? brownDark.brown9 : brown.brown9, // Helicopter
      isDarkMap ? grayDark.gray11 : gray.gray11 // fallback
    ] as unknown as maplibregl.ExpressionSpecification,
    'line-width': [
      'interpolate', ['linear'], ['zoom'],
      3, 1,
      7, 2,
      10, 4
    ] as unknown as maplibregl.ExpressionSpecification,
    'line-opacity': 0.6
  }), [isDarkMap]);

  const airwaySymbolLayout: maplibregl.SymbolLayerSpecification['layout'] = useMemo(() => {
    const minDetailZoom = Math.max(0, 10 - aeronauticalLayers.declutterLevel);
    return {
      'symbol-placement': [
        'step', ['zoom'],
        'line',
        minDetailZoom,
        'line-center'
      ] as unknown as maplibregl.ExpressionSpecification,
      'symbol-spacing': 500,
      'icon-image': [
        'step', ['zoom'],
        '',
        minDetailZoom,
        [
          'match',
          ['get', 'route_type'],
          'O', 'airway-bg-gray',
          'R', 'airway-bg-blue',
          'H', 'airway-bg-brown',
          'airway-bg-gray'
        ]
      ] as unknown as maplibregl.ExpressionSpecification,
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [-2, 4, -2, 4],
      'text-field': ['get', 'airway'],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
      'text-size': 11,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'map'
    };
  }, [aeronauticalLayers.declutterLevel]);

  const airwayMeaLayout: maplibregl.SymbolLayerSpecification['layout'] = useMemo(() => {
    const minDetailZoom = Math.max(0, 10 - aeronauticalLayers.declutterLevel);
    return {
      'symbol-placement': 'line-center',
      'symbol-spacing': 500,
      'text-field': [
        'step', ['zoom'],
        '',
        minDetailZoom,
        ['to-string', ['get', 'mea']]
      ] as unknown as maplibregl.ExpressionSpecification,
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': 10,
      'text-offset': [0, -1.5],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'map'
    };
  }, [aeronauticalLayers.declutterLevel]);

  const airwayDistLayout: maplibregl.SymbolLayerSpecification['layout'] = useMemo(() => {
    const minDetailZoom = Math.max(0, 10 - aeronauticalLayers.declutterLevel);
    return {
      'symbol-placement': 'line-center',
      'symbol-spacing': 500,
      'text-field': [
        'step', ['zoom'],
        '',
        minDetailZoom,
        ['to-string', ['get', 'distance']]
      ] as unknown as maplibregl.ExpressionSpecification,
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': 10,
      'text-offset': [0, 1.5],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'map'
    };
  }, [aeronauticalLayers.declutterLevel]);

  const airwaySymbolPaint: maplibregl.SymbolLayerSpecification['paint'] = useMemo(() => {
    const minDetailZoom = Math.max(0, 10 - aeronauticalLayers.declutterLevel);
    return {
      'text-color': [
        'match',
        ['get', 'route_type'],
        'O', isDarkMap ? '#000000' : '#ffffff', // Contests against gray11
        'R', '#ffffff', // Contrasts against blue9
        'H', '#ffffff', // Contrasts against brown9
        isDarkMap ? '#000000' : '#ffffff'       // Default
      ] as unknown as maplibregl.ExpressionSpecification,
      'text-halo-color': [
        'match',
        ['get', 'route_type'],
        'O', isDarkMap ? grayDark.gray11 : gray.gray11,
        'R', blueDark.blue7,
        'H', isDarkMap ? brownDark.brown9 : brown.brown9,
        isDarkMap ? grayDark.gray11 : gray.gray11
      ] as unknown as maplibregl.ExpressionSpecification,
      'text-halo-width': [
        'step', ['zoom'],
        1.5,
        minDetailZoom,
        0
      ] as unknown as maplibregl.ExpressionSpecification
    };
  }, [isDarkMap, aeronauticalLayers.declutterLevel]);

  const airwayDetailPaint: maplibregl.SymbolLayerSpecification['paint'] = useMemo(() => ({
    'text-color': textColor,
    'text-halo-color': haloColor,
    'text-halo-width': 1.5
  }), [textColor, haloColor]);

  const airportSymbolLayout: maplibregl.SymbolLayerSpecification['layout'] = useMemo(() => ({
    'icon-image': [
      'match', ['get', 'facility_type'],
      'civil_hard', 'apt-civil-paved-small',
      'civil_soft', 'apt-civil-unpaved',
      'seaplane', 'apt-seaplane',
      'military', 'apt-military',
      'private', 'apt-private',
      'heliport', 'apt-heliport',
      'apt-civil-unpaved' // default/fallback
    ] as unknown as maplibregl.ExpressionSpecification,
    'icon-size': 0.8,
    'icon-allow-overlap': false,
    'icon-ignore-placement': false,
    'text-field': ['get', 'id'],
    'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
    'text-size': 12,
    'text-offset': [0, 1.2],
    'text-anchor': 'top',
    'text-allow-overlap': false,
    'text-ignore-placement': false,
    'text-padding': 2,
    'symbol-sort-key': [
      'match',
      ['get', 'facility_type'],
      'civil_hard', 1,
      'civil_soft', 2,
      'military', 3,
      'seaplane', 4,
      'heliport', 5,
      'private', 6,
      7 // other
    ] as unknown as maplibregl.ExpressionSpecification
  }), []);

  const airportSymbolPaint: maplibregl.SymbolLayerSpecification['paint'] = useMemo(() => ({
    'text-color': crimson.crimson9,
    'text-halo-color': haloColor,
    'text-halo-width': 1.5
  }), [haloColor]);

  const airspaceLabelLayout: maplibregl.SymbolLayerSpecification['layout'] = useMemo(() => ({
    'text-field': [
      'concat',
      ['case', ['==', ['get', 'is_sua'], true], ['get', 'name'], ['get', 'airspace_class']],
      '/',
      ['get', 'lower_limit'],
      '-',
      ['get', 'upper_limit']
    ] as unknown as maplibregl.ExpressionSpecification,
    'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
    'text-size': 12,
    'symbol-placement': 'line',
    'text-keep-upright': true,
    'text-max-angle': 30,
    'text-allow-overlap': false,
    'text-ignore-placement': false,
    'symbol-spacing': 350,
    'text-offset': [0, 1]
  }), []);

  const getZoomRankFilter = (baseZooms: Record<number, number>): maplibregl.ExpressionSpecification => {
    const zooms = Object.keys(baseZooms).map(Number).sort((a, b) => a - b);
    const initialRank = baseZooms[zooms[0]] + aeronauticalLayers.declutterLevel;

    const stepExpr: unknown[] = ['step', ['zoom'], Math.min(6, Math.max(1, initialRank))];
    for (let i = 1; i < zooms.length; i++) {
        const z = zooms[i];
        const maxRank = baseZooms[z] + aeronauticalLayers.declutterLevel;
        stepExpr.push(z);
        stepExpr.push(Math.min(6, Math.max(1, maxRank)));
    }

    return ['<=', ['to-number', ['get', 'rank'], 5], stepExpr] as unknown as maplibregl.ExpressionSpecification;
  };

  const showRunways = aeronauticalLayers.showAirportsMaster &&
    (aeronauticalLayers.publicAirports || aeronauticalLayers.privateAirports || aeronauticalLayers.heliports);

  const getZoom = (baseZoom: number) => {
    return Math.max(0, baseZoom - aeronauticalLayers.declutterLevel);
  };

  const highlightData = useMemo(() => {
    const rawFeatures = selectedFeatures?.features || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features = rawFeatures.map((f: any) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: f.properties,
      id: f.id
    }));

    return {
      type: 'FeatureCollection',
      features: features
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }, [selectedFeatures]);

  return (
    <Map
      onLoad={onMapLoad}
      onStyleData={onStyleData}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onMapClick}
      interactiveLayerIds={aeronauticalLayers.showAll ? interactiveLayerIds : []}
      initialViewState={{
        longitude:  -121.596667, // San Martin Airport
        latitude: 37.081667,
        zoom: 8,
        pitch: 0,
      }}
      mapStyle={mapStyle}
      style={{ width: '100%', height: '100%' }}
      hash={true}
      mapLib={maplibregl}
      terrain={showTerrain ? { source: 'aws-terrain', exaggeration: 1.2 } : undefined}
    >
      <NavigationControl position="bottom-right" visualizePitch={true} />

      {/* Feature Sidebar (Left) */}
      {selectedFeatures && (
        <Box className="map-feature-panel desktop-only">
          <Card
            size="2"
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: 'transparent', // Handled by CSS class
              boxShadow: 'none', // Handled by CSS class
              overflowY: 'auto'
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
                {selectedFeatures.lngLat[1].toFixed(5)}, {selectedFeatures.lngLat[0].toFixed(5)}
              </Text>

              <Separator size="4" />

              <FeatureList features={selectedFeatures.features} />
            </Flex>
          </Card>
        </Box>
      )}

      {/* 3D Terrain */}
      {showTerrain && (
        <Source
          id="aws-terrain"
          type="raster-dem"
          tiles={["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"]}
          tileSize={256}
          encoding="terrarium"
          maxzoom={14}
        />
      )}

      {/* 3D Terrain Shading Material */}
      {showTerrain && (
        <Layer
          id="hillshade-layer"
          type="hillshade"
          source="aws-terrain"
          paint={{
            'hillshade-exaggeration': 0.8,
            'hillshade-shadow-color': isDarkMap ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.2)',
            'hillshade-highlight-color': isDarkMap ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.4)',
            'hillshade-accent-color': 'rgba(0, 0, 0, 0.3)',
          }}
        />
      )}

      {/* Basemap Dimmer */}
      <Source
        id="basemap-dimmer-source"
        type="geojson"
        data={{
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [[
                  [-180, -90],
                  [180, -90],
                  [180, 90],
                  [-180, 90],
                  [-180, -90]
                ]]
              },
              properties: {}
            }
          ]
        }}
      >
        <Layer
          id="basemap-dimmer-layer"
          type="fill"
          paint={{
            'fill-color': '#000000',
            'fill-opacity': 1 - (basemapBrightness / 100)
          }}
        />
      </Source>

      {/* Selected Feature Highlight */}
      <Source id="highlight-source" type="geojson" data={highlightData}>
        <Layer
          id="highlight-point"
          type="circle"
          filter={['==', '$type', 'Point']}
          paint={{
            'circle-radius': 18,
            'circle-color': '#ffffff',
            'circle-opacity': 0.3,
            'circle-blur': 0.2
          }}
        />
        <Layer
          id="highlight-line"
          type="line"
          filter={['in', '$type', 'LineString', 'Polygon']}
          paint={{
            'line-color': '#ffffff',
            'line-width': 6,
            'line-opacity': 0.4,
            'line-blur': 1
          }}
        />
      </Source>

      {/* Flight Plan */}
      {flightPlan && (
        <Source id="flight-plan-source" type="geojson" data={flightPlan.geometry}>
          <Layer
            id="flight-plan-line-casing"
            type="line"
            filter={['==', '$type', 'LineString']}
            paint={{
              'line-color': isDarkMap ? '#000000' : '#ffffff',
              'line-width': 7,
              'line-opacity': 0.8
            }}
          />
          <Layer
            id="flight-plan-line"
            type="line"
            filter={['==', '$type', 'LineString']}
            paint={{
              'line-color': cyan.cyan9,
              'line-width': 4,
              'line-opacity': 1
            }}
          />
          <Layer
            id="flight-plan-point"
            type="symbol"
            filter={['==', '$type', 'Point']}
            layout={{
              'icon-image': [
                'match',
                ['get', 'type'],
                'compulsory', 'fix-compulsory-cyan',
                'waypoint', 'fix-non-compulsory-cyan',
                'navaid', 'navaid-vor-cyan',
                'airport', 'apt-civil-paved-small-cyan',
                'fix-non-compulsory-cyan' // default
              ] as unknown as maplibregl.ExpressionSpecification,
              'icon-size': 0.8,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true
            }}
            paint={{
              'icon-halo-color': isDarkMap ? '#000000' : '#ffffff',
              'icon-halo-width': 1
            }}
          />
          <Layer
            id="flight-plan-label"
            type="symbol"
            filter={['==', '$type', 'Point']}
            layout={{
              'text-field': ['get', 'id'],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
              'text-size': 12,
              'text-offset': [1.2, 0],
              'text-anchor': 'left',
              'text-allow-overlap': false
            }}
            paint={{
              'text-color': cyanDark.cyan11,
              'text-halo-color': haloColor,
              'text-halo-width': 2
            }}
          />
        </Source>
      )}

      {/* Aeronautical Data — separate PMTiles sources for optimal zoom ranges */}
      {aeronauticalLayers.showAll && (
        <>
          <Source id="src-airspaces" type="vector"
            url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}airspaces.pmtiles`}
          />
          <Source id="src-enroute" type="vector"
            url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}enroute.pmtiles`}
          />
          <Source id="src-boundary" type="vector"
            url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}boundary.pmtiles`}
          />
          <Source id="src-airports-navaids" type="vector"
            url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}airports_navaids.pmtiles`}
          />
          <Source id="src-waypoints-obstacles" type="vector"
            url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}waypoints_obstacles.pmtiles`}
          />
          <Source id="src-diagrams" type="vector"
            url={`pmtiles://${window.location.origin}${import.meta.env.BASE_URL}airport_diagrams.pmtiles`}
          />
        </>
      )}
      {aeronauticalLayers.showAll && (
        <>

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
                    minzoom={9}
                    paint={{
                      'fill-color': isDarkMap ? '#3a3a4a' : '#bbbbbb',
                      'fill-opacity': 0.7
                    }}
                  />
                  {/* <Layer
                    id="am-taxiways-outline"
                    type="line"
                    source="src-diagrams"
                    source-layer="am_taxiways"
                    minzoom={9}
                    paint={{
                      'line-color': isDarkMap ? '#555566' : '#999999',
                      'line-width': 0.5
                    }}
                  /> */}
                  <Layer
                    id="am-runways-fill"
                    type="fill"
                    source="src-diagrams"
                    source-layer="am_runways"
                    minzoom={9}
                    paint={{
                      'fill-color': isDarkMap ? '#555566' : '#666666',
                      'fill-opacity': 0.85
                    }}
                  />
                  <Layer
                    id="am-runways-outline"
                    type="line"
                    source="src-diagrams"
                    source-layer="am_runways"
                    minzoom={9}
                    paint={{
                      'line-color': isDarkMap ? '#777788' : '#444444',
                      'line-width': 1
                    }}
                  />
                  <Layer
                    id="am-runways-label"
                    type="symbol"
                    source="src-diagrams"
                    source-layer="am_runways"
                    minzoom={13}
                    layout={{
                      'text-field': ['get', 'rwy_id'],
                      'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
                      'text-size': 10,
                      'text-allow-overlap': false,
                      'symbol-placement': 'point'
                    }}
                    paint={{
                      'text-color': isDarkMap ? '#cccccc' : '#333333',
                      'text-halo-color': haloColor,
                      'text-halo-width': 1
                    }}
                  />
                  <Layer
                    id="runways-line"
                    type="line"
                    source="src-airports-navaids"
                    source-layer="runways"
                    maxzoom={9}
                    paint={{
                      'line-color': '#444444',
                      'line-width': 4
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
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'B']]}
                    paint={{ 'line-color': violet.violet9, 'line-width': 1 }}
                  />
                  <Layer
                    id="airspaces-class-b"
                    type="line"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'B']]}
                    paint={{ 'line-color': violet.violet9, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8] as unknown as maplibregl.ExpressionSpecification, 'line-opacity': 0.2, 'line-offset': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 4] as unknown as maplibregl.ExpressionSpecification }}
                  />
                  <Layer
                    id="airspaces-class-b-fill"
                    type="fill"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'B']]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                  <Layer
                    id="airspaces-class-c-hairline"
                    type="line"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'C']]}
                    paint={{ 'line-color': crimson.crimson9, 'line-width': 1 }} // crimson-9
                  />
                  <Layer
                    id="airspaces-class-c"
                    type="line"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'C']]}
                    paint={{ 'line-color': crimson.crimson9, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8] as unknown as maplibregl.ExpressionSpecification, 'line-opacity': 0.2, 'line-offset': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 4] as unknown as maplibregl.ExpressionSpecification }} // crimson-9
                  />
                  <Layer
                    id="airspaces-class-c-fill"
                    type="fill"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'C']]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                  <Layer
                    id="airspaces-class-d-hairline"
                    type="line"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'D']]}
                    paint={{ 'line-color': indigo.indigo9, 'line-width': 1, 'line-dasharray': [4, 4] }} // indigo-9
                  />
                  {/* <Layer
                    id="airspaces-class-d"
                    type="line"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'D']]}
                    paint={{ 'line-color': indigo.indigo9, 'line-width': 8, 'line-dasharray': [4/8, 4/8], 'line-opacity': 0.2, "line-offset": 5 }} // indigo-9
                  /> */}
                  <Layer
                    id="airspaces-class-d-fill"
                    type="fill"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'D']]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                  <Layer
                    id="airspaces-class-b-label"
                    type="symbol"
                    source="src-enroute"
                    source-layer="airspaces"
                    minzoom={8}
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'B']]}
                    layout={airspaceLabelLayout}
                    paint={{
                      'text-color': isDarkMap ? violetDark.violet11 : violet.violet11,
                      'text-halo-color': haloColor,
                      'text-halo-width': 1.5
                    }}
                  />
                  <Layer
                    id="airspaces-class-c-label"
                    type="symbol"
                    source="src-enroute"
                    source-layer="airspaces"
                    minzoom={8}
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'C']]}
                    layout={airspaceLabelLayout}
                    paint={{
                      'text-color': isDarkMap ? crimsonDark.crimson11 : crimson.crimson11,
                      'text-halo-color': haloColor,
                      'text-halo-width': 1.5
                    }}
                  />
                  <Layer
                    id="airspaces-class-d-label"
                    type="symbol"
                    source="src-enroute"
                    source-layer="airspaces"
                    minzoom={8}
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'D']]}
                    layout={airspaceLabelLayout}
                    paint={{
                      'text-color': isDarkMap ? indigoDark.indigo11 : indigo.indigo11,
                      'text-halo-color': haloColor,
                      'text-halo-width': 1.5
                    }}
                  />
                </>
              )}
              {aeronauticalLayers.suaMoa && (
                <>
                  <Layer
                    id="airspaces-sua-hairline"
                    type="line"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'is_sua'], true]]}
                    paint={{ 'line-color': slateDark.slate8, 'line-width': 1 }}
                  />
                  <Layer
                    id="airspaces-sua"
                    type="line"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'is_sua'], true]]}
                    paint={{ 'line-color': slateDark.slate8, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8] as unknown as maplibregl.ExpressionSpecification, 'line-opacity': 0.2, 'line-offset': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 4] as unknown as maplibregl.ExpressionSpecification }}
                  />
                  <Layer
                    id="airspaces-sua-fill"
                    type="fill"
                    source="src-enroute"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'is_sua'], true]]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                  <Layer
                    id="airspaces-sua-label"
                    type="symbol"
                    source="src-enroute"
                    source-layer="airspaces"
                    minzoom={8}
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'is_sua'], true]]}
                    layout={airspaceLabelLayout}
                    paint={{
                      'text-color': isDarkMap ? slateDark.slate11 : slate.slate11,
                      'text-halo-color': haloColor,
                      'text-halo-width': 1.5
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
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'TRSA']]}
                    paint={{ 'line-color': slateDark.slate8, 'line-width': 1 }}
                  />
                  <Layer
                    id="airspaces-trsa"
                    type="line"
                    source="src-airspaces"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'TRSA']]}
                    paint={{ 'line-color': slateDark.slate8, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8] as unknown as maplibregl.ExpressionSpecification, 'line-opacity': 0.2, 'line-offset': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 4] as unknown as maplibregl.ExpressionSpecification }}
                  />
                  <Layer
                    id="airspaces-trsa-fill"
                    type="fill"
                    source="src-airspaces"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'TRSA']]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                  <Layer
                    id="airspaces-trsa-label"
                    type="symbol"
                    source="src-airspaces"
                    source-layer="airspaces"
                    minzoom={8}
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'TRSA']]}
                    layout={airspaceLabelLayout}
                    paint={{
                      'text-color': isDarkMap ? slateDark.slate11 : slate.slate11,
                      'text-halo-color': haloColor,
                      'text-halo-width': 1.5
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
                    source="src-airspaces"
                    source-layer="airspaces"
                    filter={['==', ['get', 'type'], 'E']}
                    paint={{
                      'line-color': crimson.crimson9, // crimson-9
                      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 12] as unknown as maplibregl.ExpressionSpecification,
                      'line-opacity': 0.1
                    }}
                  />
                  <Layer
                    id="airspaces-class-e-hairline"
                    type="line"
                    source="src-airspaces"
                    source-layer="airspaces"
                    filter={['all', ['==', ['get', 'type'], 'E'], ['any', ['==', ['get', 'lower_limit'], '0'], ['==', ['get', 'lower_limit'], 'SFC']]]}
                    paint={{
                      'line-color': crimson.crimson9, // crimson-9
                      'line-width': 1,
                      'line-offset': 1,
                      'line-dasharray': [12, 12]
                    }}
                  />
                  <Layer
                    id="airspaces-class-e-fill"
                    type="fill"
                    source="src-airspaces"
                    source-layer="airspaces"
                    filter={['==', ['get', 'type'], 'E']}
                    paint={{ 'fill-opacity': 0 }}
                  />
                </>
              )}
            </>
          )}

          {/* Airways */}
          {aeronauticalLayers.showAirwaysMaster && aeronauticalLayers.airways && (
            <>
              {aeronauticalLayers.enrouteLow && (
                <>
                  <Layer id="airways-low-line" type="line" source="src-enroute" source-layer="airways" filter={['==', ['get', 'structure'], 'Low']} paint={airwayLinePaint} />
                  <>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Layer id="airways-low-symbol" type="symbol" source="src-enroute" source-layer="airways" minzoom={getZoom(6)} filter={['==', ['get', 'structure'], 'Low']} layout={{ ...airwaySymbolLayout, 'symbol-sort-key': 20 } as any} paint={airwaySymbolPaint} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Layer id="airways-low-mea" type="symbol" source="src-enroute" source-layer="airways" minzoom={getZoom(6)} filter={['==', ['get', 'structure'], 'Low']} layout={{ ...airwayMeaLayout, 'symbol-sort-key': 21 } as any} paint={airwayDetailPaint} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Layer id="airways-low-dist" type="symbol" source="src-enroute" source-layer="airways" minzoom={getZoom(6)} filter={['==', ['get', 'structure'], 'Low']} layout={{ ...airwayDistLayout, 'symbol-sort-key': 21 } as any} paint={airwayDetailPaint} />
                  </>
                </>
              )}
              {aeronauticalLayers.enrouteHigh && (
                <>
                  <Layer id="airways-high-line" type="line" source="src-enroute" source-layer="airways" filter={['==', ['get', 'structure'], 'High']} paint={airwayLinePaint} />
                  <>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Layer id="airways-high-symbol" type="symbol" source="src-enroute" source-layer="airways" minzoom={getZoom(6)} filter={['==', ['get', 'structure'], 'High']} layout={{ ...airwaySymbolLayout, 'symbol-sort-key': 20 } as any} paint={airwaySymbolPaint} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Layer id="airways-high-mea" type="symbol" source="src-enroute" source-layer="airways" minzoom={getZoom(6)} filter={['==', ['get', 'structure'], 'High']} layout={{ ...airwayMeaLayout, 'symbol-sort-key': 21 } as any} paint={airwayDetailPaint} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Layer id="airways-high-dist" type="symbol" source="src-enroute" source-layer="airways" minzoom={getZoom(6)} filter={['==', ['get', 'structure'], 'High']} layout={{ ...airwayDistLayout, 'symbol-sort-key': 21 } as any} paint={airwayDetailPaint} />
                  </>
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
              minzoom={10}
              filter={getZoomRankFilter({ 0: 0, 7: 2, 9: 3, 11: 6 })}
              layout={{
                'icon-image': [
                  'case',
                  ['==', ['get', 'type'], 'WINDMILL'], 'obs-wind-turbine',
                  ['==', ['get', 'lighting'], 'R'], 'obs-lighted-mod',
                  ['>=', ['to-number', ['get', 'agl'], 0], 1000], 'obs-major',
                  'obs-minor'
                ] as unknown as maplibregl.ExpressionSpecification,
                'icon-size': [
                  'interpolate', ['linear'], ['zoom'],
                  7, 0.35,
                  12, 0.6
                ] as unknown as maplibregl.ExpressionSpecification,
                'icon-allow-overlap': false,
                'icon-ignore-placement': false,
                'icon-padding': 2,
                'text-field': [
                  'step', ['zoom'],
                  '', // no label below z10
                  10, ['concat', ['to-string', ['get', 'agl']], '\'']
                ] as unknown as maplibregl.ExpressionSpecification,
                'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                'text-size': 9,
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-optional': true,
                'symbol-sort-key': ['+', 100, ['to-number', ['get', 'agl'], 0]] as unknown as maplibregl.ExpressionSpecification,
              }}
              paint={{
                'text-color': obstacleTextColor,
                'text-halo-color': haloColor,
                'text-halo-width': 1,
              }}
            />
          )}

          {/* Localizers */}
          {aeronauticalLayers.showAirportsMaster && aeronauticalLayers.publicAirports && (
            <Layer
              id="localizers-symbol"
              type="symbol"
              source="src-airports-navaids"
              source-layer="localizers"
              minzoom={9}
              layout={{
                'icon-image': 'navaid-vor',
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
          )}

          {/* Waypoints */}
          {aeronauticalLayers.showAirwaysMaster && aeronauticalLayers.waypoints && (
            <Layer
              id="waypoints-symbol"
              type="symbol"
              source="src-waypoints-obstacles"
              source-layer="waypoints"
              minzoom={getZoom(4)}
              filter={getZoomRankFilter({ 0: 2, 5: 3, 7: 4, 9: 6 })}
              layout={{
                'icon-image': [
                  'match',
                  ['get', 'type'],
                  'compulsory', 'fix-compulsory',
                  'rnav', 'wpt-rnav-open',
                  'fix-non-compulsory'
                ] as unknown as maplibregl.ExpressionSpecification,
                'icon-size': 0.7,
                'icon-allow-overlap': false,
                'icon-ignore-placement': false,
                'text-field': ['get', 'id'],
                'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                'text-size': 9,
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'symbol-sort-key': [
                  'match',
                  ['get', 'type'],
                  'compulsory', 10,
                  'named', 15,
                  20
                ] as unknown as maplibregl.ExpressionSpecification
              }}
              paint={{
                'text-color': waypointTextColor,
                'text-halo-color': haloColor,
                'text-halo-width': 1.5
              }}
            />
          )}

          {/* Navaids Points */}
          {aeronauticalLayers.showAirwaysMaster && aeronauticalLayers.navaids && (
            <Layer
              id="navaids-symbol"
              type="symbol"
              source="src-airports-navaids"
              source-layer="navaids"
              filter={getZoomRankFilter({ 0: 1, 5: 2, 6: 3, 7: 4, 8: 6 })}
              layout={{
                'icon-image': [
                  'match',
                  ['get', 'type'],
                  'ndb', 'navaid-ndb',
                  'navaid-vor'
                ],
                'icon-size': 0.8,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'text-field': ['get', 'id'],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
                'text-size': 11,
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-padding': 2,
                'symbol-sort-key': 10
              }}
              paint={{
                'text-color': accentTextColor,
                'text-halo-color': haloColor,
                'text-halo-width': 1.5
              }}
            />
          )}

          {/* Airports */}
          {aeronauticalLayers.showAirportsMaster && (
            <>
              {/* Fuel Ticks Underlay */}
              <Layer
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
              />
              {aeronauticalLayers.publicAirports && (
                <>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Layer id="airports-public" type="symbol" source="src-airports-navaids" source-layer="airports" filter={['all', ['in', ['get', 'facility_type'], ['literal', ['civil_hard', 'civil_soft', 'seaplane', 'military']]], getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 })] as maplibregl.ExpressionSpecification} layout={{ ...airportSymbolLayout, 'symbol-sort-key': 1 } as any} paint={airportSymbolPaint} />
                </>
              )}
              {aeronauticalLayers.privateAirports && (
                <>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Layer id="airports-private" type="symbol" source="src-airports-navaids" source-layer="airports" filter={['all', ['==', ['get', 'facility_type'], 'private'], getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 })] as maplibregl.ExpressionSpecification} layout={{ ...airportSymbolLayout, 'symbol-sort-key': 2 } as any} paint={airportSymbolPaint} />
                </>
              )}
              {aeronauticalLayers.heliports && (
                <>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Layer id="airports-heliport" type="symbol" source="src-airports-navaids" source-layer="airports" filter={['all', ['==', ['get', 'facility_type'], 'heliport'], getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 })] as maplibregl.ExpressionSpecification} layout={{ ...airportSymbolLayout, 'symbol-sort-key': 3 } as any} paint={airportSymbolPaint} />
                </>
              )}
              {aeronauticalLayers.otherAirports && (
                <>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Layer id="airports-other" type="symbol" source="src-airports-navaids" source-layer="airports" filter={['all', ['!', ['in', ['get', 'facility_type'], ['literal', ['civil_hard', 'civil_soft', 'seaplane', 'military', 'private', 'heliport']]]], getZoomRankFilter({ 0: 1, 7: 2, 9: 3, 11: 6 })] as maplibregl.ExpressionSpecification} layout={{ ...airportSymbolLayout, 'symbol-sort-key': 4 } as any} paint={airportSymbolPaint} />
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Hover Tooltip */}
      {hoverInfo && (
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
              backgroundColor: 'var(--glass-bg)',
              backdropFilter: 'blur(12px)',
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
                <Text size="1" color={grayColor} weight="medium" style={{ fontStyle: 'italic' }}>
                  + {hoverInfo.features.length - 2} more features...
                </Text>
                <Text size="1" color={accentColor} weight="bold" as="div" mt="1">
                  Click to see all
                </Text>
              </Box>
            )}
          </Card>
        </Popup>
      )}
    </Map>
  );
};
