/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';
import { useEuiTheme } from '@elastic/eui';
import type { TopologyEdgeData } from '../utils/graph_to_react_flow';

type TopologyEdge = Edge<TopologyEdgeData, 'topology'>;

type Status = TopologyEdgeData['status'];
type Method = TopologyEdgeData['method'];

// Healthy BGP/OSPF have no EUI semantic token equivalent.
const BGP_COLOR = '#0077CC';
const OSPF_COLOR = '#54B399';

const resolveStroke = (
  status: Status,
  method: Method,
  colors: { danger: string; warning: string; success: string }
): string => {
  if (status === 'down') return colors.danger;
  if (status === 'degraded') return colors.warning;
  // status === 'up': use protocol identity color, fall back to semantic success
  if (method === 'bgp') return BGP_COLOR;
  if (method === 'ospf') return OSPF_COLOR;
  return colors.success;
};

const resolveDash = (status: Status, method: Method): string | undefined => {
  // Down overrides protocol identity
  if (status === 'down') return '4 4';
  if (method === 'bgp') return '8 3 2 3';
  if (method === 'ospf') return '10 4';
  return undefined; // solid
};

const resolveWidth = (status: Status, method: Method): number => {
  const isProtocol = method === 'bgp' || method === 'ospf';
  return status === 'up' ? (isProtocol ? 3 : 2.5) : isProtocol ? 4 : 2.75;
};

const resolveOpacity = (status: Status, method: Method): number => {
  const isProtocol = method === 'bgp' || method === 'ospf';
  return status === 'up' ? (isProtocol ? 0.7 : 0.6) : isProtocol ? 0.65 : 0.5;
};

export const TopologyReactFlowEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  }: EdgeProps<TopologyEdge>) => {
    const { euiTheme } = useEuiTheme();

    // data is always populated by graphToReactFlow; defaults guard against incomplete shapes.
    const status: Status = data?.status ?? 'up';
    const method: Method = data?.method ?? 'lldp';

    const [edgePath] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    return (
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: resolveStroke(status, method, euiTheme.colors),
          strokeDasharray: resolveDash(status, method),
          strokeWidth: resolveWidth(status, method),
          opacity: resolveOpacity(status, method),
        }}
      />
    );
  }
);

TopologyReactFlowEdge.displayName = 'TopologyReactFlowEdge';
