import React, { useState, useEffect } from 'react';
import { Box, Card, Flex, TextArea, Button, Heading, Text, IconButton, ScrollArea, Table, Badge } from '@radix-ui/themes';
import { Plane, X } from 'lucide-react';
import type { SearchIndex, FlightPlan } from '../../types/FlightPlan';
import { parseRoute } from '../../utils/routeParser';
import { grayColor } from '../../App.tsx';

interface FlightPlanPanelProps {
  onFlightPlanChange: (plan: FlightPlan | null) => void;
}

export const FlightPlanPanel: React.FC<FlightPlanPanelProps> = ({ onFlightPlanChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [routeString, setRouteString] = useState('');
    const [index, setIndex] = useState<SearchIndex | null>(null);
    const [loading, setLoading] = useState(false);
    const [activePlan, setActivePlan] = useState<FlightPlan | null>(null);

    useEffect(() => {
      // Lazy load index when opened first time
      if (isOpen && !index && !loading) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        fetch('search_index.json')
          .then(res => res.json())
          .then(data => {
            setIndex(data);
            setLoading(false);
          })
          .catch(err => {
            console.error("Failed to load search index", err);
            setLoading(false);
          });
      }
    }, [isOpen, index, loading]);

    const handlePlot = () => {
      if (!index) return;
      const plan = parseRoute(routeString, index);
      setActivePlan(plan);
      onFlightPlanChange(plan);
    };

    const handleClear = () => {
      setRouteString('');
      setActivePlan(null);
      onFlightPlanChange(null);
    }

      if (!isOpen) {
        return (
          <Box position="absolute" top="4" left="4" style={{ zIndex: 10 }}>
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
        <Box position="absolute" top="4" left="4" style={{ zIndex: 10, maxWidth: '90vw' }}>
          <Card size="2" style={{ width: 350, maxHeight: '80vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', boxShadow: '0 0 0 1px var(--glass-border)' }}>
            <Flex direction="column" gap="3" style={{ height: '100%' }}>
              <Flex justify="between" align="center">
                <Heading size="3">Flight Plan</Heading>
                <IconButton variant="ghost" onClick={() => setIsOpen(false)}>
                  <X size={18} />
                </IconButton>
              </Flex>

              <TextArea
                placeholder="KSJC TECKY4.VLREE EBAYE KLAX"
                value={routeString}
                onChange={e => setRouteString(e.target.value)}
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
                <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 200, marginTop: 8 }}>
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
              )}
            {index && !activePlan && (
              <Text size="1" color="gray">
                Database loaded ({Object.keys(index.fixes).length} points)
              </Text>
            )}
          </Flex>
        </Card>
      </Box>
    );
  };
