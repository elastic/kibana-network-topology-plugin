/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConnectionsNode } from '../../common';
import { CONNECTION_GROUP_PALETTE } from '../../common';

/**
 * Builds a stable group→colour map from the nodes in a graph.
 * Groups are assigned colours in the order they first appear (busiest-first, since
 * the server sorts nodes that way). Returns an empty map when no nodes have groups.
 */
export function buildGroupColorMap(nodes: ConnectionsNode[]): Map<string, string> {
  const seen: string[] = [];
  for (const n of nodes) {
    if (n.group && !seen.includes(n.group)) seen.push(n.group);
  }
  return new Map(
    seen.map((g, i) => [g, CONNECTION_GROUP_PALETTE[i % CONNECTION_GROUP_PALETTE.length]])
  );
}

/**
 * Strips the `{group}::` prefix from a node ID so labels and tooltips show the
 * raw field value (e.g. "10.1.2.3") instead of "datacenter-a::10.1.2.3".
 */
export function nodeDisplayLabel(id: string): string {
  const idx = id.indexOf('::');
  return idx >= 0 ? id.slice(idx + 2) : id;
}
