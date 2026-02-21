import { useState, useEffect } from 'react';
import { AeroMap } from './components/Map/AeroMap';
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel';
import { FlightPlanPanel } from './components/FlightPlanPanel/FlightPlanPanel';
import { MobileBottomSheet } from './components/MobileBottomSheet/MobileBottomSheet';
import { defaultAeronauticalState } from './types/AeronauticalLayerState';
import type { AeronauticalLayerState } from './types/AeronauticalLayerState';
import type { FlightPlan, SearchIndex } from './types/FlightPlan';
import { Theme } from '@radix-ui/themes';

export const accentColor = "iris" as const;
export const grayColor = "gray" as const;

function App() {
  const [basemapUrlOrId, setBasemapUrlOrId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('basemap') || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
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

  const [routeString, setRouteString] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('route') || '';
  });

  const [flightPlan, setFlightPlan] = useState<FlightPlan | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedFeatures, setSelectedFeatures] = useState<{ lngLat: [number, number]; features: any[] } | null>(null);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);

  useEffect(() => {
    if (index || indexLoading) return;

    const loadIndex = async () => {
      setIndexLoading(true);
      try {
        const res = await fetch('search_index.json');
        const data = await res.json();
        setIndex(data);
      } catch (err) {
        console.error("Failed to load search index", err);
      } finally {
        setIndexLoading(false);
      }
    };

    loadIndex();
  }, [index, indexLoading]);

  const [aeronauticalLayers, setAeronauticalLayers] = useState<AeronauticalLayerState>(() => {
    const params = new URLSearchParams(window.location.search);
    const layersParam = params.get('layers');
    const densityParam = params.get('density');

    const initialState = { ...defaultAeronauticalState };

    if (densityParam) {
      const density = parseInt(densityParam, 10);
      if (!isNaN(density)) {
        initialState.declutterLevel = density;
      }
    }

    if (!layersParam) return initialState;

    if (layersParam === 'none') {
      return Object.keys(initialState).reduce((acc, key) => {
        const k = key as keyof AeronauticalLayerState;
        if (typeof initialState[k] === 'number') {
          // @ts-expect-error - indexing is safe here
          acc[k] = initialState[k];
        } else {
          // @ts-expect-error - indexing is safe here
          acc[k] = false;
        }
        return acc;
      }, { ...initialState });
    }

    const enabledLayers = new Set(layersParam.split(','));
    return Object.keys(initialState).reduce((acc, key) => {
      const k = key as keyof AeronauticalLayerState;
      if (typeof initialState[k] === 'boolean') {
        // @ts-expect-error - indexing is safe here
        acc[k] = enabledLayers.has(key);
      }
      return acc;
    }, { ...initialState });
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

    if (routeString) {
      if (params.get('route') !== routeString) {
        params.set('route', routeString);
        changed = true;
      }
    } else if (params.has('route')) {
      params.delete('route');
      changed = true;
    }

    const isLayersDefault = Object.entries(aeronauticalLayers).every(
      ([key, val]) => {
        if (key === 'declutterLevel') return true; // Handled separately
        return defaultAeronauticalState[key as keyof AeronauticalLayerState] === val;
      }
    );

    if (!isLayersDefault) {
      const enabledLayers = Object.entries(aeronauticalLayers)
        .filter(([, value]) => typeof value === 'boolean' && value === true)
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

    if (aeronauticalLayers.declutterLevel !== 0) {
      if (params.get('density') !== aeronauticalLayers.declutterLevel.toString()) {
        params.set('density', aeronauticalLayers.declutterLevel.toString());
        changed = true;
      }
    } else if (params.has('density')) {
      params.delete('density');
      changed = true;
    }

    if (routeString) {
      if (params.get('route') !== routeString) {
        params.set('route', routeString);
        changed = true;
      }
    } else if (params.has('route')) {
      params.delete('route');
      changed = true;
    }

    if (changed) {
      const newSearch = params.toString();
      const newUrl = newSearch ? `?${newSearch}${window.location.hash}` : window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', newUrl);
    }
  }, [basemapUrlOrId, showTerrain, aeronauticalLayers, basemapBrightness, routeString]);

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
          flightPlan={flightPlan}
          selectedFeatures={selectedFeatures}
          onSelectFeatures={setSelectedFeatures}
        />
        <FlightPlanPanel
          onFlightPlanChange={setFlightPlan}
          routeString={routeString}
          onRouteStringChange={setRouteString}
          index={index}
          loading={indexLoading}
        />
        <MobileBottomSheet
          selectedFeatures={selectedFeatures}
          onCloseFeatures={() => setSelectedFeatures(null)}
          onFlightPlanChange={setFlightPlan}
          routeString={routeString}
          onRouteStringChange={setRouteString}
          index={index}
          loading={indexLoading}
        />
      </div>
    </Theme>
  );
}

export default App;
