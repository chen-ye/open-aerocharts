import React, { useState, useEffect } from 'react';
import { Box, Card, Flex, TextArea, Button, Heading, Text, IconButton } from '@radix-ui/themes';
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
    onFlightPlanChange(plan);
  };

  const handleClear = () => {
    setRouteString('');
    onFlightPlanChange(null);
  }

  if (!isOpen) {
    return (
      <Box position="absolute" bottom="4" left="4" style={{ zIndex: 10 }}>
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
    <Box position="absolute" bottom="4" left="4" style={{ zIndex: 10, maxWidth: '90vw' }}>
      <Card size="2" style={{ width: 350, backgroundColor: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', boxShadow: '0 0 0 1px var(--glass-border)' }}>
        <Flex direction="column" gap="3">
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

          {index && (
            <Text size="1" color="gray">
              Database loaded ({Object.keys(index.fixes).length} points)
            </Text>
          )}
        </Flex>
      </Card>
    </Box>
  );
};
