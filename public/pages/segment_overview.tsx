/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useState } from 'react';
import {
  EuiFlexGroup, EuiFlexItem, EuiPanel, EuiTitle, EuiText,
  EuiHealth, EuiLoadingSpinner, EuiCallOut, EuiSpacer, EuiIcon, EuiBadge,
} from '@elastic/eui';
import { useApi } from '../hooks/use_api';
import type { SegmentHealth } from '../../common';
import { STATUS_EUI_COLORS } from '../../common';

interface Props {
  onSegmentClick: (cidr: string) => void;
  from: string;
  to: string;
  refreshKey: number;
}

export const SegmentOverview: React.FC<Props> = ({ onSegmentClick, from, to, refreshKey }) => {
  const api = useApi();
  const [segments, setSegments] = useState<SegmentHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.fetchSegments({ from, to })
      .then((r) => { if (!cancelled) { setSegments(r.segments); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, from, to, refreshKey]);

  if (loading) return <EuiFlexGroup justifyContent="center" style={{ minHeight: 120 }}><EuiFlexItem grow={false}><EuiLoadingSpinner size="l" /></EuiFlexItem></EuiFlexGroup>;
  if (error) return <EuiCallOut title="Error loading segments" color="danger"><p>{error}</p></EuiCallOut>;
  if (segments.length === 0) return <EuiText size="s" color="subdued"><p>No network segments detected in the selected time range.</p></EuiText>;

  return (
    <EuiFlexGroup wrap gutterSize="l">
      {segments.map((seg) => (
        <EuiFlexItem key={seg.segment} style={{ minWidth: 260, maxWidth: 340 }}>
          <EuiPanel hasBorder hasShadow={false} paddingSize="l" onClick={() => onSegmentClick(seg.segment)} style={{ cursor: 'pointer' }}>
            <EuiFlexGroup alignItems="center" gutterSize="s">
              <EuiFlexItem grow={false}>
                <EuiIcon type="globe" size="l" color={STATUS_EUI_COLORS[seg.worstStatus] || 'subdued'} />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiTitle size="s"><h3 style={{ fontFamily: 'monospace' }}>{seg.segment}</h3></EuiTitle>
              </EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer size="m" />
            <EuiFlexGroup gutterSize="s" alignItems="center">
              <EuiFlexItem grow={false}>
                <EuiText size="s"><strong>{seg.deviceCount}</strong> polled</EuiText>
              </EuiFlexItem>
              {seg.discoveredCount > 0 && (
                <EuiFlexItem grow={false}>
                  <EuiBadge color="hollow">{seg.discoveredCount} discovered</EuiBadge>
                </EuiFlexItem>
              )}
            </EuiFlexGroup>
            <EuiSpacer size="s" />
            <EuiFlexGroup gutterSize="m">
              <EuiFlexItem grow={false}><EuiHealth color="success">{seg.upCount} up</EuiHealth></EuiFlexItem>
              {seg.degradedCount > 0 && <EuiFlexItem grow={false}><EuiHealth color="warning">{seg.degradedCount} degraded</EuiHealth></EuiFlexItem>}
              {seg.downCount > 0 && <EuiFlexItem grow={false}><EuiHealth color="danger">{seg.downCount} down</EuiHealth></EuiFlexItem>}
            </EuiFlexGroup>
          </EuiPanel>
        </EuiFlexItem>
      ))}
    </EuiFlexGroup>
  );
};
