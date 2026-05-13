/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import apm from 'elastic-apm-node';
import type { ElasticsearchClient } from '@kbn/core/server';

type SearchParams = Parameters<ElasticsearchClient['search']>[0];

/**
 * Wraps an Elasticsearch search call in an APM span, capturing:
 * - The ES internal execution time (`es.took_ms`)
 * - Shard success/failure counts
 * - Total hit count
 * The span is named `networkTopology.<spanName>` with type `db.elasticsearch.query`.
 */
export async function tracedSearch(
  esClient: ElasticsearchClient,
  spanName: string,
  params: SearchParams
): ReturnType<ElasticsearchClient['search']> {
  const span = apm.startSpan(`networkTopology.${spanName}`, 'db', 'elasticsearch', 'query');
  try {
    const res = await esClient.search(params);
    if (span) {
      const r = res as any;
      span.addLabels({
        es_took_ms: r.took ?? 0,
        es_hits_total: r.hits?.total?.value ?? r.hits?.total ?? 0,
        es_shards_successful: r._shards?.successful ?? 0,
        es_shards_failed: r._shards?.failed ?? 0,
      });
    }
    return res;
  } finally {
    span?.end();
  }
}
