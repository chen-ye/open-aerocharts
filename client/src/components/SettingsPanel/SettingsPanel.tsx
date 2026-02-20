import React, { useState } from 'react';
import { Layers } from 'lucide-react';

interface SettingsPanelProps {
  basemap: string;
  setBasemap: (url: string) => void;
  showTerrain: boolean;
  setShowTerrain: (show: boolean) => void;
  showAeronautical: boolean;
  setShowAeronautical: (show: boolean) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  basemap,
  setBasemap,
  showTerrain,
  setShowTerrain,
  showAeronautical,
  setShowAeronautical,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <>
      {!isOpen && (
        <button
          className="icon-btn glass-panel toggle-btn"
          onClick={() => setIsOpen(true)}
          title="Open Settings"
        >
          <Layers size={20} />
        </button>
      )}

      <div className={`settings-panel glass-panel ${isOpen ? '' : 'hidden'}`}>
        <div className="settings-header">
          <h2>Map Settings</h2>
          <button
            className="icon-btn"
            onClick={() => setIsOpen(false)}
            title="Close Settings"
          >
            &times;
          </button>
        </div>

        <div className="form-group">
          <label htmlFor="basemap-select">Basemap Style</label>
          <select
            id="basemap-select"
            className="settings-select"
            value={basemap}
            onChange={(e) => setBasemap(e.target.value)}
          >
            <optgroup label="Vector Basemaps">
              <option value="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json">CartoCDN Voyager</option>
              <option value="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json">CartoCDN Positron (Light)</option>
              <option value="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json">CartoCDN Dark Matter</option>
            </optgroup>
            <optgroup label="FAA Raster Maps">
              <option value="faa-sectional">VFR Sectional</option>
              <option value="faa-enroute">IFR High Enroute</option>
              <option value="faa-ifrlo">IFR Low Enroute</option>
            </optgroup>
          </select>
        </div>

        <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--size-2)' }}>
          <input
            type="checkbox"
            id="terrain-toggle"
            checked={showTerrain}
            onChange={(e) => setShowTerrain(e.target.checked)}
          />
          <label htmlFor="terrain-toggle" style={{ margin: 0, cursor: 'pointer' }}>Show 3D Terrain</label>
        </div>

        <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--size-2)' }}>
          <input
            type="checkbox"
            id="aero-toggle"
            checked={showAeronautical}
            onChange={(e) => setShowAeronautical(e.target.checked)}
          />
          <label htmlFor="aero-toggle" style={{ margin: 0, cursor: 'pointer' }}>Show OpenAIP Data</label>
        </div>
      </div>
    </>
  );
};
