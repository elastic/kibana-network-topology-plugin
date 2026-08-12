/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Position, type InternalNode, type Node, type XYPosition } from '@xyflow/react';

/**
 * Diameter of the circle that represents a device.
 *
 * The circle sits at the *top* of the node box, with the label and IP stacked
 * beneath it, so edges anchor to the circle rather than to the node's bounding-box
 * centre — the latter would land in the text below the device.
 */
export const NODE_CIRCLE_SIZE = 60;

/**
 * Fixed width of the whole node box (circle plus the label/IP block beneath it).
 *
 * Pinned rather than left to size from its content so that edge anchors stay put
 * when the label and IP are hidden at low zoom — otherwise the box would narrow to
 * the circle and every edge would visibly jump sideways as you zoom out.
 */
export const NODE_BOX_WIDTH = 120;

/**
 * Two nodes count as being on the same tier when their vertical offset is under
 * half a row's spacing (see MIN_V_SPACING in graph_to_react_flow). A tolerance
 * rather than exact y-equality keeps the choice stable while a node is dragged —
 * an equality test would flip sides the moment a node moved a single pixel.
 */
const SAME_TIER_Y_TOLERANCE = 60;

export type EdgeSide = 'top' | 'bottom' | 'left' | 'right';

export interface EdgeAnchor extends XYPosition {
  position: Position;
}

/**
 * Chooses which side of each device circle an edge should attach to.
 *
 * Cross-tier links exit the upper node's bottom and enter the lower node's top,
 * matching the tiered layout. Same-tier links (e.g. a mesh between switches at
 * equal height) instead run left-to-right between whichever node is further
 * left/right, since a top/bottom loop would look odd for two nodes side by side.
 */
export const pickEdgeSides = (
  source: XYPosition,
  target: XYPosition
): { source: EdgeSide; target: EdgeSide } => {
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  if (Math.abs(dy) < SAME_TIER_Y_TOLERANCE) {
    return dx >= 0
      ? { source: 'right', target: 'left' } // source is left of target
      : { source: 'left', target: 'right' }; // source is right of target
  }
  return dy > 0
    ? { source: 'bottom', target: 'top' } // source is above target
    : { source: 'top', target: 'bottom' }; // source is below target
};

const SIDE_TO_POSITION: Record<EdgeSide, Position> = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
};

/** Projects a side onto the circle's perimeter, where the matching Handle sits. */
const anchorOn = (centre: XYPosition, side: EdgeSide): EdgeAnchor => {
  const radius = NODE_CIRCLE_SIZE / 2;
  const offsets: Record<EdgeSide, XYPosition> = {
    top: { x: 0, y: -radius },
    bottom: { x: 0, y: radius },
    left: { x: -radius, y: 0 },
    right: { x: radius, y: 0 },
  };
  const offset = offsets[side];
  return { x: centre.x + offset.x, y: centre.y + offset.y, position: SIDE_TO_POSITION[side] };
};

/**
 * Centre of a node's device circle in flow coordinates.
 *
 * Horizontally the circle is centred in the node box; vertically it starts at the
 * node's top edge, so its centre is one radius down regardless of how tall the
 * label/IP block below it turns out to be.
 */
export const getCircleCentre = (node: InternalNode<Node>): XYPosition => ({
  x: node.internals.positionAbsolute.x + (node.measured.width ?? NODE_BOX_WIDTH) / 2,
  y: node.internals.positionAbsolute.y + NODE_CIRCLE_SIZE / 2,
});

/**
 * Live anchor points for an edge, derived from the two nodes' current positions.
 *
 * This is the "floating edge" pattern: because the anchors are recomputed from
 * live positions on every store update, edges keep tracking their devices as an
 * operator drags them around, instead of staying pinned to whichever handle was
 * assigned when the layout was first computed.
 */
export const getEdgeAnchors = (
  sourceNode: InternalNode<Node>,
  targetNode: InternalNode<Node>
): { source: EdgeAnchor; target: EdgeAnchor } => {
  const sourceCentre = getCircleCentre(sourceNode);
  const targetCentre = getCircleCentre(targetNode);
  const sides = pickEdgeSides(sourceCentre, targetCentre);

  return {
    source: anchorOn(sourceCentre, sides.source),
    target: anchorOn(targetCentre, sides.target),
  };
};
