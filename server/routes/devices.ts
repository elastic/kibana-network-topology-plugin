import type { IRouter, Logger } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import { API_ROUTES, DEFAULT_SNMP_INDEX } from '../../common';

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
          search: schema.maybe(schema.string()),
          from: schema.string({ defaultValue: 'now-15m' }),
          to: schema.string({ defaultValue: 'now' }),
          index: schema.string({ defaultValue: DEFAULT_SNMP_INDEX }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { site, page, pageSize, sortOrder, search, from, to, index } = request.query;
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const filters: any[] = [{ range: { '@timestamp': { gte: from, lte: to } } }];
        if (site) filters.push({ term: { 'network.site': site } });
        if (search) {
          const isValidIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(search);
          const shouldClauses: any[] = [
            {
              query_string: {
                query: `*${search}*`,
                fields: [
                  'host.name', 'host.mac', 'host.type',
                  'observer.vendor', 'observer.os.full',
                  'network.site', 'network.building', 'network.role',
                ],
              },
            },
          ];
          if (isValidIp) shouldClauses.push({ term: { 'host.ip': search } });
          filters.push({ bool: { should: shouldClauses, minimum_should_match: 1 } });
        }

        const result = await esClient.search({
          index,
          size: 0,
          query: { bool: { filter: filters } },
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
          let status = 'up';
          if (downCount > ifCount * 0.5) status = 'down';
          else if (downCount > 0) status = 'degraded';

          return {
            id: b.key, name: b.key,
            ip: src.host?.ip || '', type: src.host?.type || 'unknown',
            vendor: src.observer?.vendor || '', os: src.observer?.os?.full || '',
            status, site: src.network?.site || 'Ungrouped',
            building: src.network?.building || '', role: src.network?.role || '',
            interfaceCount: ifCount, downInterfaceCount: downCount,
            lastSeen: b.last_seen?.value_as_string || '',
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
          },
        });

        const hit = (result.aggregations?.device_info as any)?.hits?.hits?.[0]?._source || {};
        const ifBuckets = (result.aggregations?.interfaces as any)?.buckets || [];
        const arpBuckets = (result.aggregations?.arp_neighbors as any)?.buckets || [];

        const interfaces = ifBuckets.map((b: any) => ({
          name: b.key, id: b.key,
          speed: b.speed?.value || 0,
          adminStatus: b.admin_status?.buckets?.[0]?.key || 'unknown',
          operStatus: b.status?.buckets?.[0]?.key || 'unknown',
          trafficIn: b.traffic_in?.value || 0, trafficOut: b.traffic_out?.value || 0,
          errorsIn: b.errors_in?.value || 0, errorsOut: b.errors_out?.value || 0,
        }));

        const downCount = interfaces.filter((i: any) => i.operStatus === 'down').length;
        let status = 'up';
        if (downCount > interfaces.length * 0.5) status = 'down';
        else if (downCount > 0) status = 'degraded';

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
              lastSeen: new Date().toISOString(),
            },
            interfaces,
            neighbors: arpBuckets.map((b: any) => ({
              ip: b.key, mac: b.mac?.buckets?.[0]?.key || '',
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
