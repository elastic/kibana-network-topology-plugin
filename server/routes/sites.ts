/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IRouter, Logger } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import { API_ROUTES, DEFAULT_SNMP_INDEX, DEVICE_DOWN_THRESHOLD_MS } from '../../common';

export function registerSitesRoutes(router: IRouter, logger: Logger) {
  router.get(
    {
      path: API_ROUTES.SITES,
      validate: {
        query: schema.object({
          from: schema.string({ defaultValue: 'now-15m' }),
          to: schema.string({ defaultValue: 'now' }),
          index: schema.string({ defaultValue: DEFAULT_SNMP_INDEX }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { from, to, index } = request.query;
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const result = await esClient.search({
          index,
          size: 0,
          query: {
            bool: {
              filter: [{ range: { '@timestamp': { gte: from, lte: to } } }],
            },
          },
          aggs: {
            sites: {
              terms: { field: 'network.site', size: 500, missing: 'Ungrouped' },
              aggs: {
                device_count: { cardinality: { field: 'host.name' } },
                device_names: {
                  terms: { field: 'host.name', size: 5000 },
                  aggs: {
                    down_interfaces: {
                      filter: { term: { 'interface.status.oper': 'down' } },
                    },
                    total_interfaces: {
                      cardinality: { field: 'interface.name' },
                    },
                    last_seen: { max: { field: '@timestamp' } },
                  },
                },
              },
            },
            discovered_ips: { cardinality: { field: 'arp.ip_addr' } },
          },
        });

        const sitesAgg = (result.aggregations?.sites as any)?.buckets || [];

        const sites = sitesAgg.map((bucket: any) => {
          const devices = bucket.device_names?.buckets || [];
          let upCount = 0, downCount = 0, degradedCount = 0;

          devices.forEach((d: any) => {
            const downIfaces = d.down_interfaces?.doc_count || 0;
            const totalIfaces = d.total_interfaces?.value || 0;
            const lastSeen = d.last_seen?.value_as_string || '';
            const msSince = lastSeen ? Date.now() - new Date(lastSeen).getTime() : Infinity;

            if (msSince > DEVICE_DOWN_THRESHOLD_MS) downCount++;
            else if (totalIfaces > 0 && downIfaces === totalIfaces) degradedCount++;
            else upCount++;
          });

          let worstStatus = 'up';
          if (downCount > 0) worstStatus = 'down';
          else if (degradedCount > 0) worstStatus = 'degraded';

          return {
            site: bucket.key,
            deviceCount: bucket.device_count?.value || 0,
            upCount,
            downCount,
            degradedCount,
            worstStatus,
            topIssues: [],
          };
        });

        const discoveredCount = (result.aggregations?.discovered_ips as any)?.value ?? 0;

        return response.ok({
          body: {
            sites,
            totalDevices: sites.reduce((sum: number, s: any) => sum + s.deviceCount, 0),
            discoveredCount,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err) {
        logger.error(`Sites route error: ${err}`);
        return response.customError({
          statusCode: 500,
          body: { message: `Failed to fetch sites: ${err}` },
        });
      }
    }
  );
}
