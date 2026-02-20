import React, { useMemo, useCallback, useState } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { Card, Box, Text, Flex } from '@radix-ui/themes';
import { addVfrIcons } from '../../utils/vfrIcons';
import styles from '../../mapStyles';

interface VfrMapProps {
  basemapUrlOrId: string;
  showTerrain: boolean;
  showAeronautical: boolean;
  basemapBrightness: number;
}

export const VfrMap: React.FC<VfrMapProps> = ({
  basemapUrlOrId,
  showTerrain,
  showAeronautical,
  basemapBrightness,
}) => {
  // We use CartoCDN base map, but MapLibre requires it via the `mapStyle` prop.
  // The Map component from react-map-gl handles style reloading when basemapUrl changes.

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
    'airspaces-fill',
    'airports-symbol',
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

  return (
    <Map
      onLoad={onMapLoad}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      interactiveLayerIds={showAeronautical ? interactiveLayerIds : []}
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
      {showAeronautical && (
        <Source
          id="cifp"
          type="vector"
          url="pmtiles:///cifp_data.pmtiles"
        />
      )}
      {showAeronautical && (
        <>
          {/* Airspaces */}
          <Layer
            id="airspaces-line"
            type="line"
            source="cifp"
            source-layer="airspaces"
            filter={['!=', ['get', 'type'], 'E']}
            paint={{
              'line-color': [
                'match',
                ['get', 'type'],
                'B', '#0040D9', // Class B Solid Blue
                'C', '#A8007F', // Class C Solid Magenta
                'D', '#0040D9', // Class D Dashed Blue
                '#969696'
              ],
              'line-width': [
                'match',
                ['get', 'type'],
                'B', 3,
                'C', 3,
                'D', 1.5,
                1
              ],
              'line-dasharray': [
                 'match',
                 ['get', 'type'],
                 'D', ['literal', [4, 4]], // Class D dashes
                 ['literal', [1]] // default solid
              ]
            }}
          />
          {/* Class E Vignette: Blur layer (Bottom) */}
          <Layer
            id="airspaces-vignette-blur"
            type="line"
            source="cifp"
            source-layer="airspaces"
            filter={['==', ['get', 'type'], 'E']}
            paint={{
              // Magenta is typical for floors at 700 AGL; Blue is typical for 1200+ AGL
              // But without exact data, we use a nice magenta here
              'line-color': '#A8007F',
              'line-width': 12,
              'line-blur': 8,
              'line-opacity': 0.5
            }}
          />
          {/* Class E Vignette: Crisp layer (Top) */}
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
            id="airways-line"
            type="line"
            source="cifp"
            source-layer="airways"
            paint={{
              'line-color': [
                'match',
                ['get', 'route_type'],
                'Victor', '#000000',
                'GPS', '#0040D9',
                'LFMF', '#8B4513',
                '#0ea5e9' // default light blue
              ],
              'line-width': [
                'case',
                ['>', ['get', 'width'], 5], 4,
                1.5 // default thin line
              ],
              'line-opacity': 0.7
            }}
          />
          {/* Airway Labels */}
          <Layer
            id="airways-symbol"
            type="symbol"
            source="cifp"
            source-layer="airways"
            minzoom={6}
            layout={{
              'symbol-placement': 'line-center',
              'text-field': [
                'format',
                ['to-string', ['get', 'mea']], { 'font-scale': 0.85 },
                '\n', {},
                ['get', 'airway'], { 'font-scale': 1.0 },
                '\n', {},
                ['to-string', ['get', 'distance']], { 'font-scale': 0.85 }
              ],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
              'text-size': 11,
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-rotation-alignment': 'map',
              'text-pitch-alignment': 'map'
            }}
            paint={{
              'text-color': '#000000',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2,
            }}
          />
          {/* Runway footprints */}
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
          {/* Airports Points */}
          <Layer
            id="airports-symbol"
            type="symbol"
            source="cifp"
            source-layer="airports"
            layout={{
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
            }}
            paint={{
              'text-color': '#A8007F',
              'text-halo-color': 'rgba(255, 255, 255, 0.95)',
              'text-halo-width': 1.5
            }}
          />
          {/* Navaids Points */}
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
          {/* Localizers */}
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
