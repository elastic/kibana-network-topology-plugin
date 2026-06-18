/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Edge, Node } from '@xyflow/react';
import type { TopologyGraph, TopologyLink, TopologyNode } from '../../common';

export interface TopologyNodeData extends Record<string, unknown> {
  label: string;
  ip: string;
  type: TopologyNode['type'];
  status: TopologyNode['status'];
  site?: string;
  role?: TopologyNode['role'];
  managed?: boolean;
  /** Discovery method — only set when managed === false. BGP > OSPF > ARP precedence. */
  discovery?: 'bgp' | 'ospf' | 'arp';
}

export interface TopologyEdgeData extends Record<string, unknown> {
  status: TopologyLink['status'];
  method: TopologyLink['method'];
  sourcePort?: string;
  targetPort?: string;
  trafficVolume?: number;
}

// Minimum spacing between node centres in the virtual coordinate space.
const MIN_H_SPACING = 100;
const MIN_V_SPACING = 120;
const MAX_ROW_WIDTH = 12;

// Layout order: BGP external peers (top) → managed tiers (middle) → ARP-discovered (bottom)
const TYPE_TIERS = ['router', 'firewall', 'switch', 'server', 'ap', 'unknown'] as const;

const computeLayout = (
  nodes: TopologyNode[],
  links: TopologyLink[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> => {
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const l of links) {
    const src = l.source as string;
    const tgt = l.target as string;
    degree.set(src, (degree.get(src) ?? 0) + 1);
    degree.set(tgt, (degree.get(tgt) ?? 0) + 1);
  }

  const bgpNodeIds = new Set<string>();
  for (const l of links) {
    if (l.method === 'bgp') {
      bgpNodeIds.add(l.source as string);
      bgpNodeIds.add(l.target as string);
    }
  }
  const unmanagedBgp = nodes.filter((n) => n.managed === false && bgpNodeIds.has(n.id));
  const unmanagedArp = nodes.filter((n) => n.managed === false && !bgpNodeIds.has(n.id));
  const managed = nodes.filter((n) => n.managed !== false);

  const byType = new Map<string, TopologyNode[]>(TYPE_TIERS.map((t) => [t, []]));
  for (const n of managed) {
    const bucket = byType.has(n.type) ? n.type : 'unknown';
    byType.get(bucket)!.push(n);
  }

  const sortByDegree = (a: TopologyNode, b: TopologyNode) => {
    const d = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    return d !== 0 ? d : a.label.localeCompare(b.label);
  };
  for (const group of byType.values()) group.sort(sortByDegree);
  unmanagedBgp.sort(sortByDegree);
  unmanagedArp.sort((a, b) => a.label.localeCompare(b.label));

  const rows: TopologyNode[][] = [];
  for (let i = 0; i < unmanagedBgp.length; i += MAX_ROW_WIDTH)
    rows.push(unmanagedBgp.slice(i, i + MAX_ROW_WIDTH));
  for (const t of TYPE_TIERS) {
    const group = byType.get(t)!;
    if (group.length === 0) continue;
    for (let i = 0; i < group.length; i += MAX_ROW_WIDTH)
      rows.push(group.slice(i, i + MAX_ROW_WIDTH));
  }
  for (let i = 0; i < unmanagedArp.length; i += MAX_ROW_WIDTH)
    rows.push(unmanagedArp.slice(i, i + MAX_ROW_WIDTH));

  if (rows.length === 0) return new Map();

  const maxPerRow = Math.max(...rows.map((r) => r.length));
  const vW = Math.max(width, maxPerRow * MIN_H_SPACING + 80);
  const vH = Math.max(height, rows.length * MIN_V_SPACING + 80);

  const padX = 60;
  const padY = 60;
  const usableW = vW - 2 * padX;
  const usableH = vH - 2 * padY;
  const rowCount = rows.length;

  const positions = new Map<string, { x: number; y: number }>();
  rows.forEach((row, ri) => {
    const y = padY + (rowCount <= 1 ? usableH / 2 : (ri / (rowCount - 1)) * usableH);
    row.forEach((node, i) => {
      const x = row.length === 1 ? vW / 2 : padX + (i / (row.length - 1)) * usableW;
      positions.set(node.id, { x, y });
    });
  });
  return positions;
};

// Default canvas size used when no explicit dimensions are provided.
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

export const graphToReactFlow = (
  graph: TopologyGraph,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT
): { nodes: Array<Node<TopologyNodeData>>; edges: Array<Edge<TopologyEdgeData>> } => {
  const { nodes: topoNodes, links: topoLinks } = graph;

  // Derive per-node discovery method from links (BGP > OSPF > ARP precedence).
  // Computed once here so the node component doesn't need access to the edge list.
  const bgpNodeIds = new Set<string>();
  const ospfNodeIds = new Set<string>();
  for (const l of topoLinks) {
    if (l.method === 'bgp') {
      bgpNodeIds.add(l.source);
      bgpNodeIds.add(l.target);
    } else if (l.method === 'ospf') {
      ospfNodeIds.add(l.source);
      ospfNodeIds.add(l.target);
    }
  }

  const positions = computeLayout(topoNodes, topoLinks, width, height);

  const nodes: Array<Node<TopologyNodeData>> = topoNodes.map((n) => ({
    id: n.id,
    type: 'device' as const,
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    data: {
      label: n.label,
      ip: n.ip,
      type: n.type,
      status: n.status,
      site: n.site,
      role: n.role,
      managed: n.managed,
      discovery:
        n.managed === false
          ? bgpNodeIds.has(n.id)
            ? 'bgp'
            : ospfNodeIds.has(n.id)
            ? 'ospf'
            : 'arp'
          : undefined,
    },
  }));

  const edges: Array<Edge<TopologyEdgeData, 'topology'>> = topoLinks.map((l) => ({
    id: l.id,
    type: 'topology' as const,
    source: l.source,
    target: l.target,
    data: {
      status: l.status,
      method: l.method,
      sourcePort: l.sourcePort,
      targetPort: l.targetPort,
      trafficVolume: l.trafficVolume,
    },
    selectable: false,
  }));

  return { nodes, edges };
};
