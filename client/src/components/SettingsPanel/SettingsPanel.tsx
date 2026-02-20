import React, { useState } from 'react';
import { Layers, X } from 'lucide-react';
import { Card, Flex, Heading, IconButton, Select, Switch, Text, Box, Slider } from '@radix-ui/themes';

interface SettingsPanelProps {
  basemap: string;
  setBasemap: (url: string) => void;
  showTerrain: boolean;
  setShowTerrain: (show: boolean) => void;
  showAeronautical: boolean;
  setShowAeronautical: (show: boolean) => void;
  basemapBrightness: number;
  setBasemapBrightness: (val: number) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  basemap,
  setBasemap,
  showTerrain,
  setShowTerrain,
  showAeronautical,
  setShowAeronautical,
  basemapBrightness,
  setBasemapBrightness
}) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Box
      position="absolute"
      top="4"
      right="4"
      style={{ zIndex: 10, width: isOpen ? 'max-content' : 'auto' }}
    >
      {!isOpen ? (
        <IconButton
          size="3"
          variant="soft"
          onClick={() => setIsOpen(true)}
          title="Open Settings"
        >
          <Layers size={20} />
        </IconButton>
      ) : (
        <Card size="2" style={{ width: 320, backgroundColor: 'var(--glass-bg)', backdropFilter: 'blur(12px)' }}>
          <Flex direction="column" gap="4">
            <Flex align="center" justify="between">
              <Heading size="3" as="h2">Map Settings</Heading>
              <IconButton
                size="2"
                variant="ghost"
                onClick={() => setIsOpen(false)}
                title="Close Settings"
              >
                <X size={18} />
              </IconButton>
            </Flex>

            <Flex direction="column" gap="2">
              <Text size="2" weight="medium" color="gray">Basemap Style</Text>
              <Select.Root value={basemap} onValueChange={setBasemap}>
                <Select.Trigger />
                <Select.Content>
                  <Select.Group>
                    <Select.Label>Vector Basemaps</Select.Label>
                    <Select.Item value="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json">CartoCDN Voyager</Select.Item>
                    <Select.Item value="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json">CartoCDN Positron (Light)</Select.Item>
                    <Select.Item value="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json">CartoCDN Dark Matter</Select.Item>
                  </Select.Group>
                  <Select.Separator />
                  <Select.Group>
                    <Select.Label>FAA Raster Maps</Select.Label>
                    <Select.Item value="faa-sectional">VFR Sectional</Select.Item>
                    <Select.Item value="faa-enroute">IFR High Enroute</Select.Item>
                    <Select.Item value="faa-ifrlo">IFR Low Enroute</Select.Item>
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex direction="column" gap="2">
              <Text as="label" size="2" weight="medium" color="gray">Basemap Brightness</Text>
              <Slider
                value={[basemapBrightness]}
                onValueChange={(val: number[]) => setBasemapBrightness(val[0])}
                max={100}
                step={1}
              />
            </Flex>

            <Flex align="center" gap="2">
              <Switch
                id="terrain-toggle"
                checked={showTerrain}
                onCheckedChange={setShowTerrain}
              />
              <Text as="label" htmlFor="terrain-toggle" size="2" style={{ cursor: 'pointer' }}>
                Show 3D Terrain
              </Text>
            </Flex>

            <Flex align="center" gap="2">
              <Switch
                id="aero-toggle"
                checked={showAeronautical}
                onCheckedChange={setShowAeronautical}
              />
              <Text as="label" htmlFor="aero-toggle" size="2" style={{ cursor: 'pointer' }}>
                Show CIFP Data
              </Text>
            </Flex>
          </Flex>
        </Card>
      )}
    </Box>
  );
};
