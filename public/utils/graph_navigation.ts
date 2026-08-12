/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Edge, Node } from '@xyflow/react';

export type ArrowDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

// Minimum offset (in the dominant axis) a node must have from the focused node to
// count as lying in a given direction at all.
const DIRECTION_THRESHOLD = 50;

/** Undirected neighbour lookup, so "is this node connected to that one" is O(1). */
export const buildAdjacency = (edges: Edge[]): Map<string, Set<string>> => {
  const adjacency = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    let set = adjacency.get(from);
    if (!set) adjacency.set(from, (set = new Set()));
    set.add(to);
  };
  for (const edge of edges) {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  }
  return adjacency;
};

/** Is the offset on the correct side of the origin for this direction at all? */
const isOnDirectionSide = (direction: ArrowDirection, dx: number, dy: number): boolean => {
  switch (direction) {
    case 'ArrowRight':
      return dx > DIRECTION_THRESHOLD;
    case 'ArrowLeft':
      return dx < -DIRECTION_THRESHOLD;
    case 'ArrowDown':
      return dy > DIRECTION_THRESHOLD;
    case 'ArrowUp':
      return dy < -DIRECTION_THRESHOLD;
  }
};

/**
 * Stricter test that also requires the pressed axis to be the dominant one, so a
 * node barely to the right but far below is not treated as "to the right".
 */
const isGridStepAway = (direction: ArrowDirection, dx: number, dy: number): boolean => {
  if (!isOnDirectionSide(direction, dx, dy)) return false;
  return direction === 'ArrowLeft' || direction === 'ArrowRight'
    ? Math.abs(dy) < Math.abs(dx)
    : Math.abs(dx) < Math.abs(dy);
};

/**
 * Picks the node an arrow key should move focus to.
 *
 * Connected devices win. A topology map is a graph, not a grid — for an operator
 * tracing a path, the useful next stop is a device this one actually links to, not
 * whichever unrelated device happens to sit nearest. Purely spatial movement sent
 * most arrow presses to devices with no link to the origin.
 *
 * The two passes use deliberately different strictness:
 *
 *  1. Connected devices need only be on the correct *side* of the origin. The tiered
 *     layout puts rows ~136px apart while spreading columns across the full canvas,
 *     so a cross-tier link almost always has a larger horizontal than vertical
 *     offset. Demanding a dominant axis here discarded a connected device in over a
 *     third of presses that had one — including plain uplinks such as a switch
 *     reaching its firewall one row up but a couple of columns over.
 *
 *  2. The fallback, used when nothing connected lies that way, keeps the dominant-axis
 *     rule. With no link to justify a diagonal jump, movement should feel grid-like.
 *     Falling back at all is what stops leaf devices — and the unlinked nodes a type
 *     filter can leave behind — from trapping keyboard focus.
 */
export const findNodeInDirection = <T extends Node>(
  nodes: T[],
  adjacency: Map<string, Set<string>>,
  currentNodeId: string,
  direction: ArrowDirection
): T | null => {
  const current = nodes.find((n) => n.id === currentNodeId);
  if (!current) return null;

  const origin = current.position;
  const neighbours = adjacency.get(currentNodeId);

  const connected: T[] = [];
  const gridSteps: T[] = [];

  for (const node of nodes) {
    if (node.id === currentNodeId) continue;
    const dx = node.position.x - origin.x;
    const dy = node.position.y - origin.y;

    if (neighbours?.has(node.id) && isOnDirectionSide(direction, dx, dy)) {
      connected.push(node);
    } else if (isGridStepAway(direction, dx, dy)) {
      gridSteps.push(node);
    }
  }

  const pool = connected.length > 0 ? connected : gridSteps;
  if (pool.length === 0) return null;

  const distanceFromOrigin = (node: T) => {
    const dx = node.position.x - origin.x;
    const dy = node.position.y - origin.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  return pool.reduce((closest, node) =>
    distanceFromOrigin(node) < distanceFromOrigin(closest) ? node : closest
  );
};
