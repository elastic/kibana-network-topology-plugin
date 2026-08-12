/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  Background,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  type NodeMouseHandler,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIconTip,
  EuiLoadingSpinner,
  EuiPanel,
  EuiScreenReaderLive,
  EuiScreenReaderOnly,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  useEuiTheme,
  useGeneratedHtmlId,
} from '@elastic/eui';
import { css } from '@emotion/react';
import type { TopologyGraph } from '../../common';
import { useApi } from '../hooks/use_api';
import type { TopologyEdgeData, TopologyNodeData } from '../utils/graph_to_react_flow';
import { graphToReactFlow } from '../utils/graph_to_react_flow';
import {
  recordDragOverrides,
  applyDragOverrides,
  type DragOverrides,
} from '../utils/drag_overrides';
import { TopologyReactFlowEdge } from '../components/topology_react_flow_edge';
import { usePrefersReducedMotion } from '../hooks/use_prefers_reduced_motion';
import { useKeyboardNavigation } from '../hooks/use_keyboard_navigation';
import { TopologyReactFlowNode } from '../components/topology_react_flow_node';
import { DeviceFlyout } from '../components/device_flyout';
import { DeviceTypeControls } from '../components/device_type_controls';
import { SiteControls } from '../components/site_controls';
import { TopologyMapControls } from '../components/topology_map_controls';

// Defined outside the component so the references are stable across renders —
// passing inline objects to nodeTypes/edgeTypes would cause React Flow to remount on every render.
const nodeTypes: NodeTypes = {
  device: TopologyReactFlowNode,
};

const edgeTypes: EdgeTypes = {
  topology: TopologyReactFlowEdge,
};

// Above this many *unhealthy* (animating) elements, auto-disable pulses to avoid
// compositor-layer pressure. Users can always override via the toolbar switch.
const UNHEALTHY_ANIMATION_LIMIT = 75;

// React Flow derives its size entirely from its container — `.react-flow` sets no
// dimensions of its own and every internal layer is absolutely positioned. Nothing
// in the surrounding EuiPage/EuiPageBody/EuiFlexGroup chain establishes a definite
// height, so a percentage here would resolve to `auto` and collapse the map to 0px.
const CANVAS_HEIGHT = 700;

// React Flow's own defaults (0.5 / 2) are far too narrow for this map: `fitView`
// clamps to minZoom, so a tall tiered graph could not be fitted into the viewport
// at all. A large site legitimately needs to zoom out well past 0.5.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

// Module-level so the reference stays stable across renders — an inline array would
// be a new prop value every render.
const SNAP_GRID: [number, number] = [1, 1];

interface Props {
  site?: string;
  cidr?: string;
  onBackToOverview: () => void;
  from: string;
  to: string;
  refreshKey: number;
}

