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
  Background,
  Controls,
  ControlButton,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiIconTip,
  EuiLoadingSpinner,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  useEuiTheme,
} from '@elastic/eui';
import type { TopologyGraph } from '../../common';
import { useApi } from '../hooks/use_api';
import type { TopologyEdgeData, TopologyNodeData } from '../utils/graph_to_react_flow';
import { graphToReactFlow } from '../utils/graph_to_react_flow';
import {
  recordDragOverrides,
  applyDragOverrides,
  type DragOverrides,
} from '../utils/drag_overrides';
import { TopologyReactFlowEdge } from './topology_react_flow_edge';
import { usePrefersReducedMotion } from '../hooks/use_prefers_reduced_motion';
import { TopologyReactFlowNode } from './topology_react_flow_node';
import { DeviceFlyout } from './device_flyout';
import { DeviceTypeControls } from './device_type_controls';
import { SiteControls } from './site_controls';

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

interface Props {
  site?: string;
  cidr?: string;
  onBackToOverview: () => void;
  from: string;
  to: string;
  refreshKey: number;
}

const TopologyCanvasReactFlowInner: React.FC<Props> = ({
  site,
  cidr,
  onBackToOverview,
  from,
  to,
  refreshKey,
}) => {
  const api = useApi();
  const { colorMode } = useEuiTheme();
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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopologyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<TopologyEdgeData>>([]);

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
        ? 'Animations were automatically disabled for performance because many elements are unhealthy. Toggle to re-enable.'
        : null
      : null;

  const containerRef = useRef<HTMLDivElement>(null);
  // Stores positions the operator has manually dragged — survive data refreshes
  const dragOverridesRef = useRef<DragOverrides>(new Map());

  const handleNodeClick = useCallback<NodeMouseHandler<Node<TopologyNodeData>>>((_event, node) => {
    if (node.data?.managed === false) return;
    setSelectedDeviceId(node.id);
  }, []);

  const handleCloseFlyout = useCallback(() => setSelectedDeviceId(null), []);

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

  useEffect(() => {
    window.requestAnimationFrame(() => {
      void fitView();
    });
  }, [hiddenTypes, fitView]);

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
      <EuiCallOut announceOnMount title="Topology Error" color="danger">
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
                        type="questionInCircle"
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
        <div
          ref={containerRef}
          data-animations={animationsDisabled ? 'off' : 'on'}
          style={{
            height: '100%',
            width: '100%',
          }}
        >
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
            nodesConnectable={false}
            nodesFocusable
            edgesFocusable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false}>
              <ControlButton
                onClick={handleResetLayout}
                title="Reset Layout"
                aria-label="Reset Layout"
              >
                <EuiIcon type="refresh" aria-hidden={true} />
              </ControlButton>
            </Controls>
          </ReactFlow>
        </div>
      </EuiFlexGroup>
      {selectedDeviceId && (
        <DeviceFlyout deviceId={selectedDeviceId} from={from} to={to} onClose={handleCloseFlyout} />
      )}
    </>
  );
};

export const TopologyCanvasReactFlow: React.FC<Props> = (props) => (
  <ReactFlowProvider>
    <TopologyCanvasReactFlowInner {...props} />
  </ReactFlowProvider>
);
