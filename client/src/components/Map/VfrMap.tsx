import React, { useMemo, useCallback, useState } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { Card, Box, Text, Flex } from '@radix-ui/themes';
import { addVfrIcons } from '../../utils/vfrIcons';
import styles from '../../mapStyles';
import type { AeronauticalLayerState } from '../../types/AeronauticalLayerState';

interface VfrMapProps {
  basemapUrlOrId: string;
  showTerrain: boolean;
  aeronauticalLayers: AeronauticalLayerState;
  basemapBrightness: number;
}

export const VfrMap: React.FC<VfrMapProps> = ({
  basemapUrlOrId,
  showTerrain,
  aeronauticalLayers,
  basemapBrightness,
}) => {
  const mapStyle = useMemo<string | maplibregl.StyleSpecification>(() => {
    // If the basemapUrlOrId is a URL, treat it as a style URL
    if (URL.canParse(basemapUrlOrId)) {
      return basemapUrlOrId;
    }
    const style = styles[basemapUrlOrId as keyof typeof styles] ?? styles['faa-sectional'];
    return style;
  }, [basemapUrlOrId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMapLoad = useCallback((e: any) => {
    addVfrIcons(e.target);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hoverInfo, setHoverInfo] = useState<{ lngLat: [number, number]; features: any[] } | null>(null);

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
    'localizers-symbol'
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
      'Victor', '#000000',
      'GPS', '#0040D9',
      'LFMF', '#8B4513',
      '#0ea5e9' // default light blue
    ] as unknown as maplibregl.ExpressionSpecification,
    'line-width': [
      'case',
      ['>', ['get', 'width'], 5], 4,
      1.5 // default thin line
    ] as unknown as maplibregl.ExpressionSpecification,
    'line-opacity': 0.7
  }), []);

  const airwaySymbolLayout: maplibregl.SymbolLayerSpecification['layout'] = useMemo(() => ({
    'symbol-placement': 'line-center',
    'text-field': [
      'format',
      ['to-string', ['get', 'mea']], { 'font-scale': 0.85 },
      '\n', {},
      ['get', 'airway'], { 'font-scale': 1.0 },
      '\n', {},
      ['to-string', ['get', 'distance']], { 'font-scale': 0.85 }
    ] as unknown as maplibregl.ExpressionSpecification,
    'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
    'text-size': 11,
    'text-allow-overlap': false,
    'text-ignore-placement': false,
    'text-rotation-alignment': 'map',
    'text-pitch-alignment': 'map'
  }), []);

  const airwaySymbolPaint: maplibregl.SymbolLayerSpecification['paint'] = useMemo(() => ({
    'text-color': '#000000',
    'text-halo-color': '#ffffff',
    'text-halo-width': 2,
  }), []);

  const airportSymbolLayout: maplibregl.SymbolLayerSpecification['layout'] = useMemo(() => ({
    'icon-image': 'airport-magenta',
    'icon-size': 0.8,
    'icon-allow-overlap': true,
    'text-field': ['get', 'name'],
    'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
    'text-size': 12,
    'text-offset': [0, 1.2],
    'text-anchor': 'top',
    'text-allow-overlap': true,
    'text-ignore-placement': true, // Critical info always renders
  }), []);

  const airportSymbolPaint: maplibregl.SymbolLayerSpecification['paint'] = useMemo(() => ({
    'text-color': '#A8007F',
    'text-halo-color': 'rgba(255, 255, 255, 0.95)',
    'text-halo-width': 1.5
  }), []);

  const showRunways = aeronauticalLayers.showAirportsMaster &&
    (aeronauticalLayers.publicAirports || aeronauticalLayers.privateAirports || aeronauticalLayers.heliports);

  return (
    <Map
      onLoad={onMapLoad}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
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
    >
      <NavigationControl position="bottom-right" visualizePitch={true} />

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
      {showTerrain && (
        <Layer
          id="hillshade-layer"
          type="hillshade"
          source="aws-terrain"
          paint={{
            'hillshade-exaggeration': 1,
            'hillshade-shadow-color': '#000000',
            'hillshade-highlight-color': '#FFFFFF',
            'hillshade-accent-color': '#000000',
          }}
        />
      )}

      {/* Aeronautical Data from PMTiles */}
      {aeronauticalLayers.showAll && (
        <Source
          id="cifp"
          type="vector"
          url="pmtiles:///open-aerocharts/cifp_data.pmtiles"
        />
      )}
      {aeronauticalLayers.showAll && (
        <>
          {/* Airspaces */}
          {aeronauticalLayers.showAirspaceMaster && (
            <>
              {aeronauticalLayers.controlledAirspace && (
                <>
                  <Layer
                    id="airspaces-class-b"
                    type="line"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'B']]}
                    paint={{ 'line-color': '#0040D9', 'line-width': 3 }}
                  />
                  <Layer
                    id="airspaces-class-b-fill"
                    type="fill"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'B']]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                  <Layer
                    id="airspaces-class-c"
                    type="line"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'C']]}
                    paint={{ 'line-color': '#A8007F', 'line-width': 3 }}
                  />
                  <Layer
                    id="airspaces-class-c-fill"
                    type="fill"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'C']]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                  <Layer
                    id="airspaces-class-d"
                    type="line"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'D']]}
                    paint={{ 'line-color': '#0040D9', 'line-width': 1.5, 'line-dasharray': [4, 4] }}
                  />
                  <Layer
                    id="airspaces-class-d-fill"
                    type="fill"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'D']]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                </>
              )}
              {aeronauticalLayers.suaMoa && (
                <>
                  <Layer
                    id="airspaces-sua"
                    type="line"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'is_sua'], true]]}
                    paint={{ 'line-color': '#969696', 'line-width': 1.5 }}
                  />
                  <Layer
                    id="airspaces-sua-fill"
                    type="fill"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'is_sua'], true]]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                </>
              )}
              {aeronauticalLayers.trsa && (
                <>
                  <Layer
                    id="airspaces-trsa"
                    type="line"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'TRSA']]}
                    paint={{ 'line-color': '#969696', 'line-width': 1.5 }}
                  />
                  <Layer
                    id="airspaces-trsa-fill"
                    type="fill"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['all', ['!=', ['get', 'type'], 'E'], ['==', ['get', 'airspace_class'], 'TRSA']]}
                    paint={{ 'fill-opacity': 0 }}
                  />
                </>
              )}
              {/* Class E Vignette */}
              {aeronauticalLayers.classE && (
                <>
                  <Layer
                    id="airspaces-vignette-blur"
                    type="line"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['==', ['get', 'type'], 'E']}
                    paint={{
                      'line-color': '#A8007F',
                      'line-width': 12,
                      'line-blur': 8,
                      'line-opacity': 0.5
                    }}
                  />
                  <Layer
                    id="airspaces-vignette-edge"
                    type="line"
                    source="cifp"
                    source-layer="airspaces"
                    filter={['==', ['get', 'type'], 'E']}
                    paint={{
                      'line-color': '#A8007F',
                      'line-width': 1,
                      'line-offset': 1
                    }}
                  />
                  <Layer
                    id="airspaces-class-e-fill"
                    type="fill"
                    source="cifp"
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
                  <Layer id="airways-low-line" type="line" source="cifp" source-layer="airways" filter={['==', ['get', 'structure'], 'Low']} paint={airwayLinePaint} />
                  <Layer id="airways-low-symbol" type="symbol" source="cifp" source-layer="airways" minzoom={6} filter={['==', ['get', 'structure'], 'Low']} layout={airwaySymbolLayout} paint={airwaySymbolPaint} />
                </>
              )}
              {aeronauticalLayers.enrouteHigh && (
                <>
                  <Layer id="airways-high-line" type="line" source="cifp" source-layer="airways" filter={['==', ['get', 'structure'], 'High']} paint={airwayLinePaint} />
                  <Layer id="airways-high-symbol" type="symbol" source="cifp" source-layer="airways" minzoom={6} filter={['==', ['get', 'structure'], 'High']} layout={airwaySymbolLayout} paint={airwaySymbolPaint} />
                </>
              )}
            </>
          )}
          {/* Airports */}
          {aeronauticalLayers.showAirportsMaster && (
            <>
              {showRunways && (
                <Layer
                  id="runways-line"
                  type="line"
                  source="cifp"
                  source-layer="runways"
                  paint={{
                    'line-color': '#000000',
                    'line-width': 4
                  }}
                />
              )}
              {aeronauticalLayers.publicAirports && (
                <Layer id="airports-public" type="symbol" source="cifp" source-layer="airports" filter={['==', ['get', 'facility_type'], 'public']} layout={airportSymbolLayout} paint={airportSymbolPaint} />
              )}
              {aeronauticalLayers.privateAirports && (
                <Layer id="airports-private" type="symbol" source="cifp" source-layer="airports" filter={['==', ['get', 'facility_type'], 'private']} layout={airportSymbolLayout} paint={airportSymbolPaint} />
              )}
              {aeronauticalLayers.heliports && (
                <Layer id="airports-heliport" type="symbol" source="cifp" source-layer="airports" filter={['==', ['get', 'facility_type'], 'heliport']} layout={airportSymbolLayout} paint={airportSymbolPaint} />
              )}
              {aeronauticalLayers.otherAirports && (
                <Layer id="airports-other" type="symbol" source="cifp" source-layer="airports" filter={['!', ['in', ['get', 'facility_type'], ['literal', ['public', 'private', 'heliport']]]]} layout={airportSymbolLayout} paint={airportSymbolPaint} />
              )}
            </>
          )}
        {/* Navaids Points */}
        {aeronauticalLayers.showAirwaysMaster && aeronauticalLayers.navaids && (
          <Layer
            id="navaids-symbol"
            type="symbol"
            source="cifp"
            source-layer="navaids"
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
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{
              'text-color': '#0040D9',
              'text-halo-color': 'rgba(255, 255, 255, 0.95)',
              'text-halo-width': 1.5
            }}
          />
        )}
        {/* Localizers */}
        {aeronauticalLayers.showAirportsMaster && aeronauticalLayers.publicAirports && (
          <Layer
            id="localizers-symbol"
            type="symbol"
            source="cifp"
            source-layer="localizers"
            layout={{
              'icon-image': 'navaid-vor', // TODO: create a localizer icon
              'icon-size': 0.5,
              'text-field': ['get', 'ident'],
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-size': 9,
              'text-offset': [1, 0],
              'text-anchor': 'left'
            }}
            paint={{
              'text-color': '#000000',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1
            }}
          />
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
              maxHeight: '300px',
              overflowY: 'auto',
              backgroundColor: 'var(--glass-bg)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {hoverInfo.features.map((f, i) => (
              <Box
                key={i}
                pb={i < hoverInfo.features.length - 1 ? '2' : '0'}
                mb={i < hoverInfo.features.length - 1 ? '2' : '0'}
                style={{
                  borderBottom: i < hoverInfo.features.length - 1 ? '1px solid var(--surface-3)' : 'none',
                }}
              >
                <Text
                  as="div"
                  weight="bold"
                  size="1"
                  color="gray"
                  mb="1"
                  style={{ textTransform: 'uppercase' }}
                >
                  {f.sourceLayer || f.layer?.id}
                </Text>
                {Object.entries(f.properties || {}).map(([key, value]) => {
                  if (key === 'source_id' || key === 'geometry') return null;
                  return (
                    <Flex key={key} justify="between" gap="3" style={{ lineHeight: '1.2', paddingBottom: '2px' }}>
                      <Text size="1" color="gray">{key}:</Text>
                      <Text size="1" weight="medium" style={{ textAlign: 'right', wordBreak: 'break-word' }}>
                        {String(value)}
                      </Text>
                    </Flex>
                  );
                })}
              </Box>
            ))}
          </Card>
        </Popup>
      )}
    </Map>
  );
};
