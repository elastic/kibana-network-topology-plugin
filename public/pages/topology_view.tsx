import React, { useEffect, useState, useCallback } from 'react';
import {
  EuiFlexGroup, EuiFlexItem, EuiPanel, EuiLoadingSpinner,
  EuiCallOut, EuiButtonEmpty, EuiSpacer, EuiText, EuiBadge,
} from '@elastic/eui';
import { useApi } from '../hooks/use_api';
import type { TopologyGraph } from '../../common';
import { DEVICE_TYPE_CONFIG } from '../../common';
import { TopologyCanvas } from '../components/topology_canvas';
import { DeviceFlyout } from '../components/device_flyout';

interface Props { site?: string; onBackToOverview: () => void; }

export const TopologyView: React.FC<Props> = ({ site, onBackToOverview }) => {
  const api = useApi();
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.fetchTopology({ site })
      .then((r) => { if (!cancelled) { setGraph(r.graph); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, site]);

  const handleNodeClick = useCallback((id: string) => setSelectedDevice(id), []);
  const handleCloseFlyout = useCallback(() => setSelectedDevice(null), []);

  if (loading) return <EuiFlexGroup justifyContent="center" style={{ minHeight: 400 }}><EuiFlexItem grow={false}><EuiLoadingSpinner size="xl" /><EuiSpacer size="s" /><EuiText size="s" textAlign="center">Building topology from ARP/MAC tables...</EuiText></EuiFlexItem></EuiFlexGroup>;
  if (error) return <EuiCallOut title="Topology Error" color="danger"><p>{error}</p></EuiCallOut>;
  if (!graph) return null;

  return (
    <>
      <EuiFlexGroup alignItems="center" gutterSize="m">
        <EuiFlexItem grow={false}><EuiButtonEmpty iconType="arrowLeft" onClick={onBackToOverview}>All Sites</EuiButtonEmpty></EuiFlexItem>
        {site && <EuiFlexItem grow={false}><EuiBadge color="hollow">{site}</EuiBadge></EuiFlexItem>}
        <EuiFlexItem grow={false}><EuiText size="s" color="subdued">{graph.nodes.length} devices &middot; {graph.links.length} links</EuiText></EuiFlexItem>
        <EuiFlexItem />
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" alignItems="center">
            {Object.entries(DEVICE_TYPE_CONFIG).filter(([k]) => k !== 'unknown').map(([k, c]) => (
              <EuiFlexItem grow={false} key={k}><EuiBadge color={c.color}>{k}</EuiBadge></EuiFlexItem>
            ))}
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      <EuiPanel hasBorder hasShadow={false} paddingSize="none" style={{ overflow: 'hidden' }}>
        <TopologyCanvas graph={graph} width={1200} height={700} onNodeClick={handleNodeClick} selectedNodeId={selectedDevice} />
      </EuiPanel>
      {selectedDevice && <DeviceFlyout deviceId={selectedDevice} onClose={handleCloseFlyout} />}
    </>
  );
};
