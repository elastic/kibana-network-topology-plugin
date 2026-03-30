import type { IRouter, Logger } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import { buildEsQuery, type Filter, type Query } from '@kbn/es-query';
import { API_ROUTES, DEFAULT_SNMP_INDEX, DEVICE_DOWN_THRESHOLD_MS } from '../../common';

export function registerDevicesRoutes(router: IRouter, logger: Logger) {
  // GET /api/network_topology/devices
  router.get(
    {
      path: API_ROUTES.DEVICES,
      validate: {
        query: schema.object({
          site: schema.maybe(schema.string()),
          page: schema.number({ defaultValue: 0 }),
          pageSize: schema.number({ defaultValue: 50 }),
          sortField: schema.string({ defaultValue: 'host.name' }),
          sortOrder: schema.string({ defaultValue: 'asc' }),
          kql: schema.maybe(schema.string()),
          filters: schema.maybe(schema.string()),
          from: schema.string({ defaultValue: 'now-15m' }),
          to: schema.string({ defaultValue: 'now' }),
          index: schema.string({ defaultValue: DEFAULT_SNMP_INDEX }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { site, page, pageSize, sortOrder, kql, filters: filtersParam, from, to, index } = request.query;
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const esFilters: any[] = [{ range: { '@timestamp': { gte: from, lte: to } } }];
        if (site) esFilters.push({ term: { 'network.site': site } });

        if (kql || filtersParam) {
          const queries: Query[] = kql ? [{ language: 'kuery', query: kql }] : [];
          const parsedFilters: Filter[] = [];
          if (filtersParam) {
            try {
              const parsed = JSON.parse(filtersParam);
              if (Array.isArray(parsed)) parsedFilters.push(...parsed);
            } catch {
              // ignore malformed filters
            }
          }
          try {
            const esQuery = buildEsQuery(undefined, queries, parsedFilters, {
              allowLeadingWildcards: true,
            });
            esFilters.push(esQuery);
          } catch (kqlErr) {
            return response.badRequest({ body: { message: `Invalid KQL: ${kqlErr}` } });
          }
        }

        const result = await esClient.search({
          index,
          size: 0,
          query: { bool: { filter: esFilters } },
          aggs: {
            total_devices: { cardinality: { field: 'host.name' } },
            devices: {
              terms: {
                field: 'host.name',
                size: 10000,
                order: { _key: sortOrder as 'asc' | 'desc' },
              },
              aggs: {
                latest: {
                  top_hits: {
                    size: 1,
                    sort: [{ '@timestamp': 'desc' }],
                    _source: [
                      'host.name', 'host.ip', 'host.type',
                      'observer.vendor', 'observer.os.full',
                      'network.site', 'network.building', 'network.role',
                    ],
                  },
                },
                interface_count: { cardinality: { field: 'interface.name' } },
                down_interfaces: {
                  filter: { term: { 'interface.status.oper': 'down' } },
                  aggs: { count: { cardinality: { field: 'interface.name' } } },
                },
                last_seen: { max: { field: '@timestamp' } },
              },
            },
          },
        });

        const buckets = (result.aggregations?.devices as any)?.buckets || [];
        const total = (result.aggregations?.total_devices as any)?.value || 0;
        const start = page * pageSize;
        const paginated = buckets.slice(start, start + pageSize);

        const devices = paginated.map((b: any) => {
          const src = b.latest?.hits?.hits?.[0]?._source || {};
          const downCount = b.down_interfaces?.count?.value || 0;
          const ifCount = b.interface_count?.value || 0;
          const lastSeen = b.last_seen?.value_as_string || '';
          const msSince = lastSeen ? Date.now() - new Date(lastSeen).getTime() : Infinity;
          let status = 'up';
          if (msSince > DEVICE_DOWN_THRESHOLD_MS) status = 'down';
          else if (ifCount > 0 && downCount === ifCount) status = 'degraded';

          return {
            id: b.key, name: b.key,
            ip: src.host?.ip || '', type: src.host?.type || 'unknown',
            vendor: src.observer?.vendor || '', os: src.observer?.os?.full || '',
            status, site: src.network?.site || 'Ungrouped',
            building: src.network?.building || '', role: src.network?.role || '',
            interfaceCount: ifCount, downInterfaceCount: downCount,
            lastSeen,
          };
        });

        return response.ok({ body: { devices, total, page, pageSize } });
      } catch (err) {
        logger.error(`Devices route error: ${err}`);
        return response.customError({
          statusCode: 500,
          body: { message: `Failed to fetch devices: ${err}` },
        });
      }
    }
  );

  // GET /api/network_topology/device/:id
  router.get(
    {
      path: `${API_ROUTES.DEVICE_DETAIL}/{id}`,
      validate: {
        params: schema.object({ id: schema.string() }),
        query: schema.object({
          from: schema.string({ defaultValue: 'now-1h' }),
          to: schema.string({ defaultValue: 'now' }),
          index: schema.string({ defaultValue: DEFAULT_SNMP_INDEX }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { id } = request.params;
        const { from, to, index } = request.query;
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const result = await esClient.search({
          index,
          size: 0,
          query: {
            bool: {
              filter: [
                { term: { 'host.name': id } },
                { range: { '@timestamp': { gte: from, lte: to } } },
              ],
            },
          },
          aggs: {
            device_info: {
              top_hits: {
                size: 1,
                sort: [{ '@timestamp': 'desc' }],
                _source: ['host.*', 'observer.*', 'network.*'],
              },
            },
            interfaces: {
              terms: { field: 'interface.name', size: 500 },
              aggs: {
                status: { terms: { field: 'interface.status.oper', size: 1 } },
                admin_status: { terms: { field: 'interface.status.admin', size: 1 } },
                speed: { max: { field: 'interface.speed' } },
                traffic_in: { max: { field: 'interface.traffic.in.bytes' } },
                traffic_out: { max: { field: 'interface.traffic.out.bytes' } },
                errors_in: { max: { field: 'interface.errors.in' } },
                errors_out: { max: { field: 'interface.errors.out' } },
              },
            },
            arp_neighbors: {
              terms: { field: 'arp.ip_addr', size: 500 },
              aggs: { mac: { terms: { field: 'arp.mac_addr', size: 1 } } },
            },
            bgp_sessions: {
              terms: { field: 'bgp_peer.remote_ip', size: 500 },
              aggs: {
                state:       { terms: { field: 'bgp_peer.peer_state', size: 1 } },
                remote_asn:  { terms: { field: 'bgp_peer.remote_asn', size: 1 } },
                local_asn:   { terms: { field: 'bgp_peer.local_asn', size: 1 } },
                prefixes_rx: { max: { field: 'bgp_peer.prefixes_received' } },
                prefixes_tx: { max: { field: 'bgp_peer.prefixes_sent' } },
                uptime:      { max: { field: 'bgp_peer.uptime_seconds' } },
                in_updates:  { max: { field: 'bgp_peer.in_updates' } },
                out_updates: { max: { field: 'bgp_peer.out_updates' } },
              },
            },
            ospf_neighbors: {
              terms: { field: 'ospf_neighbor.neighbor_ip', size: 500 },
              aggs: {
                state:     { terms: { field: 'ospf_neighbor.state', size: 1 } },
                router_id: { terms: { field: 'ospf_neighbor.router_id', size: 1 } },
                area_id:   { terms: { field: 'ospf_neighbor.area_id', size: 1 } },
                priority:  { max: { field: 'ospf_neighbor.priority' } },
                retrans:   { max: { field: 'ospf_neighbor.retrans_count' } },
              },
            },
            last_seen: { max: { field: '@timestamp' } },
          },
        });

        const hit = (result.aggregations?.device_info as any)?.hits?.hits?.[0]?._source || {};
        const ifBuckets = (result.aggregations?.interfaces as any)?.buckets || [];
        const arpBuckets = (result.aggregations?.arp_neighbors as any)?.buckets || [];
        const bgpBuckets = (result.aggregations?.bgp_sessions as any)?.buckets || [];
        const ospfBuckets = (result.aggregations?.ospf_neighbors as any)?.buckets || [];
        const lastSeen = (result.aggregations?.last_seen as any)?.value_as_string || '';

        const interfaces = ifBuckets.map((b: any) => ({
          name: b.key, id: b.key,
          speed: b.speed?.value || 0,
          adminStatus: b.admin_status?.buckets?.[0]?.key || 'unknown',
          operStatus: b.status?.buckets?.[0]?.key || 'unknown',
          trafficIn: b.traffic_in?.value || 0, trafficOut: b.traffic_out?.value || 0,
          errorsIn: b.errors_in?.value || 0, errorsOut: b.errors_out?.value || 0,
        }));

        const downCount = interfaces.filter((i: any) => i.operStatus === 'down').length;
        const msSince = lastSeen ? Date.now() - new Date(lastSeen).getTime() : Infinity;
        let status = 'up';
        if (msSince > DEVICE_DOWN_THRESHOLD_MS) status = 'down';
        else if (interfaces.length > 0 && downCount === interfaces.length) status = 'degraded';

        return response.ok({
          body: {
            device: {
              id, name: id,
              ip: hit.host?.ip || '', mac: hit.host?.mac || '',
              type: hit.host?.type || 'unknown', vendor: hit.observer?.vendor || '',
              os: hit.observer?.os?.full || '', status,
              site: hit.network?.site || '', building: hit.network?.building || '',
              role: hit.network?.role || '',
              interfaceCount: interfaces.length, downInterfaceCount: downCount,
              lastSeen,
            },
            interfaces,
            neighbors: arpBuckets.map((b: any) => ({
              ip: b.key, mac: b.mac?.buckets?.[0]?.key || '',
            })),
            ospfNeighbors: ospfBuckets.map((b: any) => ({
              neighborIP: b.key,
              routerID: b.router_id?.buckets?.[0]?.key || '',
              state: b.state?.buckets?.[0]?.key || 'unknown',
              areaID: b.area_id?.buckets?.[0]?.key || '',
              priority: b.priority?.value || 0,
              retransCount: b.retrans?.value || 0,
            })),
            bgpPeers: bgpBuckets.map((b: any) => ({
              remoteIP: b.key,
              remoteASN: b.remote_asn?.buckets?.[0]?.key || 0,
              localASN: b.local_asn?.buckets?.[0]?.key || 0,
              state: b.state?.buckets?.[0]?.key || 'unknown',
              prefixesReceived: b.prefixes_rx?.value || 0,
              prefixesSent: b.prefixes_tx?.value || 0,
              uptimeSeconds: b.uptime?.value || 0,
              inUpdates: b.in_updates?.value || 0,
              outUpdates: b.out_updates?.value || 0,
            })),
            recentEvents: [],
          },
        });
      } catch (err) {
        logger.error(`Device detail error: ${err}`);
        return response.customError({
          statusCode: 500,
          body: { message: `Failed to fetch device detail: ${err}` },
        });
      }
    }
  );
}
