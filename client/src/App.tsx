import { useState, useEffect } from 'react';
import { AeroMap } from './components/Map/AeroMap';
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel';
import { defaultAeronauticalState } from './types/AeronauticalLayerState';
import type { AeronauticalLayerState } from './types/AeronauticalLayerState';
import { Theme } from '@radix-ui/themes';

export const accentColor = "purple" as const;
export const grayColor = "gray" as const;

function App() {
  const [basemapUrlOrId, setBasemapUrlOrId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('basemap') || 'faa-sectional';
  });

  const [showTerrain, setShowTerrain] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('terrain') === 'true';
  });

  const [basemapBrightness, setBasemapBrightness] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const brightness = params.get('brightness');
    return brightness ? parseInt(brightness, 10) : 100;
  });

  const [aeronauticalLayers, setAeronauticalLayers] = useState<AeronauticalLayerState>(() => {
    const params = new URLSearchParams(window.location.search);
    const layersParam = params.get('layers');
    if (!layersParam) return defaultAeronauticalState;

    if (layersParam === 'none') {
      return Object.keys(defaultAeronauticalState).reduce((acc, key) => {
        acc[key as keyof AeronauticalLayerState] = false;
        return acc;
      }, {} as Record<keyof AeronauticalLayerState, boolean>) as AeronauticalLayerState;
    }

    const enabledLayers = new Set(layersParam.split(','));
    return Object.keys(defaultAeronauticalState).reduce((acc, key) => {
      acc[key as keyof AeronauticalLayerState] = enabledLayers.has(key);
      return acc;
    }, {} as Record<keyof AeronauticalLayerState, boolean>) as AeronauticalLayerState;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;

    if (basemapUrlOrId !== 'faa-sectional') {
      if (params.get('basemap') !== basemapUrlOrId) {
        params.set('basemap', basemapUrlOrId);
        changed = true;
      }
    } else if (params.has('basemap')) {
      params.delete('basemap');
      changed = true;
    }

    if (showTerrain) {
      if (params.get('terrain') !== 'true') {
        params.set('terrain', 'true');
        changed = true;
      }
    } else if (params.has('terrain')) {
      params.delete('terrain');
      changed = true;
    }

    if (basemapBrightness !== 100) {
      if (params.get('brightness') !== basemapBrightness.toString()) {
        params.set('brightness', basemapBrightness.toString());
        changed = true;
      }
    } else if (params.has('brightness')) {
      params.delete('brightness');
      changed = true;
    }

    const isLayersDefault = Object.entries(aeronauticalLayers).every(
      ([key, val]) => defaultAeronauticalState[key as keyof AeronauticalLayerState] === val
    );

    if (!isLayersDefault) {
      const enabledLayers = Object.entries(aeronauticalLayers)
        .filter(([, value]) => value === true)
        .map(([key]) => key);

      const layersString = enabledLayers.length === 0 ? 'none' : enabledLayers.join(',');
      if (params.get('layers') !== layersString) {
        params.set('layers', layersString);
        changed = true;
      }
    } else if (params.has('layers')) {
      params.delete('layers');
      changed = true;
    }

    if (changed) {
      const newSearch = params.toString();
      const newUrl = newSearch ? `?${newSearch}${window.location.hash}` : window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', newUrl);
    }
  }, [basemapUrlOrId, showTerrain, aeronauticalLayers, basemapBrightness]);

  return (
    <Theme accentColor={accentColor} grayColor={grayColor} radius="medium">
      <div className="app-container">
        <SettingsPanel
          basemap={basemapUrlOrId}
          setBasemap={setBasemapUrlOrId}
          showTerrain={showTerrain}
          setShowTerrain={setShowTerrain}
          aeronauticalLayers={aeronauticalLayers}
          setAeronauticalLayers={setAeronauticalLayers}
          basemapBrightness={basemapBrightness}
          setBasemapBrightness={setBasemapBrightness}
        />
        <AeroMap
          basemapUrlOrId={basemapUrlOrId}
          showTerrain={showTerrain}
          aeronauticalLayers={aeronauticalLayers}
          basemapBrightness={basemapBrightness}
        />
      </div>
    </Theme>
  );
}

export default App;
