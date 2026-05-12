#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

const ES = process.argv[2] || 'http://localhost:9200';
const U = process.argv[3] || 'elastic';
const P = process.argv[4] || 'changeme';
const IDX = 'logs-snmp.topology-default';
const AUTH = Buffer.from(`${U}:${P}`).toString('base64');
const SITES = [
  {
    name: 'HQ-DC1',
    building: 'Main',
    subnet: '10.1',
    devices: [
      {
        name: 'hq-core-rtr-01',
        type: 'router',
        role: 'core',
        vendor: 'Cisco',
        descr: 'Cisco IOS XR Software, ASR 9000 Series Router',
      },
      {
        name: 'hq-core-rtr-02',
        type: 'router',
        role: 'core',
        vendor: 'Cisco',
        descr: 'Cisco IOS XR Software, ASR 9000 Series Router',
      },
      {
        name: 'hq-fw-01',
        type: 'firewall',
        role: 'core',
        vendor: 'Palo Alto',
        descr: 'Palo Alto Networks PA-5200 Series Firewall',
      },
      {
        name: 'hq-dist-sw-01',
        type: 'switch',
        role: 'distribution',
        vendor: 'Cisco',
        descr: 'Cisco NX-OS, Nexus 9000 Switch',
      },
      {
        name: 'hq-dist-sw-02',
        type: 'switch',
        role: 'distribution',
        vendor: 'Cisco',
        descr: 'Cisco NX-OS, Nexus 9000 Switch',
      },
      {
        name: 'hq-access-sw-01',
        type: 'switch',
        role: 'access',
        vendor: 'Cisco',
        descr: 'Cisco IOS Software, Catalyst 9200 Switch',
      },
      {
        name: 'hq-access-sw-02',
        type: 'switch',
        role: 'access',
        vendor: 'Cisco',
        descr: 'Cisco IOS Software, Catalyst 9200 Switch',
      },
      {
        name: 'hq-access-sw-03',
        type: 'switch',
        role: 'access',
        vendor: 'Cisco',
        descr: 'Cisco IOS Software, Catalyst 9200 Switch',
      },
      {
        name: 'hq-access-sw-04',
        type: 'switch',
        role: 'access',
        vendor: 'Arista',
        descr: 'Arista Networks EOS, DCS-7050 Switch',
      },
      {
        name: 'hq-srv-esxi-01',
        type: 'server',
        role: 'server',
        vendor: 'VMware',
        descr: 'VMware ESXi 8.0 Linux server',
      },
      {
        name: 'hq-srv-esxi-02',
        type: 'server',
        role: 'server',
        vendor: 'VMware',
        descr: 'VMware ESXi 8.0 Linux server',
      },
      {
        name: 'hq-srv-db-01',
        type: 'server',
        role: 'server',
        vendor: 'Dell',
        descr: 'Linux 5.15 Dell PowerEdge R750 server',
      },
      {
        name: 'hq-ap-01',
        type: 'ap',
        role: 'access',
        vendor: 'Aruba',
        descr: 'HPE Aruba AP-535 Access Point',
      },
      {
        name: 'hq-ap-02',
        type: 'ap',
        role: 'access',
        vendor: 'Aruba',
        descr: 'HPE Aruba AP-535 Access Point',
      },
    ],
    links: [
      [0, 2],
      [1, 2],
      [2, 3],
      [2, 4],
      [3, 5],
      [3, 6],
      [4, 7],
      [4, 8],
      [5, 9],
      [6, 10],
      [7, 11],
      [5, 12],
      [8, 13],
      [0, 1],
      [3, 4],
    ],
  },
  {
    name: 'Branch-NYC',
    building: 'Office-A',
    subnet: '10.10',
    devices: [
      {
        name: 'nyc-rtr-01',
        type: 'router',
        role: 'core',
        vendor: 'Cisco',
        descr: 'Cisco IOS Software, ISR 4400 Series Router',
      },
      {
        name: 'nyc-fw-01',
        type: 'firewall',
        role: 'core',
        vendor: 'Fortinet',
        descr: 'Fortinet FortiGate-200F Firewall',
      },
      {
        name: 'nyc-sw-01',
        type: 'switch',
        role: 'distribution',
        vendor: 'Cisco',
        descr: 'Cisco IOS Software, Catalyst 9300 Switch',
      },
      {
        name: 'nyc-sw-02',
        type: 'switch',
        role: 'access',
        vendor: 'Cisco',
        descr: 'Cisco IOS Software, Catalyst 9200 Switch',
      },
      {
        name: 'nyc-sw-03',
        type: 'switch',
        role: 'access',
        vendor: 'Cisco',
        descr: 'Cisco IOS Software, Catalyst 9200 Switch',
      },
      {
        name: 'nyc-srv-01',
        type: 'server',
        role: 'server',
        vendor: 'Dell',
        descr: 'Linux 5.15 Dell PowerEdge R650 server',
      },
      {
        name: 'nyc-ap-01',
        type: 'ap',
        role: 'access',
        vendor: 'Aruba',
        descr: 'HPE Aruba AP-515 Access Point',
      },
      {
        name: 'nyc-ap-02',
        type: 'ap',
        role: 'access',
        vendor: 'Aruba',
        descr: 'HPE Aruba AP-515 Access Point',
      },
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
      [3, 5],
      [4, 6],
      [4, 7],
    ],
  },
  {
    name: 'Branch-CHI',
    building: 'Office-B',
    subnet: '10.20',
    devices: [
      {
        name: 'chi-rtr-01',
        type: 'router',
        role: 'core',
        vendor: 'Juniper',
        descr: 'Juniper Networks JUNOS SRX340 Router',
      },
      {
        name: 'chi-fw-01',
        type: 'firewall',
        role: 'core',
        vendor: 'Fortinet',
        descr: 'Fortinet FortiGate-100F Firewall',
      },
      {
        name: 'chi-sw-01',
        type: 'switch',
        role: 'distribution',
        vendor: 'Juniper',
        descr: 'Juniper Networks JUNOS EX4300 Switch',
      },
      {
        name: 'chi-sw-02',
        type: 'switch',
        role: 'access',
        vendor: 'Juniper',
        descr: 'Juniper Networks JUNOS EX2300 Switch',
      },
      {
        name: 'chi-srv-01',
        type: 'server',
        role: 'server',
        vendor: 'HP',
        descr: 'Linux 5.15 HP ProLiant DL380 server',
      },
      {
        name: 'chi-ap-01',
        type: 'ap',
        role: 'access',
        vendor: 'Aruba',
        descr: 'HPE Aruba AP-505 Access Point',
      },
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [3, 5],
    ],
  },
];

