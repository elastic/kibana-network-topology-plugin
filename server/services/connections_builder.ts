/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { buildEsQuery, type Filter, type Query } from '@kbn/es-query';
import type {
  ConnectionsGraph,
  ConnectionsLink,
  ConnectionsNode,
  ConnectionRole,
} from '../../common';
import { CONNECTIONS_METRIC_FIELDS } from '../../common';

export interface BuildConnectionsOptions {
  index: string;
  srcField: string;
  dstField: string;
  from: string;
  to: string;
  /** Optional KQL, parsed with `buildEsQuery` */
  kql?: string;
  /** JSON-serialized `Filter[]` from the search bar */
  filters?: string;
  /** Already clamped to `CONNECTIONS_LIMITS` by the route */
  maxSources: number;
  maxDstPerSource: number;
  minSessions: number;
  /** Optional field to distinguish same-value entities across different network contexts. */
  groupField?: string;
  /** Top-K group values. No server-side cap; ES surfaces the error on oversized requests. */
  maxGroups?: number;
  logger: Logger;
}

// Shapes of the two terms levels we read back. Deliberately loose — bucket keys
// come back as numbers for numeric/port fields and as strings for ip/keyword.
interface TermsAggResult<B> {
  buckets?: B[];
  sum_other_doc_count?: number;
}
interface MetricAggResult {
  value?: number | null;
}
interface DstBucket {
  key: string | number;
  doc_count: number;
  bytes?: MetricAggResult;
  packets?: MetricAggResult;
}
interface SrcBucket {
  key: string | number;
  doc_count: number;
  dst?: TermsAggResult<DstBucket>;
}

/** Group-level bucket when a `groupField` three-level agg is used. */
interface GroupBucket {
  key: string | number;
  doc_count: number;
  src?: TermsAggResult<SrcBucket>;
}

/**
 * Flattens a three-level `group → src → dst` agg into the two-level `src → dst`
 * shape that `shapeConnectionsGraph` expects, prefixing every source bucket key
 * with `{group}::` so same-IP entities in different groups get distinct node IDs.
 *
 * `sum_other_doc_count` from any level propagates as a truncation signal: if any
 * group or source bucket was capped, we merge the counts into the flattened agg's
 * outer `sum_other_doc_count` so the truncation callout fires correctly.
 */
export function prefixGroupedSources(
  groupAgg: TermsAggResult<GroupBucket> | undefined
): TermsAggResult<SrcBucket> {
  if (!groupAgg?.buckets?.length) {
    return { buckets: [], sum_other_doc_count: groupAgg?.sum_other_doc_count ?? 0 };
  }

  const flatSrcMap = new Map<string, SrcBucket>();
  let truncated = Boolean(groupAgg.sum_other_doc_count);

  for (const groupBucket of groupAgg.buckets) {
    const groupKey = String(groupBucket.key);
    if (groupBucket.src?.sum_other_doc_count) truncated = true;

    for (const srcBucket of groupBucket.src?.buckets ?? []) {
      const prefixedKey = `${groupKey}::${String(srcBucket.key)}`;
      const existing = flatSrcMap.get(prefixedKey);

      // Merge into any existing entry for this prefixed source (in practice each
      // group+src combination is unique, but merge defensively).
      if (existing) {
        existing.doc_count += srcBucket.doc_count;
        if (existing.dst && srcBucket.dst) {
          // Append dst buckets — shapeConnectionsGraph will deduplicate by id.
          existing.dst.buckets = [...(existing.dst.buckets ?? []), ...(srcBucket.dst.buckets ?? [])];
          if (srcBucket.dst.sum_other_doc_count) {
            existing.dst.sum_other_doc_count =
              (existing.dst.sum_other_doc_count ?? 0) + srcBucket.dst.sum_other_doc_count;
          }
        }
      } else {
        flatSrcMap.set(prefixedKey, {
          key: prefixedKey,
          doc_count: srcBucket.doc_count,
          dst: srcBucket.dst
            ? { ...srcBucket.dst, buckets: [...(srcBucket.dst.buckets ?? [])] }
            : undefined,
        });
      }
    }
  }

  return {
    buckets: [...flatSrcMap.values()],
    sum_other_doc_count: truncated ? 1 : 0,
  };
}

