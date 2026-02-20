import { useState } from 'react';
import { VfrMap } from './components/Map/VfrMap';
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel';

function App() {
  const [basemapUrlOrId, setBasemapUrlOrId] = useState(
    'faa-sectional'
  );
  const [showTerrain, setShowTerrain] = useState(false);
  const [showAeronautical, setShowAeronautical] = useState(true);
  const [basemapBrightness, setBasemapBrightness] = useState(100);

  return (
    <div className="app-container">
      <SettingsPanel
        basemap={basemapUrlOrId}
        setBasemap={setBasemapUrlOrId}
        showTerrain={showTerrain}
        setShowTerrain={setShowTerrain}
        showAeronautical={showAeronautical}
        setShowAeronautical={setShowAeronautical}
        basemapBrightness={basemapBrightness}
        setBasemapBrightness={setBasemapBrightness}
      />
      <VfrMap
        basemapUrlOrId={basemapUrlOrId}
        showTerrain={showTerrain}
        showAeronautical={showAeronautical}
        basemapBrightness={basemapBrightness}
      />
    </div>
  );
}

export default App;
