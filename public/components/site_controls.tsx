/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import { EuiBadge, EuiButtonEmpty, EuiFlexGroup, EuiFlexItem, EuiText } from '@elastic/eui';
import type { TopologyGraph } from '../../common';

interface Props {
  graph: TopologyGraph;
  onBackToOverview: () => void;
  site?: string;
  cidr?: string;
}

export const SiteControls: React.FC<Props> = ({ graph, site, cidr, onBackToOverview }) => {
  const managedCount = useMemo(
    () => graph.nodes.filter((n) => n.managed !== false).length,
    [graph]
  );
  const discoveredCount = useMemo(
    () => graph.nodes.filter((n) => n.managed === false).length,
    [graph]
  );

  return (
    <EuiFlexGroup alignItems="center">
      <EuiFlexItem grow={false}>
        <EuiButtonEmpty iconType="arrowLeft" onClick={onBackToOverview}>
          All Sites
        </EuiButtonEmpty>
      </EuiFlexItem>
      {site && (
        <EuiFlexItem grow={false}>
          <EuiBadge color="hollow">{site}</EuiBadge>
        </EuiFlexItem>
      )}
      {cidr && (
        <EuiFlexItem grow={false}>
          <EuiBadge color="hollow" style={{ fontFamily: 'monospace' }}>
            {cidr}
          </EuiBadge>
        </EuiFlexItem>
      )}
      <EuiFlexItem grow={false}>
        <EuiText size="s" color="subdued">
          {managedCount} devices
          {discoveredCount > 0 && ` · ${discoveredCount} discovered`}
          {' · '}
          {graph.links.length} links
        </EuiText>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
