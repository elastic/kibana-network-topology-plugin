/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingSpinner,
  EuiSpacer,
  EuiText,
  useEuiTheme,
} from '@elastic/eui';
import type { TopologyGraph } from '../../common';
import { useApi } from '../hooks/use_api';
import type { TopologyEdgeData, TopologyNodeData } from '../utils/graph_to_react_flow';
import { graphToReactFlow } from '../utils/graph_to_react_flow';
import { TopologyReactFlowNode } from './topology_react_flow_node';
import { DeviceFlyout } from './device_flyout';

// Defined outside the component so the reference is stable across renders —
// passing an inline object to nodeTypes would cause React Flow to remount nodes every render.
const nodeTypes: NodeTypes = {
  device: TopologyReactFlowNode,
};

interface Props {
  site?: string;
  cidr?: string;
  onBackToOverview: () => void;
  from: string;
  to: string;
  refreshKey: number;
}

export const TopologyCanvasReactFlow: React.FC<Props> = ({
  site,
  cidr,
  onBackToOverview: _onBackToOverview,
  from,
  to,
  refreshKey,
}) => {
  const api = useApi();
  const { colorMode } = useEuiTheme();
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopologyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<TopologyEdgeData>>([]);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleNodeClick = useCallback<NodeMouseHandler<Node<TopologyNodeData>>>((_event, node) => {
    if (node.data?.managed === false) return;
    setSelectedDeviceId(node.id);
  }, []);

  const handleCloseFlyout = useCallback(() => setSelectedDeviceId(null), []);

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
        containerRef.current?.clientHeight
      );
      setNodes(reactFlowNodes);
      setEdges(reactFlowEdges);
      // Preserve selection across data refreshes — keep the flyout open if the selected device
      // still exists as a managed node; clear it if it has disappeared from the new graph.
      setSelectedDeviceId((prev) =>
        prev && reactFlowNodes.some((n) => n.id === prev && n.data.managed !== false) ? prev : null
      );
    }
  }, [graph, setNodes, setEdges]);

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
      <div
        ref={containerRef}
        style={{
          height: '100%',
          width: '100%',
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode={colorMode.toLowerCase() as 'light' | 'dark'}
          fitView
          onNodesChange={onNodesChange}
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
          <Controls />
        </ReactFlow>
      </div>
      {selectedDeviceId && (
        <DeviceFlyout deviceId={selectedDeviceId} from={from} to={to} onClose={handleCloseFlyout} />
      )}
    </>
  );
};