const rMac = () => {
  const h = () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  return `${h()}:${h()}:${h()}:${h()}:${h()}:${h()}`;
};
const rIp = (s, i) => `${s}.${Math.floor(i / 254) + 1}.${(i % 254) + 1}`;
const IFS = {
  router: ['Gi0/0/0', 'Gi0/0/1', 'Gi0/0/2', 'Te0/0/0/0', 'Lo0', 'Mgmt0'],
  switch: [
    'Eth1/1',
    'Eth1/2',
    'Eth1/3',
    'Eth1/4',
    'Eth1/5',
    'Eth1/6',
    'Eth1/7',
    'Eth1/8',
    'Vlan1',
    'Mgmt0',
  ],
  firewall: ['eth1/1', 'eth1/2', 'eth1/3', 'eth1/4', 'Mgmt'],
  server: ['eth0', 'eth1', 'lo'],
  ap: ['eth0', 'wlan0', 'wlan1'],
};
const SPD = { router: 1e10, switch: 1e9, firewall: 1e10, server: 1e9, ap: 1e9 };
const devs = [];
const dIp = new Map();
const dMac = new Map();
let gid = 1;
for (const s of SITES)
  for (const d of s.devices) {
    const ip = rIp(s.subnet, gid);
    const mac = rMac();
    dIp.set(d.name, ip);
    dMac.set(d.name, mac);
    devs.push({ ...d, ip, mac, site: s.name, building: s.building });
    gid++;
  }

