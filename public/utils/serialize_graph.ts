/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConnectionsGraph, TopologyGraph } from '../../common';

/**
 * Produces a human-readable JSON-serializable snapshot of the displayed
 * connections graph. The `{group}::` prefix is stripped from node IDs and
 * expanded into a separate `sourceGroup` field on links so the output is clean
 * for pasting into an AI assistant or a ticket.
 */
export function serializeConnectionsGraph(
  graph: ConnectionsGraph,
  meta: {
    srcField: string;
    dstField: string;
    groupField?: string;
    index?: string;
    from: string;
    to: string;
    kql?: string;
  }
): object {
  return {
    meta: {
      srcField: meta.srcField,
      dstField: meta.dstField,
      ...(meta.groupField ? { groupField: meta.groupField } : {}),
      index: meta.index ?? '(default)',
      timeRange: { from: meta.from, to: meta.to },
      ...(meta.kql ? { kql: meta.kql } : {}),
      generatedAt: new Date().toISOString(),
      nodeCount: graph.nodes.length,
      linkCount: graph.links.length,
      truncated: graph.truncated,
    },
    links: graph.links.map((l) => {
      const src = typeof l.source === 'string' ? l.source : String((l.source as any)?.id ?? l.source);
      const dst = typeof l.target === 'string' ? l.target : String((l.target as any)?.id ?? l.target);
      const srcColonIdx = src.indexOf('::');
      const dstColonIdx = dst.indexOf('::');
      const srcDisplay = srcColonIdx >= 0 ? src.slice(srcColonIdx + 2) : src;
      const dstDisplay = dstColonIdx >= 0 ? dst.slice(dstColonIdx + 2) : dst;
      return {
        source: srcDisplay,
        ...(srcColonIdx >= 0 ? { sourceGroup: src.slice(0, srcColonIdx) } : {}),
        destination: dstDisplay,
        sessions: l.sessions,
        ...(l.bytes !== undefined ? { bytes: l.bytes } : {}),
        ...(l.packets !== undefined ? { packets: l.packets } : {}),
      };
    }),
    nodes: graph.nodes.map((n) => {
      const colonIdx = n.id.indexOf('::');
      const displayId = colonIdx >= 0 ? n.id.slice(colonIdx + 2) : n.id;
      return {
        id: displayId,
        ...(n.group ? { group: n.group } : {}),
        role: n.role,
        sessions: n.sessions,
        peers: n.degree,
        ...(n.bytes !== undefined ? { bytes: n.bytes } : {}),
        ...(n.packets !== undefined ? { packets: n.packets } : {}),
      };
    }),
  };
}

/**
 * Produces a human-readable JSON-serializable snapshot of the topology graph
 * for use in AI assistant context or debugging.
 */
export function serializeTopologyGraph(
  graph: TopologyGraph,
  params: {
    index: string;
    from: string;
    to: string;
    site?: string;
    cidr?: string;
    building?: string;
    role?: string;
  }
): object {
  return {
    meta: {
      index: params.index,
      timeRange: { from: params.from, to: params.to },
      ...(params.site ? { site: params.site } : {}),
      ...(params.cidr ? { cidr: params.cidr } : {}),
      ...(params.building ? { building: params.building } : {}),
      ...(params.role ? { role: params.role } : {}),
      generatedAt: new Date().toISOString(),
      discoveredAt: graph.discoveredAt,
      method: graph.method,
      managedDevices: graph.nodes.filter((n) => n.managed !== false).length,
      discoveredDevices: graph.nodes.filter((n) => n.managed === false).length,
      linkCount: graph.links.length,
    },
    links: graph.links.map((l) => ({
      source: l.source,
      destination: l.target,
      method: l.method,
      status: l.status,
      ...(l.sourcePort ? { sourcePort: l.sourcePort } : {}),
      ...(l.targetPort ? { targetPort: l.targetPort } : {}),
    })),
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      ip: n.ip,
      type: n.type,
      status: n.status,
      managed: n.managed !== false,
      ...(n.site ? { site: n.site } : {}),
      ...(n.role ? { role: n.role } : {}),
    })),
  };
}
