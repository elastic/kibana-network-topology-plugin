/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IRouter, Logger } from '@kbn/core/server';
import { API_ROUTES, DEFAULT_SNMP_INDEX } from '../../common';
import { delegateAuthzToElasticsearch } from './route_security';

export function registerSetupRoutes(router: IRouter, logger: Logger) {
  router.get(
    {
      path: API_ROUTES.SETUP_HEALTH,
      ...delegateAuthzToElasticsearch,
      validate: false,
    },
    async (context, _request, response) => {
      try {
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const [templateResult, pipelineResult, dataResult, coverageResult] =
          await Promise.allSettled([
            // 1. Index template
            esClient.indices.existsIndexTemplate({ name: 'logs-snmp.topology@template' }),

            // 2. Ingest pipeline
            esClient.ingest.getPipeline({ id: 'snmp-device-enrichment' }),

            // 3. Recent data — device & site counts
            esClient.search({
              index: DEFAULT_SNMP_INDEX,
              size: 0,
              ignore_unavailable: true,
              query: { bool: { filter: [{ range: { '@timestamp': { gte: 'now-1h' } } }] } },
              aggs: {
                devices: { cardinality: { field: 'host.name' } },
                sites: { cardinality: { field: 'network.site' } },
              },
            }),

            // 4. Field coverage — which document types are present
            esClient.search({
              index: DEFAULT_SNMP_INDEX,
              size: 0,
              ignore_unavailable: true,
              query: { bool: { filter: [{ range: { '@timestamp': { gte: 'now-1h' } } }] } },
              aggs: {
                has_interfaces: { filter: { exists: { field: 'interface.name' } } },
                has_arp: { filter: { exists: { field: 'arp.mac_addr' } } },
                has_mac_table: { filter: { exists: { field: 'mac_table.mac_addr' } } },
                has_ip_addr_table: { filter: { exists: { field: 'ip_addr.network' } } },
                has_bgp: { filter: { exists: { field: 'bgp_peer.remote_ip' } } },
                has_ospf: { filter: { exists: { field: 'ospf_neighbor.neighbor_ip' } } },
              },
            }),
          ]);

        const indexTemplate =
          templateResult.status === 'fulfilled' && templateResult.value === true;
        const ingestPipeline = pipelineResult.status === 'fulfilled';

        const deviceCount =
          dataResult.status === 'fulfilled'
            ? (dataResult.value.aggregations?.devices as any)?.value ?? 0
            : 0;
        const siteCount =
          dataResult.status === 'fulfilled'
            ? (dataResult.value.aggregations?.sites as any)?.value ?? 0
            : 0;

        const hasInterfaces =
          coverageResult.status === 'fulfilled'
            ? ((coverageResult.value.aggregations?.has_interfaces as any)?.doc_count ?? 0) > 0
            : false;
        const hasArp =
          coverageResult.status === 'fulfilled'
            ? ((coverageResult.value.aggregations?.has_arp as any)?.doc_count ?? 0) > 0
            : false;
        const hasMacTable =
          coverageResult.status === 'fulfilled'
            ? ((coverageResult.value.aggregations?.has_mac_table as any)?.doc_count ?? 0) > 0
            : false;
        const hasIpAddrTable =
          coverageResult.status === 'fulfilled'
            ? ((coverageResult.value.aggregations?.has_ip_addr_table as any)?.doc_count ?? 0) > 0
            : false;
        const hasBgpPeers =
          coverageResult.status === 'fulfilled'
            ? ((coverageResult.value.aggregations?.has_bgp as any)?.doc_count ?? 0) > 0
            : false;
        const hasOspfNeighbors =
          coverageResult.status === 'fulfilled'
            ? ((coverageResult.value.aggregations?.has_ospf as any)?.doc_count ?? 0) > 0
            : false;

        return response.ok({
          body: {
            indexTemplate: { installed: indexTemplate },
            ingestPipeline: { installed: ingestPipeline },
            recentData: { hasData: deviceCount > 0, deviceCount, siteCount },
            fieldCoverage: {
              interfaces: hasInterfaces,
              arpTable: hasArp,
              macTable: hasMacTable,
              ipAddrTable: hasIpAddrTable,
              bgpPeers: hasBgpPeers,
              ospfNeighbors: hasOspfNeighbors,
            },
          },
        });
      } catch (err) {
        logger.error(`Setup health error: ${err}`);
        return response.customError({
          statusCode: 500,
          body: { message: `Setup health check failed: ${err}` },
        });
      }
    }
  );
}
