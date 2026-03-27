import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  EuiFlexGroup, EuiFlexItem, EuiPanel, EuiLoadingSpinner,
  EuiCallOut, EuiButtonEmpty, EuiSpacer, EuiText, EuiBadge,
} from '@elastic/eui';
import { useApi } from '../hooks/use_api';
import type { TopologyGraph } from '../../common';
import { DEVICE_TYPE_CONFIG } from '../../common';
import { TopologyCanvas } from '../components/topology_canvas';
import { DeviceFlyout } from '../components/device_flyout';

interface Props { site?: string; cidr?: string; onBackToOverview: () => void; from: string; to: string; refreshKey: number; }

export const TopologyView: React.FC<Props> = ({ site, cidr, onBackToOverview, from, to, refreshKey }) => {
  const api = useApi();
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Read the initial width immediately (ResizeObserver fires async)
    const initial = el.getBoundingClientRect().width;
    if (initial) setCanvasWidth(Math.floor(initial));
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setCanvasWidth(Math.floor(w));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [graph]); // re-runs once graph loads and the container div is in the DOM

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.fetchTopology({ site, cidr, from, to })
      .then((r) => { if (!cancelled) { setGraph(r.graph); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, site, cidr, from, to, refreshKey]);

  const handleNodeClick = useCallback((id: string) => {
    const node = graph?.nodes.find(n => n.id === id);
    if (node?.managed === false) return; // no flyout for ARP-discovered nodes
    setSelectedDevice(id);
  }, [graph]);
  const handleCloseFlyout = useCallback(() => setSelectedDevice(null), []);

  if (loading && !graph) return <EuiFlexGroup justifyContent="center" style={{ minHeight: 400 }}><EuiFlexItem grow={false}><EuiLoadingSpinner size="xl" /><EuiSpacer size="s" /><EuiText size="s" textAlign="center">Building topology from ARP/MAC tables...</EuiText></EuiFlexItem></EuiFlexGroup>;
  if (error) return <EuiCallOut title="Topology Error" color="danger"><p>{error}</p></EuiCallOut>;
  if (!graph) return null;

  return (
    <>
      <EuiFlexGroup alignItems="center" gutterSize="m">
        <EuiFlexItem grow={false}><EuiButtonEmpty iconType="arrowLeft" onClick={onBackToOverview}>All Sites</EuiButtonEmpty></EuiFlexItem>
        {site && <EuiFlexItem grow={false}><EuiBadge color="hollow">{site}</EuiBadge></EuiFlexItem>}
        {cidr && <EuiFlexItem grow={false}><EuiBadge color="hollow" style={{ fontFamily: 'monospace' }}>{cidr}</EuiBadge></EuiFlexItem>}
        <EuiFlexItem grow={false}>
          <EuiText size="s" color="subdued">
            {graph.nodes.filter(n => n.managed !== false).length} devices
            {graph.nodes.some(n => n.managed === false) && ` · ${graph.nodes.filter(n => n.managed === false).length} discovered`}
            {' · '}{graph.links.length} links
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem />
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="xs" alignItems="center">
            {([...Object.keys(DEVICE_TYPE_CONFIG), 'discovered']).map(type => {
              const hidden = hiddenTypes.has(type);
              const color = type === 'discovered' ? '#4A4B52' : DEVICE_TYPE_CONFIG[type]?.color;
              return (
                <EuiFlexItem grow={false} key={type}>
                  <EuiBadge
                    color={hidden ? 'default' : color}
                    onClick={() => toggleType(type)}
                    onClickAriaLabel={`Toggle ${type} node visibility`}
                    style={{ cursor: 'pointer', opacity: hidden ? 0.45 : 1, transition: 'opacity 0.15s', userSelect: 'none' }}
                  >
                    {type}
                  </EuiBadge>
                </EuiFlexItem>
              );
            })}
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      <div ref={containerRef}>
        <EuiPanel hasBorder hasShadow={false} paddingSize="none" style={{ overflow: 'hidden' }}>
          {canvasWidth > 0 && <TopologyCanvas graph={graph} width={canvasWidth} height={700} onNodeClick={handleNodeClick} selectedNodeId={selectedDevice} hiddenTypes={hiddenTypes} />}
        </EuiPanel>
      </div>
      {selectedDevice && <DeviceFlyout deviceId={selectedDevice} from={from} to={to} onClose={handleCloseFlyout} />}
    </>
  );
};
