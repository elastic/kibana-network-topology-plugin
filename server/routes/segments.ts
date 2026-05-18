/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/* eslint-disable no-bitwise */

import type { IRouter, Logger } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import { API_ROUTES, DEFAULT_SNMP_INDEX, DEVICE_DOWN_THRESHOLD_MS } from '../../common';
import { delegateAuthzToElasticsearch } from './route_security';

export function registerSegmentsRoutes(router: IRouter, logger: Logger) {
  router.get(
    {
      path: API_ROUTES.SEGMENTS,
      ...delegateAuthzToElasticsearch,
      validate: {
        query: schema.object({
          from: schema.string({ defaultValue: 'now-15m' }),
          to: schema.string({ defaultValue: 'now' }),
          site: schema.maybe(schema.string()),
          index: schema.string({ defaultValue: DEFAULT_SNMP_INDEX }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { from, to, site, index } = request.query;
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const baseFilters: any[] = [{ range: { '@timestamp': { gte: from, lte: to } } }];
        if (site) baseFilters.push({ term: { 'network.site': site } });

        // ── Step 1: discover unique CIDRs from ipAddrTable data ──────────────
        // ip_addr.network is keyword per the index template; no .keyword suffix needed.
        const networksResult = await esClient.search({
          index,
          size: 0,
          query: { bool: { filter: [...baseFilters, { exists: { field: 'ip_addr.network' } }] } },
          aggs: {
            networks: { terms: { field: 'ip_addr.network', size: 5000 } },
          },
        });

        const cidrs: string[] = ((networksResult.aggregations?.networks as any)?.buckets ?? []).map(
          (b: any) => b.key as string
        );

        if (cidrs.length === 0) {
          return response.ok({
            body: { segments: [], totalDevices: 0, timestamp: new Date().toISOString() },
          });
        }

        // ── Step 2: device names per CIDR via ip_addr.address ────────────────
        // ip_addr.address is ip-type; native CIDR term queries work here.
        // This correctly identifies which devices have an interface on each subnet,
        // as opposed to host.ip which is only the management/polling address.
        const ipAddrFilters: Record<string, any> = {};
        for (const cidr of cidrs) {
          ipAddrFilters[cidr] = { term: { 'ip_addr.address': cidr } };
        }

        const ipAddrResult = await esClient.search({
          index,
          size: 0,
          query: { bool: { filter: [...baseFilters, { exists: { field: 'ip_addr.address' } }] } },
          aggs: {
            by_segment: {
              filters: { filters: ipAddrFilters },
              aggs: {
                device_names: { terms: { field: 'host.name', size: 1000 } },
              },
            },
          },
        });

        // cidr → Set<hostname>
        const cidrToDevices = new Map<string, Set<string>>();
        const allDeviceNames = new Set<string>();
        const ipAddrBuckets = (ipAddrResult.aggregations?.by_segment as any)?.buckets ?? {};
        for (const cidr of cidrs) {
          const names: Set<string> = new Set(
            (ipAddrBuckets[cidr]?.device_names?.buckets ?? []).map((b: any) => b.key as string)
          );
          cidrToDevices.set(cidr, names);
          for (const n of names) allDeviceNames.add(n);
        }

        // ── Step 3: device health for all discovered device names ─────────────
        const deviceHealthMap = new Map<
          string,
          { up: boolean; down: boolean; degraded: boolean }
        >();

        if (allDeviceNames.size > 0) {
          const healthResult = await esClient.search({
            index,
            size: 0,
            query: {
              bool: { filter: [...baseFilters, { terms: { 'host.name': [...allDeviceNames] } }] },
            },
            aggs: {
              devices: {
                terms: { field: 'host.name', size: 5000 },
                aggs: {
                  last_seen: { max: { field: '@timestamp' } },
                  down_ifaces: { filter: { term: { 'interface.status.oper': 'down' } } },
                  total_ifaces: { cardinality: { field: 'interface.name' } },
                },
              },
            },
          });

          for (const b of (healthResult.aggregations?.devices as any)?.buckets ?? []) {
            const lastSeen: string = b.last_seen?.value_as_string || '';
            const msSince = lastSeen ? Date.now() - new Date(lastSeen).getTime() : Infinity;
            const nDown: number = b.down_ifaces?.doc_count || 0;
            const nTotal: number = b.total_ifaces?.value || 0;

            let st = 'up';
            if (msSince > DEVICE_DOWN_THRESHOLD_MS) st = 'down';
            else if (nTotal > 0 && nDown === nTotal) st = 'degraded';

            deviceHealthMap.set(b.key, {
              up: st === 'up',
              down: st === 'down',
              degraded: st === 'degraded',
            });
          }
        }

        // ── Step 4: ARP-discovered IP count per segment ───────────────────────
        // arp.ip_addr is ip-type; native CIDR term queries work here.
        const arpFilters: Record<string, any> = {};
        for (const cidr of cidrs) {
          arpFilters[cidr] = { term: { 'arp.ip_addr': cidr } };
        }

        const arpResult = await esClient.search({
          index,
          size: 0,
          query: { bool: { filter: [...baseFilters, { exists: { field: 'arp.ip_addr' } }] } },
          aggs: {
            by_segment: {
              filters: { filters: arpFilters },
              aggs: {
                arp_ips: { cardinality: { field: 'arp.ip_addr' } },
              },
            },
          },
        });

        const arpBuckets = (arpResult.aggregations?.by_segment as any)?.buckets ?? {};

        // ── Assemble segment health ────────────────────────────────────────────
        const segments = cidrs
          .map((cidr) => {
            const deviceNames = cidrToDevices.get(cidr) ?? new Set<string>();
            let deviceCount = 0;
            let upCount = 0;
            let downCount = 0;
            let degradedCount = 0;

            for (const name of deviceNames) {
              const h = deviceHealthMap.get(name);
              if (!h) continue; // no health data — device not seen in time range
              deviceCount++;
              if (h.up) upCount++;
              else if (h.down) downCount++;
              else degradedCount++;
            }

            const discoveredCount: number = arpBuckets[cidr]?.arp_ips?.value ?? 0;

            // Skip completely empty segments (no polled devices, no ARP IPs)
            if (deviceCount === 0 && discoveredCount === 0) return null;

            return {
              segment: cidr,
              deviceCount,
              upCount,
              downCount,
              degradedCount,
              discoveredCount,
              worstStatus: downCount > 0 ? 'down' : degradedCount > 0 ? 'degraded' : 'up',
            };
          })
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .sort((a, b) => {
            const key = (c: string) => {
              const p = c.split('/')[0].split('.').map(Number);
              return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
            };
            return key(a.segment) - key(b.segment);
          });

        return response.ok({
          body: {
            segments,
            totalDevices: segments.reduce((s, seg) => s + seg.deviceCount, 0),
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err) {
        logger.error(`Segments route error: ${err}`);
        return response.customError({
          statusCode: 500,
          body: { message: `Failed to fetch segments: ${err}` },
        });
      }
    }
  );
}
