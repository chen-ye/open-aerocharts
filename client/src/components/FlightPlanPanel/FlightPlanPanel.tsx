import React, { useState, useEffect, useCallback } from 'react';
import { Box, Card, Flex, TextArea, Button, Heading, Text, IconButton, ScrollArea, Table, Badge } from '@radix-ui/themes';
import { Plane, X } from 'lucide-react';
import type { SearchIndex, FlightPlan } from '../../types/FlightPlan';
import { parseRoute } from '../../utils/routeParser';
import { grayColor } from '../../App.tsx';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/Accordion';

interface FlightPlanContentProps {
  onFlightPlanChange: (plan: FlightPlan | null) => void;
  routeString: string;
  onRouteStringChange: (route: string) => void;
  index: SearchIndex | null;
  loading: boolean;
  style?: React.CSSProperties;
}

export const FlightPlanContent: React.FC<FlightPlanContentProps> = ({
  onFlightPlanChange,
  routeString,
  onRouteStringChange,
  index,
  loading,
  style
}) => {
  const [activePlan, setActivePlan] = useState<FlightPlan | null>(null);
  const initialPlotDone = React.useRef(false);

  // No longer needed as we fetch in App.tsx

  const handlePlot = useCallback(() => {
    if (!index) return;
    const plan = parseRoute(routeString, index);
    setActivePlan(plan);
    onFlightPlanChange(plan);
  }, [index, routeString, onFlightPlanChange]);

  useEffect(() => {
    if (index && routeString && !initialPlotDone.current) {
      initialPlotDone.current = true;
      // Use microtask to avoid synchronous setState warning
      queueMicrotask(() => {
        handlePlot();
      });
    }
  }, [index, routeString, handlePlot]);

  const handleClear = () => {
    onRouteStringChange('');
    setActivePlan(null);
    onFlightPlanChange(null);
  }

  return (
    <Flex direction="column" gap="3" style={{ height: '100%', ...style }}>
      <TextArea
        placeholder="KSJC TECKY4.VLREE EBAYE KLAX"
        value={routeString}
        onChange={e => onRouteStringChange(e.target.value)}
        rows={3}
        style={{ fontFamily: 'monospace' }}
      />

      <Flex gap="3">
        <Button onClick={handlePlot} disabled={loading || !index} style={{ flex: 1 }}>
          {loading ? 'Loading Data...' : 'Plot Route'}
        </Button>
        <Button onClick={handleClear} variant="soft" color="gray">
          Clear
        </Button>
      </Flex>

      {activePlan && (
        <Accordion type="single" collapsible defaultValue="waypoints">
          <AccordionItem value="waypoints">
            <AccordionTrigger>
              Fixes ({activePlan.points.length})
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 200 }}>
                <Table.Root style={{ backgroundColor: 'transparent' }}>
                  <Table.Body>
                    {activePlan.points.map((pt, i) => (
                      <Table.Row key={i}>
                        <Table.Cell py="2">
                          <Flex direction="column">
                            <Text weight="bold" size="2">{pt.id}</Text>
                            {pt.name && <Text size="1" color="gray">{pt.name}</Text>}
                          </Flex>
                        </Table.Cell>
                        <Table.Cell py="2" align="right">
                          <Badge color={pt.type === 'airport' ? 'blue' : pt.type === 'navaid' ? 'plum' : 'gray'}>
                            {pt.type}
                          </Badge>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {index && !activePlan && (
        <Text size="1" color="gray">
          Database loaded ({Object.keys(index.fixes).length} points)
        </Text>
      )}
    </Flex>
  );
};

interface FlightPlanPanelProps {
  onFlightPlanChange: (plan: FlightPlan | null) => void;
  routeString: string;
  onRouteStringChange: (route: string) => void;
  index: SearchIndex | null;
  loading: boolean;
}

export const FlightPlanPanel: React.FC<FlightPlanPanelProps> = ({
  onFlightPlanChange,
  routeString,
  onRouteStringChange,
  index,
  loading
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <Box className="desktop-only" position="absolute" top="4" left="4" style={{ zIndex: 10 }}>
        <IconButton
          size="3"
          variant="surface"
          color={grayColor}
          onClick={() => setIsOpen(true)}
          title="Flight Plan"
          style={{
            backgroundColor: 'var(--glass-bg)',
            backdropFilter: 'blur(var(--glass-blur))',
            boxShadow: '0 0 0 1px var(--glass-border)'
          }}
        >
          <Plane size={20} />
        </IconButton>
      </Box>
    );
  }

  return (
    <Box className="desktop-only" position="absolute" top="4" left="4" style={{ zIndex: 10, maxWidth: '90vw' }}>
      <Card size="2" style={{ width: 350, maxHeight: '80vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', boxShadow: '0 0 0 1px var(--glass-border)' }}>
        <Flex justify="between" align="center" mb="3">
          <Heading size="3">Flight Plan</Heading>
          <IconButton variant="ghost" onClick={() => setIsOpen(false)}>
            <X size={18} />
          </IconButton>
        </Flex>
        <FlightPlanContent
          onFlightPlanChange={onFlightPlanChange}
          routeString={routeString}
          onRouteStringChange={onRouteStringChange}
          index={index}
          loading={loading}
        />
      </Card>
    </Box>
  );
};