interface NodeAccumulator {
  sessions: number;
  bytes: number;
  packets: number;
  degree: number;
  asSource: boolean;
  asTarget: boolean;
}

/**
 * Turns the nested `src → dst` terms response into a ready-to-render graph.
 *
 * Split out from the Elasticsearch call so the bucket→graph contract (role
 * derivation, metric summation, truncation, min-session filtering, numeric key
 * coercion) is unit-testable against fixture responses.
 */
export function shapeConnectionsGraph(
  srcAgg: TermsAggResult<SrcBucket> | undefined,
  options: { minSessions: number; took: number }
): ConnectionsGraph {
  const { minSessions, took } = options;

  // `sum_other_doc_count > 0` at either level means we are showing a top-N
  // sample, not the full pair set.
  let truncated = Boolean(srcAgg?.sum_other_doc_count);

  const linkMap = new Map<string, ConnectionsLink>();
  // Whether the index actually carries these metrics. All-zero across every
  // bucket means the field is unmapped (a `sum` over a missing field returns 0),
  // and reporting "0 B" everywhere would be misleading.
  let anyBytes = false;
  let anyPackets = false;

  for (const srcBucket of srcAgg?.buckets ?? []) {
    const source = String(srcBucket.key);
    if (!source) continue;
    if (srcBucket.dst?.sum_other_doc_count) truncated = true;

    for (const dstBucket of srcBucket.dst?.buckets ?? []) {
      const target = String(dstBucket.key);
      // Self-pairs (a host talking to itself, NAT hairpins) are degenerate in a
      // force layout — a zero-length link that only distorts the charge field.
      if (!target || target === source) continue;

      const sessions = dstBucket.doc_count ?? 0;
      if (sessions < minSessions) continue;

      const bytes = dstBucket.bytes?.value ?? 0;
      const packets = dstBucket.packets?.value ?? 0;
      if (bytes > 0) anyBytes = true;
      if (packets > 0) anyPackets = true;

      const id = `${source}→${target}`;
      const existing = linkMap.get(id);
      if (existing) {
        // Nested terms cannot repeat a pair, but distinct numeric keys can
        // stringify identically in principle — merge rather than overwrite.
        existing.sessions += sessions;
        existing.bytes = (existing.bytes ?? 0) + bytes;
        existing.packets = (existing.packets ?? 0) + packets;
      } else {
        linkMap.set(id, { id, source, target, sessions, bytes, packets });
      }
    }
  }

  // Nodes are derived from the final link set so `degree` and `sessions` stay
  // consistent with what actually gets rendered.
  const acc = new Map<string, NodeAccumulator>();
  const ensure = (id: string): NodeAccumulator => {
    let entry = acc.get(id);
    if (!entry) {
      entry = { sessions: 0, bytes: 0, packets: 0, degree: 0, asSource: false, asTarget: false };
      acc.set(id, entry);
    }
    return entry;
  };

  for (const link of linkMap.values()) {
    const src = ensure(link.source);
    src.sessions += link.sessions;
    src.bytes += link.bytes ?? 0;
    src.packets += link.packets ?? 0;
    src.degree += 1;
    src.asSource = true;

    const dst = ensure(link.target);
    dst.sessions += link.sessions;
    dst.bytes += link.bytes ?? 0;
    dst.packets += link.packets ?? 0;
    dst.degree += 1;
    dst.asTarget = true;
  }

  const roleOf = (entry: NodeAccumulator): ConnectionRole =>
    entry.asSource && entry.asTarget ? 'both' : entry.asSource ? 'source' : 'destination';

  const nodes: ConnectionsNode[] = [...acc.entries()].map(([id, entry]) => {
    const node: ConnectionsNode = {
      id,
      role: roleOf(entry),
      sessions: entry.sessions,
      degree: entry.degree,
    };
    if (anyBytes) node.bytes = entry.bytes;
    if (anyPackets) node.packets = entry.packets;
    // Extract the group prefix from `{group}::value` source IDs.
    const colonIdx = id.indexOf('::');
    if (colonIdx >= 0) node.group = id.slice(0, colonIdx);
    return node;
  });

  const links: ConnectionsLink[] = [...linkMap.values()].map((link) => {
    const shaped: ConnectionsLink = {
      id: link.id,
      source: link.source,
      target: link.target,
      sessions: link.sessions,
    };
    if (anyBytes) shaped.bytes = link.bytes;
    if (anyPackets) shaped.packets = link.packets;
    return shaped;
  });

  // Busiest first, id as a tie-break: deterministic output, and the client's
  // safety-net cap keeps the most significant part of the graph.
  const bySessionsDesc = <T extends { sessions: number; id: string }>(a: T, b: T) =>
    b.sessions - a.sessions || a.id.localeCompare(b.id);
  nodes.sort(bySessionsDesc);
  links.sort(bySessionsDesc);

  return { nodes, links, truncated, took };
}

