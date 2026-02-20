import { useState } from 'react';
import { VfrMap } from './components/Map/VfrMap';
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel';

function App() {
  const [basemapUrlOrId, setBasemapUrlOrId] = useState(
    'faa-sectional'
  );
  const [showTerrain, setShowTerrain] = useState(false);
  const [showAeronautical, setShowAeronautical] = useState(true);

  return (
    <div className="app-container">
      <SettingsPanel
        basemap={basemapUrlOrId}
        setBasemap={setBasemapUrlOrId}
        showTerrain={showTerrain}
        setShowTerrain={setShowTerrain}
        showAeronautical={showAeronautical}
        setShowAeronautical={setShowAeronautical}
      />
      <VfrMap
        basemapUrlOrId={basemapUrlOrId}
        showTerrain={showTerrain}
        showAeronautical={showAeronautical}
      />
    </div>
  );
}

export default App;
