/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Position, type InternalNode, type Node } from '@xyflow/react';
import {
  NODE_BOX_WIDTH,
  NODE_CIRCLE_SIZE,
  getCircleCentre,
  getEdgeAnchors,
  pickEdgeSides,
} from './edge_geometry';

/** Minimal InternalNode stand-in — only the fields the geometry helpers read. */
const internalNode = (x: number, y: number, width = NODE_BOX_WIDTH): InternalNode<Node> =>
  ({
    id: `n-${x}-${y}`,
    position: { x, y },
    data: {},
    measured: { width, height: 100 },
    internals: { positionAbsolute: { x, y }, z: 0, userNode: {} },
  } as unknown as InternalNode<Node>);

describe('pickEdgeSides', () => {
  it('runs left-to-right for nodes on the same tier', () => {
    expect(pickEdgeSides({ x: 0, y: 100 }, { x: 300, y: 100 })).toEqual({
      source: 'right',
      target: 'left',
    });
  });

  it('runs right-to-left when the source is the further right of the two', () => {
    expect(pickEdgeSides({ x: 300, y: 100 }, { x: 0, y: 100 })).toEqual({
      source: 'left',
      target: 'right',
    });
  });

  it('runs top-to-bottom when the source sits on a tier above the target', () => {
    expect(pickEdgeSides({ x: 0, y: 0 }, { x: 0, y: 240 })).toEqual({
      source: 'bottom',
      target: 'top',
    });
  });

  it('runs bottom-to-top when the source sits on a tier below the target', () => {
    expect(pickEdgeSides({ x: 0, y: 240 }, { x: 0, y: 0 })).toEqual({
      source: 'top',
      target: 'bottom',
    });
  });

  it('still goes vertical for a long cross-tier link, not sideways', () => {
    // dx (800) far exceeds dy (120), but the nodes are a full row apart, so the
    // edge must still read as a tier-to-tier link.
    expect(pickEdgeSides({ x: 0, y: 0 }, { x: 800, y: 120 })).toEqual({
      source: 'bottom',
      target: 'top',
    });
  });

  it('tolerates small vertical drift within a tier rather than flipping to vertical', () => {
    // A few pixels of drag wobble must not flip a same-tier link to top/bottom.
    expect(pickEdgeSides({ x: 0, y: 100 }, { x: 300, y: 108 })).toEqual({
      source: 'right',
      target: 'left',
    });
  });
});

describe('getCircleCentre', () => {
  it('centres horizontally on the node box and one radius down from its top edge', () => {
    // The circle sits above the label/IP block, so the centre is NOT the box midpoint.
    expect(getCircleCentre(internalNode(200, 500))).toEqual({
      x: 200 + NODE_BOX_WIDTH / 2,
      y: 500 + NODE_CIRCLE_SIZE / 2,
    });
  });

  it('falls back to the nominal box width before the node has been measured', () => {
    const unmeasured = {
      ...internalNode(0, 0),
      measured: {},
    } as unknown as InternalNode<Node>;

    expect(getCircleCentre(unmeasured).x).toBe(NODE_BOX_WIDTH / 2);
  });
});

describe('getEdgeAnchors', () => {
  it('anchors on the circle perimeter, not the node box edge', () => {
    const source = internalNode(0, 0);
    const target = internalNode(0, 400);
    const { source: from, target: to } = getEdgeAnchors(source, target);

    const centreX = NODE_BOX_WIDTH / 2;
    const radius = NODE_CIRCLE_SIZE / 2;

    expect(from).toEqual({
      x: centreX,
      y: NODE_CIRCLE_SIZE / 2 + radius,
      position: Position.Bottom,
    });
    expect(to).toEqual({
      x: centreX,
      y: 400 + NODE_CIRCLE_SIZE / 2 - radius,
      position: Position.Top,
    });
  });

  it('re-picks sides once a node is dragged past its neighbour', () => {
    const stationary = internalNode(0, 0);

    // Neighbour starts below → edge leaves the bottom of the stationary node.
    expect(getEdgeAnchors(stationary, internalNode(0, 400)).source.position).toBe(Position.Bottom);

    // Dragged above → the same edge must now leave the top instead. This is the
    // regression the static layout-time handle assignment could not express.
    expect(getEdgeAnchors(stationary, internalNode(0, -400)).source.position).toBe(Position.Top);
  });

  it('produces horizontally opposed anchors for a same-tier link', () => {
    const { source, target } = getEdgeAnchors(internalNode(0, 0), internalNode(400, 0));

    expect(source.position).toBe(Position.Right);
    expect(target.position).toBe(Position.Left);
    expect(source.y).toBe(NODE_CIRCLE_SIZE / 2);
    expect(target.y).toBe(NODE_CIRCLE_SIZE / 2);
  });
});
