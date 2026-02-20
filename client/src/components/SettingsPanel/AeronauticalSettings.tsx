import React from 'react';
import { Box, Flex, Switch, Text, Separator } from '@radix-ui/themes';
import type { AeronauticalLayerState } from '../../types/AeronauticalLayerState';

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
    value: boolean,
    childKeys: (keyof AeronauticalLayerState)[]
  ) => {
    setLayers((prev: AeronauticalLayerState) => {
      const nextState = { ...prev, [masterKey]: value };
      childKeys.forEach(k => { nextState[k] = value; });
      return nextState;
    });
  };

  return (
    <Flex direction="column" gap="4">
      {/* Master Toggle */}
      <Flex align="center" justify="between">
        <Text size="2" weight="bold">Aeronautical Data</Text>
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
                onCheckedChange={(c: boolean) => updateMasterGroup('showAirportsMaster', c, ['publicAirports', 'privateAirports', 'heliports', 'otherAirports'])}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <ToggleRow label="Public Airports" checked={layers.publicAirports} onChange={(c: boolean) => updateLayer('publicAirports', c)} />
              <ToggleRow label="Heliports" checked={layers.heliports} onChange={(c: boolean) => updateLayer('heliports', c)} />
              <ToggleRow label="Private Airports" checked={layers.privateAirports} onChange={(c: boolean) => updateLayer('privateAirports', c)} />
              <ToggleRow label="Other Fields" checked={layers.otherAirports} onChange={(c: boolean) => updateLayer('otherAirports', c)} />
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
                onCheckedChange={(c: boolean) => updateMasterGroup('showAirspaceMaster', c, ['controlledAirspace', 'suaMoa', 'trsa', 'classE', 'parachuteArea', 'modeC'])}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <ToggleRow label="Controlled (B/C/D)" checked={layers.controlledAirspace} onChange={(c: boolean) => updateLayer('controlledAirspace', c)} />
              <ToggleRow label="SUA / MOA" checked={layers.suaMoa} onChange={(c: boolean) => updateLayer('suaMoa', c)} />
              <ToggleRow label="TRSA" checked={layers.trsa} onChange={(c: boolean) => updateLayer('trsa', c)} />
              <ToggleRow label="Class E" checked={layers.classE} onChange={(c: boolean) => updateLayer('classE', c)} />
              <ToggleRow label="Parachute Area" checked={layers.parachuteArea} onChange={(c: boolean) => updateLayer('parachuteArea', c)} />
              <ToggleRow label="Mode C" checked={layers.modeC} onChange={(c: boolean) => updateLayer('modeC', c)} />
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
                onCheckedChange={(c: boolean) => updateMasterGroup('showAirwaysMaster', c, ['enrouteLow', 'enrouteHigh', 'airways', 'navaids', 'waypoints'])}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <ToggleRow label="Enroute High" checked={layers.enrouteHigh} onChange={(c: boolean) => updateLayer('enrouteHigh', c)} />
              <ToggleRow label="Enroute Low" checked={layers.enrouteLow} onChange={(c: boolean) => updateLayer('enrouteLow', c)} />
              <ToggleRow label="Airways" checked={layers.airways} onChange={(c: boolean) => updateLayer('airways', c)} />
              <ToggleRow label="Navaids" checked={layers.navaids} onChange={(c: boolean) => updateLayer('navaids', c)} />
              <ToggleRow label="Waypoints" checked={layers.waypoints} onChange={(c: boolean) => updateLayer('waypoints', c)} />
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
                onCheckedChange={(c: boolean) => updateMasterGroup('showArtccMaster', c, ['artccFirs', 'fisas', 'atcSectors'])}
              />
            </Flex>
            <Flex direction="column" gap="2">
              <ToggleRow label="ARTCC / FIRs" checked={layers.artccFirs} onChange={(c: boolean) => updateLayer('artccFirs', c)} />
              <ToggleRow label="FISAs" checked={layers.fisas} onChange={(c: boolean) => updateLayer('fisas', c)} />
              <ToggleRow label="ATC Sectors" checked={layers.atcSectors} onChange={(c: boolean) => updateLayer('atcSectors', c)} />
            </Flex>
          </Box>

        </Flex>
      )}
    </Flex>
  );
};

const ToggleRow = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (c: boolean) => void }) => (
  <Flex align="center" justify="between">
    <Text size="2" color="gray">{label}</Text>
    <Switch size="1" checked={checked} onCheckedChange={onChange} />
  </Flex>
);
