/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
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

// Defined outside the component so the reference is stable across renders —
// passing an inline object to nodeTypes would cause React Flow to remount nodes every render.
const nodeTypes: NodeTypes = {
  device: TopologyReactFlowNode,
};

export const TopologyCanvasReactFlow: React.FC<any> = ({
  site,
  cidr,
  onBackToOverview,
  from,
  to,
  refreshKey,
}) => {
  const api = useApi();
  const { colorMode } = useEuiTheme();
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopologyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<TopologyEdgeData>>([]);

  const containerRef = useRef<HTMLDivElement>(null);

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
        nodesDraggable
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};
