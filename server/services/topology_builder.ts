import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { TopologyGraph, TopologyNode, TopologyLink, DeviceType, DeviceStatus, NetworkRole } from '../../common';

interface BuildOptions {
  index: string;
  from: string;
  to: string;
  site?: string;
  building?: string;
  role?: string;
  logger: Logger;
}

export async function buildTopologyFromArpMac(
  esClient: ElasticsearchClient,
  options: BuildOptions
): Promise<TopologyGraph> {
  const { index, from, to, site, building, role, logger } = options;

  const filters: any[] = [{ range: { '@timestamp': { gte: from, lte: to } } }];
  if (site) filters.push({ term: { 'network.site': site } });
  if (building) filters.push({ term: { 'network.building': building } });
  if (role) filters.push({ term: { 'network.role': role } });

  // Step 1: Get all devices
  const devicesResult = await esClient.search({
    index, size: 0,
    query: { bool: { filter: filters } },
    aggs: {
      devices: {
        terms: { field: 'host.name', size: 5000 },
        aggs: {
          info: {
            top_hits: {
              size: 1, sort: [{ '@timestamp': 'desc' }],
              _source: ['host.name', 'host.ip', 'host.mac', 'host.type',
                        'observer.vendor', 'network.site', 'network.building', 'network.role'],
            },
          },
          down_ifaces: { filter: { term: { 'interface.status.oper': 'down' } } },
          total_ifaces: { cardinality: { field: 'interface.name' } },
        },
      },
    },
  });

  const deviceBuckets = (devicesResult.aggregations?.devices as any)?.buckets || [];
  const deviceMap = new Map<string, { ip: string; mac: string; type: DeviceType; status: DeviceStatus }>();
  const ipToDevice = new Map<string, string>();
  const macToDevice = new Map<string, string>();
  const nodes: TopologyNode[] = [];

  for (const bucket of deviceBuckets) {
    const src = bucket.info?.hits?.hits?.[0]?._source || {};
    const hostname = bucket.key as string;
    const ip = src.host?.ip || '';
    const mac = (src.host?.mac || '').toLowerCase();
    const type = (src.host?.type as DeviceType) || 'unknown';
    const downCount = bucket.down_ifaces?.doc_count || 0;
    const totalCount = bucket.total_ifaces?.value || 0;

    let status: DeviceStatus = 'up';
    if (totalCount > 0 && downCount > totalCount * 0.5) status = 'down';
    else if (downCount > 0) status = 'degraded';

    deviceMap.set(hostname, { ip, mac, type, status });
    if (ip) ipToDevice.set(ip, hostname);
    if (mac) macToDevice.set(mac, hostname);
    const role = (src.network?.role as NetworkRole) || undefined;
    nodes.push({ id: hostname, label: hostname, ip, type, status, site: src.network?.site, role });
  }

  // Step 2: ARP tables
  const arpResult = await esClient.search({
    index, size: 0,
    query: { bool: { filter: [...filters, { exists: { field: 'arp.mac_addr' } }] } },
    aggs: {
      by_device: {
        terms: { field: 'host.name', size: 5000 },
        aggs: {
          arp_entries: {
            terms: { field: 'arp.mac_addr', size: 10000 },
            aggs: { ip: { terms: { field: 'arp.ip_addr', size: 1 } } },
          },
        },
      },
    },
  });

  // Step 3: MAC/bridge forwarding tables
  const macTableResult = await esClient.search({
    index, size: 0,
    query: { bool: { filter: [...filters, { exists: { field: 'mac_table.mac_addr' } }] } },
    aggs: {
      by_device: {
        terms: { field: 'host.name', size: 5000 },
        aggs: {
          by_port: {
            terms: { field: 'mac_table.port_index', size: 500 },
            aggs: {
              macs: { terms: { field: 'mac_table.mac_addr', size: 10000 } },
              mac_count: { cardinality: { field: 'mac_table.mac_addr' } },
            },
          },
        },
      },
    },
  });

  // Step 4: Infer adjacency
  const links: TopologyLink[] = [];
  const linkSet = new Set<string>();

  function addLink(src: string, tgt: string, srcPort: string, tgtPort: string, method: 'arp' | 'mac') {
    if (src === tgt) return;
    const key = [src, tgt].sort().join('||');
    if (linkSet.has(key)) return;
    linkSet.add(key);

    const srcDev = deviceMap.get(src);
    const tgtDev = deviceMap.get(tgt);
    let status: 'up' | 'down' | 'degraded' = 'up';
    if (srcDev?.status === 'down' || tgtDev?.status === 'down') status = 'down';
    else if (srcDev?.status === 'degraded' || tgtDev?.status === 'degraded') status = 'degraded';

    links.push({ id: key, source: src, target: tgt, sourcePort: srcPort, targetPort: tgtPort, status, method });
  }

  // ARP-based adjacency
  const arpBuckets = (arpResult.aggregations?.by_device as any)?.buckets || [];
  for (const devBucket of arpBuckets) {
    const deviceName = devBucket.key;
    for (const arpEntry of (devBucket.arp_entries?.buckets || [])) {
      const mac = (arpEntry.key as string).toLowerCase();
      const ip = arpEntry.ip?.buckets?.[0]?.key || '';
      let neighbor = macToDevice.get(mac);
      if (!neighbor && ip) neighbor = ipToDevice.get(ip);
      if (neighbor && neighbor !== deviceName && deviceMap.has(neighbor)) {
        addLink(deviceName, neighbor, '', '', 'arp');
      }
    }
  }

  // MAC table adjacency
  const macBuckets = (macTableResult.aggregations?.by_device as any)?.buckets || [];
  for (const devBucket of macBuckets) {
    const switchName = devBucket.key;
    for (const portBucket of (devBucket.by_port?.buckets || [])) {
      const portIndex = portBucket.key;
      const macCount = portBucket.mac_count?.value || 0;
      const macs = portBucket.macs?.buckets || [];

      if (macCount <= 3) {
        for (const macEntry of macs) {
          const mac = (macEntry.key as string).toLowerCase();
          const neighbor = macToDevice.get(mac);
          if (neighbor && neighbor !== switchName && deviceMap.has(neighbor)) {
            addLink(switchName, neighbor, `port-${portIndex}`, '', 'mac');
          }
        }
      } else {
        for (const macEntry of macs) {
          const mac = (macEntry.key as string).toLowerCase();
          const neighbor = macToDevice.get(mac);
          if (neighbor && neighbor !== switchName && deviceMap.has(neighbor)) {
            const nDev = deviceMap.get(neighbor)!;
            if (nDev.type === 'switch' || nDev.type === 'router') {
              addLink(switchName, neighbor, `port-${portIndex}`, '', 'mac');
              break;
            }
          }
        }
      }
    }
  }

  logger.info(`Topology built: ${nodes.length} nodes, ${links.length} links (site=${site || 'all'})`);
  return { nodes, links, discoveredAt: new Date().toISOString(), method: 'arp-mac' };
}
