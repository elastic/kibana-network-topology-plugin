/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/* eslint-disable no-bitwise */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type {
  TopologyGraph,
  TopologyNode,
  TopologyLink,
  DeviceType,
  DeviceStatus,
  NetworkRole,
} from '../../common';
import { DEVICE_DOWN_THRESHOLD_MS } from '../../common';

/** Returns true if the dotted-decimal ip falls within the cidr block. */
function ipInCidr(ip: string, cidr: string): boolean {
  const [addr, prefixStr] = cidr.split('/');
  const bits = parseInt(prefixStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;
  const toNum = (s: string) =>
    s.split('.').reduce((acc, o) => (acc << 8) | parseInt(o, 10), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toNum(ip) & mask) === (toNum(addr) & mask);
}

interface BuildOptions {
  index: string;
  from: string;
  to: string;
  site?: string;
  building?: string;
  role?: string;
  /** CIDR notation filter, e.g. "192.168.1.0/24" — includes devices with any interface IP in this range */
  cidr?: string;
  logger: Logger;
}

export async function buildTopologyFromArpMac(
  esClient: ElasticsearchClient,
  options: BuildOptions
): Promise<TopologyGraph> {
  const { index, from, to, site, building, role, cidr, logger } = options;

  const filters: any[] = [{ range: { '@timestamp': { gte: from, lte: to } } }];
  if (site) filters.push({ term: { 'network.site': site } });
  if (building) filters.push({ term: { 'network.building': building } });
  if (role) filters.push({ term: { 'network.role': role } });

  // CIDR filter: use ip_addr.address (interface IPs) to find devices on the subnet,
  // since host.ip is always the management/polling address and may be on a different VLAN.
  // Pre-query ipAddrTable docs to get device names, then restrict all main queries by name.
  if (cidr) {
    const ipAddrResult = await esClient.search({
      index,
      size: 0,
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: from, lte: to } } },
            { term: { 'ip_addr.address': cidr } },
          ],
        },
      },
      aggs: { device_names: { terms: { field: 'host.name', size: 5000 } } },
    });

    const names: string[] = ((ipAddrResult.aggregations?.device_names as any)?.buckets ?? []).map(
      (b: any) => b.key as string
    );

    if (names.length === 0) {
      // No ipAddrTable data — fall back to management IP match
      filters.push({ term: { 'host.ip': cidr } });
    } else {
      filters.push({ terms: { 'host.name': names } });
    }
  }

  // Step 1: Get all polled devices
  const devicesResult = await esClient.search({
    index,
    size: 0,
    query: { bool: { filter: filters } },
    aggs: {
      devices: {
        terms: { field: 'host.name', size: 5000 },
        aggs: {
          info: {
            top_hits: {
              size: 1,
              sort: [{ '@timestamp': 'desc' }],
              _source: [
                '@timestamp',
                'host.name',
                'host.ip',
                'host.mac',
                'host.type',
                'observer.vendor',
                'network.site',
                'network.building',
                'network.role',
              ],
            },
          },
          down_ifaces: { filter: { term: { 'interface.status.oper': 'down' } } },
          total_ifaces: { cardinality: { field: 'interface.name' } },
        },
      },
    },
  });

  const deviceBuckets = (devicesResult.aggregations?.devices as any)?.buckets || [];
  const deviceMap = new Map<
    string,
    { ip: string; mac: string; type: DeviceType; status: DeviceStatus }
  >();
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

    // Time-based status: down if no data in last DEVICE_DOWN_THRESHOLD_MS.
    // Degraded if reporting but all interfaces are operationally down.
    // Note: downCount is a doc_count approximation, not cardinality.
    const lastSeenTs = src['@timestamp'] as string | undefined;
    const msSince = lastSeenTs ? Date.now() - new Date(lastSeenTs).getTime() : Infinity;
    let status: DeviceStatus = 'up';
    if (msSince > DEVICE_DOWN_THRESHOLD_MS) status = 'down';
    else if (totalCount > 0 && downCount === totalCount) status = 'degraded';

    deviceMap.set(hostname, { ip, mac, type, status });
    if (ip) ipToDevice.set(ip, hostname);
    if (mac) macToDevice.set(mac, hostname);
    const nodeRole = (src.network?.role as NetworkRole) || undefined;
    nodes.push({
      id: hostname,
      label: hostname,
      ip,
      type,
      status,
      site: src.network?.site,
      role: nodeRole,
    });
  }

  // Step 2: ARP tables
  const arpResult = await esClient.search({
    index,
    size: 0,
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
    index,
    size: 0,
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

  function addLink(
    src: string,
    tgt: string,
    srcPort: string,
    tgtPort: string,
    method: 'arp' | 'mac' | 'bgp' | 'ospf'
  ) {
    if (src === tgt) return;
    // BGP/OSPF links coexist with ARP/MAC links (logical overlay vs physical adjacency)
    const key =
      [src, tgt].sort().join('||') + (method === 'bgp' || method === 'ospf' ? `||${method}` : '');
    if (linkSet.has(key)) return;
    linkSet.add(key);

    const srcDev = deviceMap.get(src);
    const tgtDev = deviceMap.get(tgt);
    let status: 'up' | 'down' | 'degraded' = 'up';
    if (srcDev?.status === 'down' || tgtDev?.status === 'down') status = 'down';
    else if (srcDev?.status === 'degraded' || tgtDev?.status === 'degraded') status = 'degraded';

    links.push({
      id: key,
      source: src,
      target: tgt,
      sourcePort: srcPort,
      targetPort: tgtPort,
      status,
      method,
    });
  }

  const arpBuckets = (arpResult.aggregations?.by_device as any)?.buckets || [];

  // ARP Pass 1: create unmanaged nodes for neighbors not in the polled device set.
  // These nodes are added to the lookup maps so Pass 2 can build links to them naturally.
  // The MAC table adjacency loop below also benefits from this automatically.
  const discoveredIds = new Set<string>();
  for (const devBucket of arpBuckets) {
    for (const arpEntry of devBucket.arp_entries?.buckets || []) {
      const mac = (arpEntry.key as string).toLowerCase();
      const ip = arpEntry.ip?.buckets?.[0]?.key || '';
      if (!mac && !ip) continue;
      if (!macToDevice.has(mac) && (!ip || !ipToDevice.has(ip))) {
        // In a segment view, skip unmanaged nodes whose IP is outside the selected CIDR.
        if (cidr && ip && !ipInCidr(ip, cidr)) continue;
        const nodeId = ip || mac;
        if (discoveredIds.has(nodeId)) continue;
        discoveredIds.add(nodeId);
        nodes.push({
          id: nodeId,
          label: nodeId,
          ip,
          type: 'unknown',
          status: 'unknown',
          managed: false,
        });
        deviceMap.set(nodeId, { ip, mac, type: 'unknown', status: 'unknown' });
        if (ip) ipToDevice.set(ip, nodeId);
        if (mac) macToDevice.set(mac, nodeId);
      }
    }
  }

  // ARP Pass 2: build links (now resolves both managed and discovered neighbors)
  for (const devBucket of arpBuckets) {
    const deviceName = devBucket.key;
    for (const arpEntry of devBucket.arp_entries?.buckets || []) {
      const mac = (arpEntry.key as string).toLowerCase();
      const ip = arpEntry.ip?.buckets?.[0]?.key || '';
      let neighbor = macToDevice.get(mac);
      if (!neighbor && ip) neighbor = ipToDevice.get(ip);
      if (neighbor && neighbor !== deviceName && deviceMap.has(neighbor)) {
        addLink(deviceName, neighbor, '', '', 'arp');
      }
    }
  }

  // MAC table adjacency (also picks up discovered nodes via macToDevice automatically)
  const macBuckets = (macTableResult.aggregations?.by_device as any)?.buckets || [];
  for (const devBucket of macBuckets) {
    const switchName = devBucket.key;
    for (const portBucket of devBucket.by_port?.buckets || []) {
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

  // Step 5: BGP peer sessions — create links between BGP neighbors
  const bgpResult = await esClient.search({
    index,
    size: 0,
    query: { bool: { filter: [...filters, { exists: { field: 'bgp_peer.remote_ip' } }] } },
    aggs: {
      by_device: {
        terms: { field: 'host.name', size: 5000 },
        aggs: {
          peers: {
            terms: { field: 'bgp_peer.remote_ip', size: 500 },
            aggs: {
              state: { terms: { field: 'bgp_peer.peer_state', size: 1 } },
              remote_asn: { terms: { field: 'bgp_peer.remote_asn', size: 1 } },
            },
          },
        },
      },
    },
  });

  const bgpBuckets = (bgpResult.aggregations?.by_device as any)?.buckets || [];
  for (const devBucket of bgpBuckets) {
    const deviceName = devBucket.key;
    for (const peerBucket of devBucket.peers?.buckets || []) {
      const remoteIp = peerBucket.key as string;
      const peerState = peerBucket.state?.buckets?.[0]?.key || 'Idle';
      const remoteAsn = peerBucket.remote_asn?.buckets?.[0]?.key;
      let neighbor = ipToDevice.get(remoteIp);
      // If this IP is already an ARP-discovered unmanaged node and we have an ASN,
      // upgrade its label — the raw IP is a fallback only.
      if (neighbor && remoteAsn) {
        const existingNode = nodes.find((n) => n.id === neighbor);
        if (
          existingNode &&
          existingNode.managed === false &&
          !existingNode.label.startsWith('AS')
        ) {
          existingNode.label = `AS ${remoteAsn}`;
        }
      }
      if (!neighbor) {
        // External BGP peer — create an unmanaged node labeled with the ASN
        const nodeId = `AS${remoteAsn || '?'}-${remoteIp}`;
        if (!discoveredIds.has(nodeId)) {
          discoveredIds.add(nodeId);
          const label = remoteAsn ? `AS ${remoteAsn}` : remoteIp;
          nodes.push({
            id: nodeId,
            label,
            ip: remoteIp,
            type: 'unknown',
            status: 'unknown',
            managed: false,
          });
          deviceMap.set(nodeId, { ip: remoteIp, mac: '', type: 'unknown', status: 'unknown' });
          ipToDevice.set(remoteIp, nodeId);
        }
        neighbor = ipToDevice.get(remoteIp);
      }
      if (neighbor && neighbor !== deviceName && deviceMap.has(neighbor)) {
        // Override link status based on BGP peer state, not device status
        const bgpKey = [deviceName, neighbor].sort().join('||') + '||bgp';
        if (!linkSet.has(bgpKey)) {
          linkSet.add(bgpKey);
          const bgpStatus: 'up' | 'down' | 'degraded' = peerState === 'Established' ? 'up' : 'down';
          links.push({
            id: bgpKey,
            source: deviceName,
            target: neighbor,
            sourcePort: '',
            targetPort: '',
            status: bgpStatus,
            method: 'bgp',
          });
        }
      }
    }
  }

  // Step 6: OSPF neighbor adjacencies — create links between OSPF neighbors
  const ospfResult = await esClient.search({
    index,
    size: 0,
    query: { bool: { filter: [...filters, { exists: { field: 'ospf_neighbor.neighbor_ip' } }] } },
    aggs: {
      by_device: {
        terms: { field: 'host.name', size: 5000 },
        aggs: {
          neighbors: {
            terms: { field: 'ospf_neighbor.neighbor_ip', size: 500 },
            aggs: {
              state: { terms: { field: 'ospf_neighbor.state', size: 1 } },
            },
          },
        },
      },
    },
  });

  const ospfBuckets = (ospfResult.aggregations?.by_device as any)?.buckets || [];
  for (const devBucket of ospfBuckets) {
    const deviceName = devBucket.key;
    for (const nbrBucket of devBucket.neighbors?.buckets || []) {
      const neighborIp = nbrBucket.key as string;
      const nbrState = nbrBucket.state?.buckets?.[0]?.key || 'Down';
      const neighbor = ipToDevice.get(neighborIp);
      if (neighbor && neighbor !== deviceName && deviceMap.has(neighbor)) {
        const ospfKey = [deviceName, neighbor].sort().join('||') + '||ospf';
        if (!linkSet.has(ospfKey)) {
          linkSet.add(ospfKey);
          const ospfStatus: 'up' | 'down' | 'degraded' =
            nbrState === 'Full' || nbrState === '2-Way' ? 'up' : 'down';
          links.push({
            id: ospfKey,
            source: deviceName,
            target: neighbor,
            sourcePort: '',
            targetPort: '',
            status: ospfStatus,
            method: 'ospf',
          });
        }
      }
    }
  }

  const managedCount = nodes.filter((n) => n.managed !== false).length;
  const discoveredCount = nodes.length - managedCount;
  logger.info(
    `Topology built: ${managedCount} managed + ${discoveredCount} discovered nodes, ${
      links.length
    } links (site=${site || 'all'})`
  );
  return { nodes, links, discoveredAt: new Date().toISOString(), method: 'arp-mac' };
}
