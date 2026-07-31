/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { shapeConnectionsGraph } from './connections_builder';

/** Inner (destination) terms bucket, as Elasticsearch returns it. */
function dstBucket(key: string | number, docCount: number, bytes = 0, packets = 0) {
  return { key, doc_count: docCount, bytes: { value: bytes }, packets: { value: packets } };
}

/** Outer (source) terms bucket wrapping a nested `dst` terms agg. */
function srcBucket(
  key: string | number,
  dsts: ReturnType<typeof dstBucket>[],
  sumOtherDocCount = 0
) {
  return {
    key,
    doc_count: dsts.reduce((total, d) => total + d.doc_count, 0),
    dst: { buckets: dsts, sum_other_doc_count: sumOtherDocCount },
  };
}

function agg(srcs: ReturnType<typeof srcBucket>[], sumOtherDocCount = 0) {
  return { buckets: srcs, sum_other_doc_count: sumOtherDocCount };
}

const shape = (aggResult: ReturnType<typeof agg> | undefined, minSessions = 1) =>
  shapeConnectionsGraph(aggResult, { minSessions, took: 7 });

describe('shapeConnectionsGraph', () => {
  it('flattens nested buckets into links and derives node roles', () => {
    const graph = shape(
      agg([
        srcBucket('10.0.0.1', [dstBucket('10.0.0.2', 10)]),
        srcBucket('10.0.0.2', [dstBucket('10.0.0.3', 4)]),
      ])
    );

    expect(graph.links).toEqual([
      expect.objectContaining({ id: '10.0.0.1→10.0.0.2', source: '10.0.0.1', sessions: 10 }),
      expect.objectContaining({ id: '10.0.0.2→10.0.0.3', target: '10.0.0.3', sessions: 4 }),
    ]);

    const roles = Object.fromEntries(graph.nodes.map((n) => [n.id, n.role]));
    expect(roles).toEqual({
      '10.0.0.1': 'source', // only ever a source
      '10.0.0.2': 'both', // destination of one link, source of another
      '10.0.0.3': 'destination', // only ever a destination
    });
    expect(graph.took).toBe(7);
    expect(graph.truncated).toBe(false);
  });

  it('sums sessions, bytes, packets and degree across every link touching a node', () => {
    const graph = shape(
      agg([
        srcBucket('a', [dstBucket('hub', 10, 1000, 20), dstBucket('other', 1, 50, 2)]),
        srcBucket('b', [dstBucket('hub', 5, 500, 8)]),
      ])
    );

    expect(graph.nodes.find((n) => n.id === 'hub')).toEqual({
      id: 'hub',
      role: 'destination',
      sessions: 15,
      bytes: 1500,
      packets: 28,
      degree: 2,
    });

    expect(graph.nodes.find((n) => n.id === 'a')).toEqual({
      id: 'a',
      role: 'source',
      sessions: 11,
      bytes: 1050,
      packets: 22,
      degree: 2,
    });
  });

  it('flags truncation when the source cap is hit', () => {
    const graph = shape(agg([srcBucket('a', [dstBucket('b', 1)])], 12));
    expect(graph.truncated).toBe(true);
  });

  it('flags truncation when any per-source fan-out cap is hit', () => {
    const graph = shape(
      agg([srcBucket('a', [dstBucket('b', 1)]), srcBucket('c', [dstBucket('d', 1)], 3)])
    );
    expect(graph.truncated).toBe(true);
  });

  it('drops links below minSessions along with nodes left with no links', () => {
    const graph = shape(agg([srcBucket('a', [dstBucket('busy', 25), dstBucket('quiet', 2)])]), 10);

    expect(graph.links.map((l) => l.id)).toEqual(['a→busy']);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['a', 'busy']);
    // The filter is deliberate, not a cap — it must not set `truncated`.
    expect(graph.truncated).toBe(false);
  });

  it('coerces numeric bucket keys to strings', () => {
    const graph = shape(agg([srcBucket('10.0.0.1', [dstBucket(443, 9), dstBucket(53, 3)])]));

    expect(graph.links.map((l) => l.target)).toEqual(['443', '53']);
    expect(graph.nodes.map((n) => n.id)).toContain('443');
    graph.nodes.forEach((n) => expect(typeof n.id).toBe('string'));
  });

  it('drops self-pairs', () => {
    const graph = shape(
      agg([srcBucket('10.0.0.1', [dstBucket('10.0.0.1', 99), dstBucket('10.0.0.2', 4)])])
    );

    expect(graph.links.map((l) => l.id)).toEqual(['10.0.0.1→10.0.0.2']);
    expect(graph.nodes).toHaveLength(2);
  });

  it('omits bytes and packets when the metric fields are absent from the index', () => {
    // A `sum` over an unmapped field returns 0 for every bucket — reporting
    // "0 B" everywhere would read as real data.
    const graph = shape(agg([srcBucket('a', [dstBucket('b', 5, 0, 0)])]));

    expect(graph.links[0]).not.toHaveProperty('bytes');
    expect(graph.links[0]).not.toHaveProperty('packets');
    expect(graph.nodes[0]).not.toHaveProperty('bytes');
    expect(graph.nodes[0]).not.toHaveProperty('packets');
  });

  it('keeps a metric that is present on only some links', () => {
    const graph = shape(
      agg([srcBucket('a', [dstBucket('b', 5, 4096, 0), dstBucket('c', 5, 0, 0)])])
    );

    expect(graph.links.every((l) => typeof l.bytes === 'number')).toBe(true);
    expect(graph.links.find((l) => l.id === 'a→c')?.bytes).toBe(0);
    // No packet counts anywhere → still omitted.
    expect(graph.links[0]).not.toHaveProperty('packets');
  });

  it('tolerates null metric values', () => {
    const graph = shapeConnectionsGraph(
      { buckets: [{ key: 'a', doc_count: 3, dst: { buckets: [{ key: 'b', doc_count: 3 }] } }] },
      { minSessions: 1, took: 0 }
    );

    expect(graph.links[0].sessions).toBe(3);
    expect(graph.links[0]).not.toHaveProperty('bytes');
  });

  it('sorts nodes and links busiest first', () => {
    const graph = shape(
      agg([
        srcBucket('a', [dstBucket('small', 1), dstBucket('big', 50)]),
        srcBucket('b', [dstBucket('mid', 20)]),
      ])
    );

    expect(graph.links.map((l) => l.sessions)).toEqual([50, 20, 1]);
    expect(graph.nodes.map((n) => n.sessions)).toEqual([51, 50, 20, 20, 1]);
  });

  it('returns an empty graph when there are no buckets', () => {
    expect(shape(agg([]))).toEqual({ nodes: [], links: [], truncated: false, took: 7 });
    expect(shape(undefined)).toEqual({ nodes: [], links: [], truncated: false, took: 7 });
  });
});
