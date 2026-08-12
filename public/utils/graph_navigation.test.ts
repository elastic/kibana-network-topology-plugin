/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Edge, Node } from '@xyflow/react';
import { buildAdjacency, findNodeInDirection } from './graph_navigation';

const node = (id: string, x: number, y: number): Node =>
  ({ id, position: { x, y }, data: {} } as Node);

const edge = (source: string, target: string): Edge =>
  ({ id: `${source}||${target}`, source, target } as Edge);

describe('buildAdjacency', () => {
  it('records neighbours in both directions', () => {
    const adjacency = buildAdjacency([edge('a', 'b')]);

    expect([...(adjacency.get('a') ?? [])]).toEqual(['b']);
    expect([...(adjacency.get('b') ?? [])]).toEqual(['a']);
  });

  it('collapses parallel links between the same pair', () => {
    const adjacency = buildAdjacency([edge('a', 'b'), edge('a', 'b')]);

    expect(adjacency.get('a')?.size).toBe(1);
  });

  it('returns no entry for a node with no links', () => {
    expect(buildAdjacency([edge('a', 'b')]).get('island')).toBeUndefined();
  });
});

describe('findNodeInDirection', () => {
  it('prefers a connected device over a nearer unconnected one', () => {
    // `near` sits closer to the right, but only `far` is actually linked to `origin`.
    // This is the case that made 5 of 6 arrow presses land on unrelated devices.
    const nodes = [node('origin', 0, 0), node('near', 200, 0), node('far', 600, 0)];
    const adjacency = buildAdjacency([edge('origin', 'far')]);

    expect(findNodeInDirection(nodes, adjacency, 'origin', 'ArrowRight')?.id).toBe('far');
  });

  it('takes the closest when several connected devices lie that way', () => {
    const nodes = [node('origin', 0, 0), node('mid', 200, 0), node('far', 600, 0)];
    const adjacency = buildAdjacency([edge('origin', 'mid'), edge('origin', 'far')]);

    expect(findNodeInDirection(nodes, adjacency, 'origin', 'ArrowRight')?.id).toBe('mid');
  });

  it('reaches a connected device the dominant-axis rule would reject', () => {
    // A switch reaching its firewall one tier up but a few columns over: |dx| slightly
    // exceeds |dy|, which a grid-style rule discards even though it is a real uplink.
    // Measured on live data, that rule threw away a connected device in 28 of the 78
    // presses that had one.
    const nodes = [node('sw', 0, 0), node('fw', -143, -136)];
    const adjacency = buildAdjacency([edge('sw', 'fw')]);

    expect(findNodeInDirection(nodes, adjacency, 'sw', 'ArrowUp')?.id).toBe('fw');
  });

  it('still will not send an arrow press backwards along its own axis', () => {
    // Relaxing the dominant axis must not relax the *side*: a connected device below
    // is never an ArrowUp target, however close it is.
    const nodes = [node('sw', 0, 0), node('below', 20, 300)];
    const adjacency = buildAdjacency([edge('sw', 'below')]);

    expect(findNodeInDirection(nodes, adjacency, 'sw', 'ArrowUp')).toBeNull();
    expect(findNodeInDirection(nodes, adjacency, 'sw', 'ArrowDown')?.id).toBe('below');
  });

  it('keeps the grid-like rule for the unconnected fallback', () => {
    // Nothing connected lies right, and `belowRight` is mostly below — with no link to
    // justify the diagonal, ArrowRight should find nothing rather than jump to it.
    const nodes = [node('origin', 0, 0), node('belowRight', 100, 500)];

    expect(findNodeInDirection(nodes, new Map(), 'origin', 'ArrowRight')).toBeNull();
  });

  it('falls back to the nearest unconnected device so focus is never trapped', () => {
    // A leaf device, or one left unlinked by a type filter, must still be escapable.
    const nodes = [node('origin', 0, 0), node('unlinked', 200, 0)];

    expect(findNodeInDirection(nodes, new Map(), 'origin', 'ArrowRight')?.id).toBe('unlinked');
  });

  it('ignores connected devices that lie in a different direction', () => {
    const nodes = [node('origin', 0, 0), node('above', 0, -400), node('right', 400, 0)];
    const adjacency = buildAdjacency([edge('origin', 'above'), edge('origin', 'right')]);

    expect(findNodeInDirection(nodes, adjacency, 'origin', 'ArrowUp')?.id).toBe('above');
    expect(findNodeInDirection(nodes, adjacency, 'origin', 'ArrowRight')?.id).toBe('right');
  });

  it.each([
    ['ArrowRight', 400, 0],
    ['ArrowLeft', -400, 0],
    ['ArrowDown', 0, 400],
    ['ArrowUp', 0, -400],
  ] as const)('resolves %s', (direction, dx, dy) => {
    const nodes = [node('origin', 0, 0), node('target', dx, dy)];
    const adjacency = buildAdjacency([edge('origin', 'target')]);

    expect(findNodeInDirection(nodes, adjacency, 'origin', direction)?.id).toBe('target');
  });

  it('returns null when nothing lies in that direction', () => {
    const nodes = [node('origin', 0, 0), node('right', 400, 0)];
    const adjacency = buildAdjacency([edge('origin', 'right')]);

    expect(findNodeInDirection(nodes, adjacency, 'origin', 'ArrowLeft')).toBeNull();
  });

  it('ignores devices closer than the direction threshold', () => {
    // 20px of separation is drag jitter, not a deliberate move target.
    const nodes = [node('origin', 0, 0), node('touching', 20, 0)];

    expect(findNodeInDirection(nodes, new Map(), 'origin', 'ArrowRight')).toBeNull();
  });

  it('does not treat a mostly-below device as being to the right', () => {
    const nodes = [node('origin', 0, 0), node('belowRight', 100, 500)];

    expect(findNodeInDirection(nodes, new Map(), 'origin', 'ArrowRight')).toBeNull();
    expect(findNodeInDirection(nodes, new Map(), 'origin', 'ArrowDown')?.id).toBe('belowRight');
  });

  it('returns null for an unknown origin id', () => {
    expect(findNodeInDirection([node('a', 0, 0)], new Map(), 'ghost', 'ArrowRight')).toBeNull();
  });

  it('never returns the origin itself', () => {
    expect(findNodeInDirection([node('a', 0, 0)], new Map(), 'a', 'ArrowRight')).toBeNull();
  });
});
