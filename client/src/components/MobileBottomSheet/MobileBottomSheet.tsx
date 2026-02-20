import React from 'react';
import { Box, Card, Flex, Tabs, Text, Separator, Heading, IconButton } from '@radix-ui/themes';
import { X } from 'lucide-react';
import { grayColor } from '../../App.tsx';
import { FeatureList } from '../Map/FeatureList';
import { FlightPlanContent } from '../FlightPlanPanel/FlightPlanPanel';
import type { FlightPlan } from '../../types/FlightPlan';

interface MobileBottomSheetProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedFeatures: { lngLat: [number, number]; features: any[] } | null;
  onCloseFeatures: () => void;
  onFlightPlanChange: (plan: FlightPlan | null) => void;
}

export const MobileBottomSheet: React.FC<MobileBottomSheetProps> = ({
  selectedFeatures,
  onCloseFeatures,
  onFlightPlanChange
}) => {
  return (
    <Box className="map-feature-panel mobile-only">
      <Card
        size="2"
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'transparent',
          boxShadow: 'none',
          padding: 0
        }}
      >
        <Tabs.Root defaultValue="inspector">
          <Box pt="1" style={{ backgroundColor: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))'}}>
            <Tabs.List>
              <Tabs.Trigger value="inspector">Inspector</Tabs.Trigger>
              <Tabs.Trigger value="flightplan">Flight Plan</Tabs.Trigger>
            </Tabs.List>
          </Box>

          <Box px="4" py="4" style={{ height: 'calc(50vh - 50px)', overflowY: 'auto' }}>
            <Tabs.Content value="inspector">
              {selectedFeatures ? (
                <Flex direction="column" gap="4">
                  <Flex align="center" justify="between">
                    <Heading size="3">Map Features</Heading>
                    <IconButton
                      size="2"
                      variant="ghost"
                      onClick={onCloseFeatures}
                      title="Close Information"
                    >
                      <X size={18} />
                    </IconButton>
                  </Flex>

                  <Text size="1" color={grayColor}>
                    {selectedFeatures.lngLat[1].toFixed(5)}, {selectedFeatures.lngLat[0].toFixed(5)}
                  </Text>

                  <Separator size="4" />

                  <FeatureList features={selectedFeatures.features} />
                </Flex>
              ) : (
                <Flex align="center" justify="center" style={{ height: '100%' }}>
                  <Text color="gray" align="center">Tap on the map to inspect features.</Text>
                </Flex>
              )}
            </Tabs.Content>

            <Tabs.Content value="flightplan" style={{ height: '100%' }}>
              <FlightPlanContent onFlightPlanChange={onFlightPlanChange} style={{ height: 'auto' }} />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      </Card>
    </Box>
  );
};
