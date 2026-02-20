import React, { useMemo, useCallback, useState } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { addVfrIcons } from '../../utils/vfrIcons';
import styles from '../../mapStyles';

interface VfrMapProps {
  basemapUrlOrId: string;
  showTerrain: boolean;
  showAeronautical: boolean;
}

export const VfrMap: React.FC<VfrMapProps> = ({
  basemapUrlOrId,
  showTerrain,
  showAeronautical,
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
            id="airspaces-fill"
            type="fill"
            source="cifp"
            source-layer="airspaces"
            paint={{
              'fill-color': [
                'match',
                ['get', 'type'],
                'B', 'rgba(0, 0, 255, 0.1)', // Class B (Solid Blue)
                'C', 'rgba(255, 0, 255, 0.1)', // Class C (Solid Magenta)
                'D', 'rgba(0, 0, 255, 0.1)', // Class D (Dashed Blue)
                'rgba(150, 150, 150, 0.1)'
              ],
              'fill-outline-color': [
                'match',
                ['get', 'type'],
                'B', '#0000FF',
                'C', '#FF00FF',
                'D', '#0000FF',
                '#969696'
              ]
            }}
          />
          <Layer
            id="airspaces-line"
            type="line"
            source="cifp"
            source-layer="airspaces"
            paint={{
              'line-color': [
                'match',
                ['get', 'type'],
                'B', '#0000FF',
                'C', '#FF00FF',
                'D', '#0000FF',
                '#969696'
              ],
              'line-width': 2,
              'line-dasharray': [
                 'match',
                 ['get', 'type'],
                 'D', ['literal', [2, 2]],
                 ['literal', [1]] // default solid
              ]
            }}
          />
          <Layer
            id="airways-line"
            type="line"
            source="cifp"
            source-layer="airways"
            paint={{
              'line-color': '#0ea5e9', // Light blue
              'line-width': 2,
              'line-opacity': 0.6
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
              'text-anchor': 'top'
            }}
            paint={{
              'text-color': '#e012a6',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2
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
              'text-field': ['get', 'id'],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Regular'],
              'text-size': 11,
              'text-offset': [0, 1.2],
              'text-anchor': 'top'
            }}
            paint={{
              'text-color': '#2563eb',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1
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
          <div className="glass-panel" style={{ padding: 'var(--size-2)', maxHeight: '300px', overflowY: 'auto' }}>
            {hoverInfo.features.map((f, i) => (
              <div key={i} style={{
                paddingBottom: i < hoverInfo.features.length - 1 ? 'var(--size-2)' : '0',
                borderBottom: i < hoverInfo.features.length - 1 ? '1px solid var(--surface-3)' : 'none',
                marginBottom: i < hoverInfo.features.length - 1 ? 'var(--size-2)' : '0'
              }}>
                <div style={{ fontWeight: 'bold', textTransform: 'uppercase', fontSize: 'var(--font-size-0)', color: 'var(--text-1)', marginBottom: 'var(--size-1)' }}>
                  {f.sourceLayer || f.layer?.id}
                </div>
                {Object.entries(f.properties || {}).map(([key, value]) => {
                  if (key === 'source_id' || key === 'geometry') return null;
                  return (
                    <div key={key} style={{ fontSize: 'var(--font-size-00)', display: 'flex', justifyContent: 'space-between', gap: 'var(--size-3)', lineHeight: '1.2', paddingBottom: '2px' }}>
                      <span style={{ color: 'var(--text-2)' }}>{key}:</span>
                      <span style={{ color: 'var(--text-1)', textAlign: 'right', wordBreak: 'break-word', fontWeight: 500 }}>{String(value)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Popup>
      )}
    </Map>
  );
};