const TopologyViewInner: React.FC<Props> = ({
  site,
  cidr,
  onBackToOverview,
  from,
  to,
  refreshKey,
}) => {
  const api = useApi();
  const { euiTheme, colorMode } = useEuiTheme();
  const { fitView } = useReactFlow();
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Stable primitive identity for the visible-type set, so effects can tell an
  // actual visibility change apart from a re-render with an equivalent Set.
  const hiddenTypesKey = useMemo(() => [...hiddenTypes].sort().join(','), [hiddenTypes]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopologyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<TopologyEdgeData>>([]);
  // True once every node has been measured — `fitView` needs real node dimensions
  // to compute correct bounds, and measurement happens asynchronously after render.
  const nodesInitialized = useNodesInitialized();

  const prefersReducedMotion = usePrefersReducedMotion();
  // null = follow auto (off under reduced-motion or many unhealthy elements). true/false = explicit choice.
  const [animationsUserPref, setAnimationsUserPref] = useState<boolean | null>(null);

  const unhealthyCount = useMemo(
    () =>
      nodes.filter((n) => n.data.status === 'down' || n.data.status === 'degraded').length +
      edges.filter((e) => !!e.data && e.data.status !== 'up').length,
    [nodes, edges]
  );
  const tooManyUnhealthy = unhealthyCount > UNHEALTHY_ANIMATION_LIMIT;
  const autoDisabled = prefersReducedMotion || tooManyUnhealthy;
  const animationsDisabled = animationsUserPref ?? autoDisabled;

  // Show a reason tip only while the user hasn't overridden the default.
  // Reduced-motion takes precedence over the performance message when both apply.
  const animationTip =
    animationsUserPref === null
      ? prefersReducedMotion
        ? "Animations are off to match your system's reduced-motion setting. Toggle to re-enable."
        : tooManyUnhealthy
        ? 'Animations were automatically disabled to preserve performance on large graphs with unhealthy elements. Toggle to re-enable.'
        : null
      : null;

  const containerRef = useRef<HTMLDivElement>(null);
  // Stores positions the operator has manually dragged — survive data refreshes
  const dragOverridesRef = useRef<DragOverrides>(new Map());

  // Single source of truth for selecting a device — used by both mouse click and
  // keyboard Enter/Space so the two paths can't drift. Unmanaged/discovered nodes
  // have no flyout, so they are ignored.
  const handleNodeSelect = useCallback((node: Node<TopologyNodeData>) => {
    if (node.data?.managed === false) return;
    setSelectedDeviceId(node.id);
  }, []);

  const handleNodeClick = useCallback<NodeMouseHandler<Node<TopologyNodeData>>>(
    (_event, node) => handleNodeSelect(node),
    [handleNodeSelect]
  );

  const handleCloseFlyout = useCallback(() => setSelectedDeviceId(null), []);

  const topologyDescriptionId = useGeneratedHtmlId({ prefix: 'topologyKeyboardHelp' });
  const { screenReaderAnnouncement } = useKeyboardNavigation({
    nodes,
    edges,
    selectedDeviceId,
    onNodeSelect: handleNodeSelect,
    onClose: handleCloseFlyout,
    containerRef,
  });

  // Wraps RF's onNodesChange to capture terminal drag positions into the ref
  // before delegating — keeps live-drag rendering intact via the passthrough.
  const handleNodesChange = useCallback<typeof onNodesChange>(
    (changes) => {
      recordDragOverrides(changes, dragOverridesRef.current);
      onNodesChange(changes);
    },
    [onNodesChange]
  );

  // Clears all drag overrides, re-runs the layout algorithm at the current canvas
  // size (so window resizes are reflected), and re-fits the viewport.
  const handleResetLayout = useCallback(() => {
    if (!graph) return;
    dragOverridesRef.current.clear();
    const { nodes: relaidOut } = graphToReactFlow(
      graph,
      containerRef.current?.clientWidth,
      containerRef.current?.clientHeight,
      hiddenTypes
    );
    // Re-apply the selection highlight: relaidOut nodes carry no `selected` flag
    // and the selection effect won't re-fire (selectedDeviceId is unchanged).
    setNodes(relaidOut.map((n) => (n.id === selectedDeviceId ? { ...n, selected: true } : n)));
    // Defer fitView until after the new positions commit to the DOM.
    window.requestAnimationFrame(() => {
      void fitView();
    });
  }, [graph, hiddenTypes, selectedDeviceId, setNodes, fitView]);

  // Keep RF's internal `selected` flag in sync with our state so the highlight always matches
  // the open flyout and survives RF's own selection attempts. The identity short-circuit
  // (`n.selected === expected ? n : {...n}`) avoids churning node refs when nothing changed,
  // which keeps the node component's `memo` effective.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const expected = n.id === selectedDeviceId;
        return n.selected === expected ? n : { ...n, selected: expected };
      })
    );
  }, [selectedDeviceId, setNodes]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .fetchTopology({ site, cidr, from, to })
      .then((r) => {
        if (!cancelled) {
          setGraph(r.graph);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, site, cidr, from, to, refreshKey]);

  useEffect(() => {
    if (graph) {
      const { nodes: reactFlowNodes, edges: reactFlowEdges } = graphToReactFlow(
        graph,
        containerRef.current?.clientWidth,
        containerRef.current?.clientHeight,
        hiddenTypes
      );
      setNodes(applyDragOverrides(reactFlowNodes, dragOverridesRef.current));
      setEdges(reactFlowEdges);
      // Preserve selection across data refreshes — keep the flyout open if the selected device
      // still exists as a managed node; clear it if it has disappeared from the new graph.
      setSelectedDeviceId((prev) =>
        prev && reactFlowNodes.some((n) => n.id === prev && n.data.managed !== false) ? prev : null
      );
    }
  }, [graph, hiddenTypes, setNodes, setEdges]);

  // Tracks which visible-type set the viewport was last fitted for.
  const fittedForRef = useRef<string | null>(null);

  // Fit the viewport on the first laid-out graph and whenever the visible type set
  // changes — but deliberately NOT on background data refreshes, which would yank
  // the viewport away from wherever the operator has panned and zoomed to.
  // Gated on `nodesInitialized` rather than a rAF guess: it only flips true once
  // every node has non-zero measured dimensions, which is exactly what `fitView`
  // needs to compute correct bounds. It re-flips when a refresh adds new nodes,
  // hence the `fittedForRef` check rather than relying on the flag alone.
  useEffect(() => {
    if (!nodesInitialized || fittedForRef.current === hiddenTypesKey) return;
    fittedForRef.current = hiddenTypesKey;
    void fitView();
  }, [nodesInitialized, hiddenTypesKey, fitView]);

  const topLeftToolbarStyles = css`
    display: flex;
    flex-direction: row;
    gap: ${euiTheme.size.s};
    align-items: flex-start;
    margin: ${euiTheme.size.s};
  `;

  // The panel frames the map the same way the legacy canvas was framed, and clips
  // the React Flow viewport to its rounded corners.
  const canvasPanelStyles = css`
    overflow: hidden;
  `;

  const canvasContainerStyles = css`
    width: 100%;
    height: ${CANVAS_HEIGHT}px;
  `;

  if (loading && !graph)
    return (
      <EuiFlexGroup justifyContent="center" style={{ minHeight: 400 }}>
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="xl" />
          <EuiSpacer size="s" />
          <EuiText size="s" textAlign="center">
            Building topology from ARP/MAC tables...
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
    );

  if (error)
    return (
      <EuiCallOut role="alert" title="Topology Error" color="danger">
        <p>{error}</p>
      </EuiCallOut>
    );

  if (!graph) return null;

  return (
    <>
      <EuiFlexGroup direction="column" gutterSize="s">
        <EuiFlexGroup alignItems="center" justifyContent="spaceBetween">
          <SiteControls graph={graph} onBackToOverview={onBackToOverview} site={site} cidr={cidr} />
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="m" alignItems="center" responsive={false}>
              <DeviceTypeControls hiddenTypes={hiddenTypes} toggleType={toggleType} />
              <EuiFlexItem grow={false}>
                <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
                  <EuiFlexItem grow={false}>
                    <EuiSwitch
                      compressed
                      label="Disable animations"
                      checked={animationsDisabled}
                      onChange={(e) => setAnimationsUserPref(e.target.checked)}
                    />
                  </EuiFlexItem>
                  {animationTip ? (
                    <EuiFlexItem grow={false}>
                      <EuiIconTip
                        type="question"
                        color="subdued"
                        content={animationTip}
                        aria-label="Why animations are disabled by default"
                      />
                    </EuiFlexItem>
                  ) : null}
                </EuiFlexGroup>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiPanel hasBorder hasShadow={false} paddingSize="none" css={canvasPanelStyles}>
          <div
            ref={containerRef}
            data-animations={animationsDisabled ? 'off' : 'on'}
            data-test-subj="topologyMap"
            role="group"
            tabIndex={0}
            aria-label={`Network topology with ${nodes.length} devices.`}
            aria-describedby={topologyDescriptionId}
            css={canvasContainerStyles}
          >
            <EuiScreenReaderOnly>
              <div id={topologyDescriptionId}>
                Use Tab to move between devices. Use Arrow keys to move to the nearest connected
                device in that direction. Press Enter or Space to open a device&apos;s details.
                Press Escape to close. Press plus or minus to zoom, and 0 to fit all devices in
                view.
              </div>
            </EuiScreenReaderOnly>
            <EuiScreenReaderLive>{screenReaderAnnouncement}</EuiScreenReaderLive>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode={colorMode.toLowerCase() as 'light' | 'dark'}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              nodesDraggable
              selectNodesOnDrag={false}
              connectionMode={ConnectionMode.Loose}
              nodesConnectable={false}
              // Even though nodes are technically focusable in this graph, we want to handle focus state ourselves
              // rather than relying on React Flow's internal focus management, as it is incompatible with some of our features
              // such as node tooltips.
              nodesFocusable={false}
              edgesFocusable={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              // Skip rendering elements outside the viewport. Topologies routinely run to
              // hundreds of devices, and unlike the canvas renderer every element here is
              // real DOM, so culling is what keeps large graphs interactive.
              onlyRenderVisibleElements
              // Snap to whole pixels — sub-pixel node positions blur the device labels.
              snapToGrid
              snapGrid={SNAP_GRID}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Panel position="top-left" css={topLeftToolbarStyles}>
                <TopologyMapControls onResetLayout={handleResetLayout} />
              </Panel>
            </ReactFlow>
          </div>
        </EuiPanel>
      </EuiFlexGroup>
      {selectedDeviceId && (
        <DeviceFlyout deviceId={selectedDeviceId} from={from} to={to} onClose={handleCloseFlyout} />
      )}
    </>
  );
};

export const TopologyView: React.FC<Props> = (props) => (
  <ReactFlowProvider>
    <TopologyViewInner {...props} />
  </ReactFlowProvider>
);
