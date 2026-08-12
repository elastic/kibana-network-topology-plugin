/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Node, NodeChange } from '@xyflow/react';
import { applyDragOverrides, recordDragOverrides, type DragOverrides } from './drag_overrides';

const node = (id: string, x: number, y: number): Node =>
  ({ id, position: { x, y }, data: {} } as Node);

describe('recordDragOverrides', () => {
  it('records the drop position and ignores the live-drag frames', () => {
    const overrides: DragOverrides = new Map();

    // Live-drag frames stream in with dragging: true and must not be recorded —
    // only the terminal position matters for persistence.
    recordDragOverrides(
      [{ type: 'position', id: 'a', position: { x: 10, y: 10 }, dragging: true }],
      overrides
    );
    expect(overrides.size).toBe(0);

    recordDragOverrides(
      [{ type: 'position', id: 'a', position: { x: 99, y: 42 }, dragging: false }],
      overrides
    );
    expect(overrides.get('a')).toEqual({ x: 99, y: 42 });
  });

  it('records every node in a multi-select drag batch', () => {
    const overrides: DragOverrides = new Map();

    recordDragOverrides(
      [
        { type: 'position', id: 'a', position: { x: 1, y: 2 }, dragging: false },
        { type: 'position', id: 'b', position: { x: 3, y: 4 }, dragging: false },
      ],
      overrides
    );

    expect([...overrides.entries()]).toEqual([
      ['a', { x: 1, y: 2 }],
      ['b', { x: 3, y: 4 }],
    ]);
  });

  it('ignores changes that are not positional', () => {
    const overrides: DragOverrides = new Map();

    recordDragOverrides(
      [
        { type: 'select', id: 'a', selected: true },
        { type: 'remove', id: 'b' },
      ] as NodeChange[],
      overrides
    );

    expect(overrides.size).toBe(0);
  });

  it('keeps the most recent drop for a node', () => {
    const overrides: DragOverrides = new Map();

    recordDragOverrides(
      [{ type: 'position', id: 'a', position: { x: 1, y: 1 }, dragging: false }],
      overrides
    );
    recordDragOverrides(
      [{ type: 'position', id: 'a', position: { x: 2, y: 2 }, dragging: false }],
      overrides
    );

    expect(overrides.get('a')).toEqual({ x: 2, y: 2 });
  });
});

describe('applyDragOverrides', () => {
  it('replaces positions for overridden nodes only', () => {
    const nodes = [node('a', 0, 0), node('b', 5, 5)];
    const overrides: DragOverrides = new Map([['a', { x: 100, y: 200 }]]);

    const result = applyDragOverrides(nodes, overrides);

    expect(result[0].position).toEqual({ x: 100, y: 200 });
    expect(result[1].position).toEqual({ x: 5, y: 5 });
  });

  it('preserves the original object reference when a node has no override', () => {
    // React.memo on the node component relies on this — churning refs for
    // untouched nodes would re-render the whole graph on every data refresh.
    const untouched = node('b', 5, 5);
    const result = applyDragOverrides([untouched], new Map());

    expect(result[0]).toBe(untouched);
  });

  it('ignores overrides for nodes that are no longer in the graph', () => {
    const overrides: DragOverrides = new Map([['gone', { x: 1, y: 1 }]]);
    const result = applyDragOverrides([node('a', 0, 0)], overrides);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });
});