// ── BGP peering topology ──────────────────────────────────────────────────
// Realistic multi-site BGP: iBGP mesh at HQ, hub-spoke to branches, eBGP to transit
const LOCAL_ASN = 65000;

// Each entry: [localDevice, remoteDevice|null, remoteASN, remoteIP|null, type, prefixesRx, prefixesTx]
// null remoteDevice = external peer (unresolvable → unmanaged node)
const BGP_PEERS = [
  // iBGP mesh at HQ
  ['hq-core-rtr-01', 'hq-core-rtr-02', LOCAL_ASN, null, 'ibgp', 180, 175],
  ['hq-core-rtr-01', 'hq-fw-01', LOCAL_ASN, null, 'ibgp', 45, 180],
  ['hq-core-rtr-02', 'hq-fw-01', LOCAL_ASN, null, 'ibgp', 45, 175],
  // Hub-spoke: branches → HQ routers
  ['nyc-rtr-01', 'hq-core-rtr-01', LOCAL_ASN, null, 'ibgp', 500, 8],
  ['nyc-rtr-01', 'hq-core-rtr-02', LOCAL_ASN, null, 'ibgp', 500, 8],
  ['chi-rtr-01', 'hq-core-rtr-01', LOCAL_ASN, null, 'ibgp', 500, 5],
  ['chi-rtr-01', 'hq-core-rtr-02', LOCAL_ASN, null, 'ibgp', 500, 5],
  // eBGP: HQ to transit providers
  ['hq-core-rtr-01', null, 3356, '198.51.100.1', 'ebgp', 920000, 12],
  ['hq-core-rtr-01', null, 174, '198.51.100.5', 'ebgp', 915000, 12],
  ['hq-core-rtr-02', null, 6939, '198.51.100.9', 'ebgp', 890000, 12],
  ['hq-core-rtr-02', null, 3356, '198.51.100.3', 'ebgp', 920000, 12],
  // eBGP: branches to local ISPs
  ['nyc-rtr-01', null, 7922, '203.0.113.1', 'ebgp', 5, 8],
  ['chi-rtr-01', null, 20115, '203.0.113.5', 'ebgp', 0, 0], // DOWN peer
];

function makeBgpDoc(ts, localDev, remoteIp, remoteAsn, state, prefRx, prefTx) {
  const d = devs.find((x) => x.name === localDev);
  if (!d) return null;
  return {
    '@timestamp': ts,
    host: { name: d.name, ip: d.ip, mac: d.mac, type: d.type },
    observer: { vendor: d.vendor, sys_descr: d.descr },
    network: { site: d.site, building: d.building, role: d.role },
    bgp_peer: {
      remote_ip: remoteIp,
      remote_asn: remoteAsn,
      local_asn: LOCAL_ASN,
      peer_state: state,
      prefixes_received: prefRx,
      prefixes_sent: prefTx,
      uptime_seconds: state === 'Established' ? Math.floor(Math.random() * 2592000) + 86400 : 0,
      in_updates: state === 'Established' ? Math.floor(Math.random() * 50000) + 1000 : 0,
      out_updates: state === 'Established' ? Math.floor(Math.random() * 5000) + 100 : 0,
    },
  };
}

// ── OSPF neighbor topology ─────────────────────────────────────────────────
// Interior routing: routers and firewalls within each site + inter-area WAN links
// [localDevice, remoteDevice, areaId, priority]
const OSPF_PEERS = [
  // HQ — Area 0.0.0.0 (backbone)
  ['hq-core-rtr-01', 'hq-core-rtr-02', '0.0.0.0', 1],
  ['hq-core-rtr-01', 'hq-fw-01', '0.0.0.0', 1],
  ['hq-core-rtr-02', 'hq-fw-01', '0.0.0.0', 1],
  // Branch-NYC — Area 0.0.0.1
  ['nyc-rtr-01', 'nyc-fw-01', '0.0.0.1', 1],
  ['nyc-rtr-01', 'hq-core-rtr-01', '0.0.0.0', 1], // inter-area ABR
  // Branch-CHI — Area 0.0.0.2
  ['chi-rtr-01', 'chi-fw-01', '0.0.0.2', 1],
  ['chi-rtr-01', 'hq-core-rtr-02', '0.0.0.0', 1], // inter-area ABR
];

