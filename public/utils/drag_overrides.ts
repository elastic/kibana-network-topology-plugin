/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Node, NodeChange, XYPosition } from '@xyflow/react';

export type DragOverrides = Map<string, XYPosition>;

/**
 * Records terminal drag positions into the overrides map (mutates in place — the
 * map lives in a ref). Captures position changes whose `dragging` is not `true`
 * (the drop frame / non-interactive position sets), skipping the noisy live-drag
 * frames. Iterates the whole batch so multi-select drags (one change per node)
 * all persist correctly.
 */
export const recordDragOverrides = (
  changes: NodeChange[],
  overrides: DragOverrides
): DragOverrides => {
  for (const change of changes) {
    if (change.type === 'position' && change.dragging !== true && change.position) {
      overrides.set(change.id, change.position);
    }
  }
  return overrides;
};

/**
 * Returns a new node array with each node's `position` replaced by its stored
 * override when one exists. Preserves the original node reference when there is
 * no override so React.memo on the node component stays effective.
 */
export const applyDragOverrides = <T extends Node>(nodes: T[], overrides: DragOverrides): T[] =>
  nodes.map((n) => {
    const override = overrides.get(n.id);
    return override ? { ...n, position: override } : n;
  });