export async function buildConnectionsGraph(
  esClient: ElasticsearchClient,
  options: BuildConnectionsOptions
): Promise<ConnectionsGraph> {
  const {
    index,
    srcField,
    dstField,
    from,
    to,
    kql,
    filters,
    maxSources,
    maxDstPerSource,
    minSessions,
    groupField,
    maxGroups = 10,
    logger,
  } = options;

  const esFilters: any[] = [{ range: { '@timestamp': { gte: from, lte: to } } }];

  if (kql || filters) {
    const queries: Query[] = kql ? [{ language: 'kuery', query: kql }] : [];
    const parsedFilters: Filter[] = [];
    if (filters) {
      try {
        const parsed = JSON.parse(filters);
        if (Array.isArray(parsed)) parsedFilters.push(...parsed);
      } catch {
        // ignore malformed filters
      }
    }
    // Throws `KQLSyntaxError` on a malformed expression; the route maps it to a 400.
    esFilters.push(
      buildEsQuery(undefined, queries, parsedFilters, { allowLeadingWildcards: true })
    );
  }

  // Nested `terms` (top-N sources → top-M destinations per source) rather than
  // `multi_terms`: both levels can use global ordinals, and "top talkers" is the
  // correct semantic for this view. `multi_terms` materializes a composite key
  // for every src×dst combination and does not survive realistic flow volumes.
  const result = await esClient.search({
    index,
    size: 0,
    track_total_hits: false,
    // An index pattern that resolves to nothing is an empty graph, not an error —
    // the field pair and the index are both free-form here.
    ignore_unavailable: true,
    allow_no_indices: true,
    query: { bool: { filter: esFilters } },
    aggs: groupField
      ? // Three-level agg: group → src → dst. `prefixGroupedSources` flattens it
        // into the two-level shape `shapeConnectionsGraph` expects.
        {
          grp: {
            terms: { field: groupField, size: maxGroups, order: { _count: 'desc' } },
            aggs: {
              src: {
                terms: { field: srcField, size: maxSources, order: { _count: 'desc' } },
                aggs: {
                  dst: {
                    terms: { field: dstField, size: maxDstPerSource, order: { _count: 'desc' } },
                    aggs: {
                      bytes: { sum: { field: CONNECTIONS_METRIC_FIELDS.bytes } },
                      packets: { sum: { field: CONNECTIONS_METRIC_FIELDS.packets } },
                    },
                  },
                },
              },
            },
          },
        }
      : // Deliberately no `min_doc_count` here even though minSessions would map
        // onto it: terms dropped by min_doc_count also count towards
        // `sum_other_doc_count`, which would make the "showing a top-N sample"
        // signal fire for every request with minSessions > 1. The threshold is
        // applied to the flattened links instead.
        {
          src: {
            terms: { field: srcField, size: maxSources, order: { _count: 'desc' } },
            aggs: {
              dst: {
                terms: { field: dstField, size: maxDstPerSource, order: { _count: 'desc' } },
                aggs: {
                  bytes: { sum: { field: CONNECTIONS_METRIC_FIELDS.bytes } },
                  packets: { sum: { field: CONNECTIONS_METRIC_FIELDS.packets } },
                },
              },
            },
          },
        },
  });

  const flatSrc = groupField
    ? prefixGroupedSources(result.aggregations?.grp as TermsAggResult<GroupBucket>)
    : (result.aggregations?.src as TermsAggResult<SrcBucket>);

  const graph = shapeConnectionsGraph(flatSrc, {
    minSessions,
    took: result.took ?? 0,
  });

  logger.debug(
    `Connections graph built: ${graph.nodes.length} nodes, ${graph.links.length} links ` +
      `(${srcField} → ${dstField}, took ${graph.took}ms${graph.truncated ? ', truncated' : ''})`
  );

  return graph;
}
