import React from 'react';
import { Box, Text, Flex, Separator } from '@radix-ui/themes';
import { grayColor } from '../../App.tsx';

interface FeatureListProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: any[];
  limit?: number;
  separatorMargin?: string;
  titleBottomMargin?: string;
}

export const FeatureList: React.FC<FeatureListProps> = ({
  features,
  limit,
  separatorMargin,
  titleBottomMargin = '2'
}) => {
  const displayFeatures = limit ? features.slice(0, limit) : features;
  return (
    <>
      {displayFeatures.map((f, i) => (
        <React.Fragment key={i}>
          <Box>
            <Text
              as="div"
              weight="bold"
              size="1"
              color={grayColor}
              mb={titleBottomMargin}
              style={{ textTransform: 'uppercase' }}
            >
              {f.sourceLayer || f.layer?.id}
            </Text>
            {Object.entries(f.properties || {}).map(([key, value]) => {
              if (key === 'source_id' || key === 'geometry') return null;
              return (
                <Flex key={key} justify="between" gap="3" style={{ lineHeight: '1.2', paddingBottom: '2px' }}>
                  <Text size="1" color={grayColor}>{key}:</Text>
                  <Text size="1" weight="medium" style={{ textAlign: 'right', wordBreak: 'break-word' }}>
                    {String(value)}
                  </Text>
                </Flex>
              );
            })}
          </Box>
          {i < displayFeatures.length - 1 && <Separator size="4" my={separatorMargin} />}
        </React.Fragment>
      ))}
    </>
  );
};