function makeOspfDoc(ts, localDev, remoteIp, routerId, state, areaId, priority) {
  const d = devs.find((x) => x.name === localDev);
  if (!d) return null;
  return {
    '@timestamp': ts,
    host: { name: d.name, ip: d.ip, mac: d.mac, type: d.type },
    observer: { vendor: d.vendor, sys_descr: d.descr },
    network: { site: d.site, building: d.building, role: d.role },
    ospf_neighbor: {
      neighbor_ip: remoteIp,
      router_id: routerId,
      state,
      area_id: areaId,
      priority,
      dead_timer: 40,
      retrans_count:
        state === 'Full' ? Math.floor(Math.random() * 5) : Math.floor(Math.random() * 50) + 10,
    },
  };
}

async function bulk(docs) {
  const body = docs.flatMap((d) => [{ create: { _index: IDX } }, d]);
  const r = await fetch(`${ES}/_bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson', Authorization: `Basic ${AUTH}` },
    body: body.map((l) => JSON.stringify(l)).join('\n') + '\n',
  });
  const j = await r.json();
  if (j.errors) {
    const e = j.items.find((i) => i.create?.error);
    if (e) console.error('Err:', JSON.stringify(e.create.error));
  }
  return j;
}

async function main() {
  console.log(`=== Generating sample data: ${devs.length} devices → ${ES}/${IDX} ===`);
  const now = new Date();
  const docs = [];
  for (let t = 0; t < 5; t++) {
    const ts = new Date(now.getTime() - t * 6e4).toISOString();
    for (const d of devs) {
      const ifs = IFS[d.type] || ['eth0'];
      for (let i = 0; i < ifs.length; i++) {
        const down = d.name.includes('access-sw-03') && ifs[i] === 'Eth1/4' && t < 2;
        docs.push({
          '@timestamp': ts,
          host: { name: d.name, ip: d.ip, mac: d.mac, type: d.type },
          observer: { vendor: d.vendor, sys_descr: d.descr, os: { full: d.descr } },
          network: { site: d.site, building: d.building, role: d.role },
          interface: {
            name: ifs[i],
            id: String(i + 1),
            speed: SPD[d.type] || 1e9,
            status: { admin: 'up', oper: down ? 'down' : 'up' },
            traffic: {
              in: { bytes: Math.floor(Math.random() * 5e8) + 1e6 },
              out: { bytes: Math.floor(Math.random() * 3e8) + 5e5 },
            },
            errors: {
              in: down ? Math.floor(Math.random() * 50) : Math.floor(Math.random() * 3),
              out: down ? Math.floor(Math.random() * 30) : 0,
            },
          },
        });
      }
    }
  }
  const ts = now.toISOString();
  const arp = [];
  const mac = [];
  for (const s of SITES) {
    for (const [si, ti] of s.links) {
      const sd = s.devices[si];
      const td = s.devices[ti];
      arp.push({
        '@timestamp': ts,
        host: { name: sd.name, ip: dIp.get(sd.name), mac: dMac.get(sd.name), type: sd.type },
        observer: { vendor: sd.vendor, sys_descr: sd.descr },
        network: { site: s.name, building: s.building, role: sd.role },
        arp: { ip_addr: dIp.get(td.name), mac_addr: dMac.get(td.name), interface_index: 1 },
      });
      arp.push({
        '@timestamp': ts,
        host: { name: td.name, ip: dIp.get(td.name), mac: dMac.get(td.name), type: td.type },
        observer: { vendor: td.vendor, sys_descr: td.descr },
        network: { site: s.name, building: s.building, role: td.role },
        arp: { ip_addr: dIp.get(sd.name), mac_addr: dMac.get(sd.name), interface_index: 1 },
      });
      if (sd.type === 'switch')
        mac.push({
          '@timestamp': ts,
          host: { name: sd.name, ip: dIp.get(sd.name), mac: dMac.get(sd.name), type: sd.type },
          observer: { vendor: sd.vendor, sys_descr: sd.descr },
          network: { site: s.name, building: s.building, role: sd.role },
          mac_table: { mac_addr: dMac.get(td.name), port_index: ti + 1, status: 'learned' },
        });
      if (td.type === 'switch')
        mac.push({
          '@timestamp': ts,
          host: { name: td.name, ip: dIp.get(td.name), mac: dMac.get(td.name), type: td.type },
          observer: { vendor: td.vendor, sys_descr: td.descr },
          network: { site: s.name, building: s.building, role: td.role },
          mac_table: { mac_addr: dMac.get(sd.name), port_index: si + 1, status: 'learned' },
        });
    }
  }
  // WAN links
  const WAN = [
    [0, 0, 1, 0],
    [0, 1, 2, 0],
  ];
  for (const [si, sdi, ti, tdi] of WAN) {
    const sd = SITES[si].devices[sdi];
    const td = SITES[ti].devices[tdi];
    arp.push({
      '@timestamp': ts,
      host: { name: sd.name, ip: dIp.get(sd.name), mac: dMac.get(sd.name), type: sd.type },
      observer: { vendor: sd.vendor, sys_descr: sd.descr },
      network: { site: SITES[si].name, building: SITES[si].building, role: sd.role },
      arp: { ip_addr: dIp.get(td.name), mac_addr: dMac.get(td.name), interface_index: 2 },
    });
    arp.push({
      '@timestamp': ts,
      host: { name: td.name, ip: dIp.get(td.name), mac: dMac.get(td.name), type: td.type },
      observer: { vendor: td.vendor, sys_descr: td.descr },
      network: { site: SITES[ti].name, building: SITES[ti].building, role: td.role },
      arp: { ip_addr: dIp.get(sd.name), mac_addr: dMac.get(sd.name), interface_index: 1 },
    });
  }

  // BGP peer sessions
  const bgp = [];
  for (const [local, remote, remoteAsn, extIp, peerType, prefRx, prefTx] of BGP_PEERS) {
    const remoteIp = remote ? dIp.get(remote) : extIp;
    // chi-rtr-01 ↔ AS 20115 is DOWN; all others Established
    const state = local === 'chi-rtr-01' && remoteAsn === 20115 ? 'Idle' : 'Established';
    const doc = makeBgpDoc(ts, local, remoteIp, remoteAsn, state, prefRx, prefTx);
    if (doc) bgp.push(doc);
    // For iBGP, also create the reverse direction doc from the remote device
    if (remote && peerType === 'ibgp') {
      const rev = makeBgpDoc(ts, remote, dIp.get(local), LOCAL_ASN, state, prefTx, prefRx);
      if (rev) bgp.push(rev);
    }
  }

  // OSPF neighbor sessions
  const ospf = [];
  for (const [local, remote, areaId, priority] of OSPF_PEERS) {
    const remoteIp = dIp.get(remote);
    const routerId = remoteIp; // router ID typically matches primary IP
    const doc = makeOspfDoc(ts, local, remoteIp, routerId, 'Full', areaId, priority);
    if (doc) ospf.push(doc);
    // Bidirectional: remote also sees local as neighbor
    const localIp = dIp.get(local);
    const rev = makeOspfDoc(ts, remote, localIp, localIp, 'Full', areaId, priority);
    if (rev) ospf.push(rev);
  }

  const all = [...docs, ...arp, ...mac, ...bgp, ...ospf];
  console.log(`Total docs: ${all.length} (${bgp.length} BGP, ${ospf.length} OSPF)`);
  for (let i = 0; i < all.length; i += 500) {
    await bulk(all.slice(i, i + 500));
    process.stdout.write(`\r  ${Math.min(i + 500, all.length)}/${all.length}`);
  }
  console.log('\n=== Done ===');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
