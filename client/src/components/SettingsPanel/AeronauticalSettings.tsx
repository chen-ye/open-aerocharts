import React from 'react';
import { Box, Flex, Switch, Text, Separator } from '@radix-ui/themes';
import type { AeronauticalLayerState } from '../../types/AeronauticalLayerState';
import { grayColor } from '../../App.tsx';

interface AeronauticalSettingsProps {
  layers: AeronauticalLayerState;
  setLayers: React.Dispatch<React.SetStateAction<AeronauticalLayerState>>;
}

export const AeronauticalSettings: React.FC<AeronauticalSettingsProps> = ({ layers, setLayers }) => {
  const updateLayer = (key: keyof AeronauticalLayerState, value: boolean) => {
    setLayers((prev: AeronauticalLayerState) => ({ ...prev, [key]: value }));
  };

  const updateMasterGroup = (
    masterKey: keyof AeronauticalLayerState,
    value: boolean
  ) => {
    setLayers((prev: AeronauticalLayerState) => ({ ...prev, [masterKey]: value }));
  };

  return (
    <Flex direction="column" gap="4">
      {/* Master Toggle */}
      <Flex align="center" justify="between">
        <Text size="2" weight="bold" color={grayColor} style={{ textTransform: 'uppercase' }}>Aeronautical Data</Text>
        <Switch
          checked={layers.showAll}
          onCheckedChange={(c: boolean) => updateLayer('showAll', c)}
        />
      </Flex>

      {layers.showAll && (
        <Flex direction="column" gap="4">

          {/* Airports */}
          <Box>
            <Flex align="center" justify="between" mb="2">
              <Text size="2" weight="bold">Airports</Text>
              <Switch
                size="1"
                checked={layers.showAirportsMaster}
                onCheckedChange={(c: boolean) => updateMasterGroup('showAirportsMaster', c)}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <ToggleRow label="Public Airports" checked={layers.publicAirports} disabled={!layers.showAirportsMaster} onChange={(c: boolean) => updateLayer('publicAirports', c)} />
              <ToggleRow label="Heliports" checked={layers.heliports} disabled={!layers.showAirportsMaster} onChange={(c: boolean) => updateLayer('heliports', c)} />
              <ToggleRow label="Private Airports" checked={layers.privateAirports} disabled={!layers.showAirportsMaster} onChange={(c: boolean) => updateLayer('privateAirports', c)} />
              <ToggleRow label="Other Fields" checked={layers.otherAirports} disabled={!layers.showAirportsMaster} onChange={(c: boolean) => updateLayer('otherAirports', c)} />
            </Flex>
          </Box>
          <Separator size="4" />

          {/* Airspace */}
          <Box>
            <Flex align="center" justify="between" mb="2">
              <Text size="2" weight="bold">Airspace</Text>
              <Switch
                size="1"
                checked={layers.showAirspaceMaster}
                onCheckedChange={(c: boolean) => updateMasterGroup('showAirspaceMaster', c)}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <ToggleRow label="Controlled (B/C/D)" checked={layers.controlledAirspace} disabled={!layers.showAirspaceMaster} onChange={(c: boolean) => updateLayer('controlledAirspace', c)} />
              <ToggleRow label="SUA / MOA" checked={layers.suaMoa} disabled={!layers.showAirspaceMaster} onChange={(c: boolean) => updateLayer('suaMoa', c)} />
              <ToggleRow label="TRSA" checked={layers.trsa} disabled={!layers.showAirspaceMaster} onChange={(c: boolean) => updateLayer('trsa', c)} />
              <ToggleRow label="Class E" checked={layers.classE} disabled={!layers.showAirspaceMaster} onChange={(c: boolean) => updateLayer('classE', c)} />
              <ToggleRow label="Parachute Area" checked={layers.parachuteArea} disabled={!layers.showAirspaceMaster} onChange={(c: boolean) => updateLayer('parachuteArea', c)} />
              <ToggleRow label="Mode C" checked={layers.modeC} disabled={!layers.showAirspaceMaster} onChange={(c: boolean) => updateLayer('modeC', c)} />
            </Flex>
          </Box>
          <Separator size="4" />

          {/* Airways & Waypoints */}
          <Box>
            <Flex align="center" justify="between" mb="2">
              <Text size="2" weight="bold">Airways & Waypoints</Text>
              <Switch
                size="1"
                checked={layers.showAirwaysMaster}
                onCheckedChange={(c: boolean) => updateMasterGroup('showAirwaysMaster', c)}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <ToggleRow label="Enroute High" checked={layers.enrouteHigh} disabled={!layers.showAirwaysMaster} onChange={(c: boolean) => updateLayer('enrouteHigh', c)} />
              <ToggleRow label="Enroute Low" checked={layers.enrouteLow} disabled={!layers.showAirwaysMaster} onChange={(c: boolean) => updateLayer('enrouteLow', c)} />
              <ToggleRow label="Airways" checked={layers.airways} disabled={!layers.showAirwaysMaster} onChange={(c: boolean) => updateLayer('airways', c)} />
              <ToggleRow label="Navaids" checked={layers.navaids} disabled={!layers.showAirwaysMaster} onChange={(c: boolean) => updateLayer('navaids', c)} />
              <ToggleRow label="Waypoints" checked={layers.waypoints} disabled={!layers.showAirwaysMaster} onChange={(c: boolean) => updateLayer('waypoints', c)} />
            </Flex>
          </Box>
          <Separator size="4" />

          {/* ARTCC/FIR */}
          <Box>
            <Flex align="center" justify="between" mb="2">
              <Text size="2" weight="bold">ARTCC / FIR</Text>
              <Switch
                size="1"
                checked={layers.showArtccMaster}
                onCheckedChange={(c: boolean) => updateMasterGroup('showArtccMaster', c)}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <ToggleRow label="ARTCC / FIRs" checked={layers.artccFirs} disabled={!layers.showArtccMaster} onChange={(c: boolean) => updateLayer('artccFirs', c)} />
              <ToggleRow label="FISAs" checked={layers.fisas} disabled={!layers.showArtccMaster} onChange={(c: boolean) => updateLayer('fisas', c)} />
              <ToggleRow label="ATC Sectors" checked={layers.atcSectors} disabled={!layers.showArtccMaster} onChange={(c: boolean) => updateLayer('atcSectors', c)} />
            </Flex>
          </Box>
          <Separator size="4" />

          {/* Standalone */}
          <Box>
            <Flex direction="column" gap="2">
              <ToggleRow label="Obstacles (DOF)" checked={layers.obstacles} onChange={(c: boolean) => updateLayer('obstacles', c)} />
            </Flex>
          </Box>

        </Flex>
      )}
    </Flex>
  );
};

const ToggleRow = ({ label, checked, disabled, onChange }: { label: string, checked: boolean, disabled?: boolean, onChange: (c: boolean) => void }) => (
  <Flex align="center" justify="between">
    <Text size="2" color={disabled ? grayColor : undefined} style={{ opacity: disabled ? 0.5 : 1 }}>{label}</Text>
    <Switch size="1" checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </Flex>
);
