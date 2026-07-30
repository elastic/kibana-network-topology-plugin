#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Sample flow data for the Connections view.
 *
 * Emits ECS network events with a deliberately readable shape so the force
 * layout means something in a demo:
 *   - three hub servers that most clients talk to (tight clusters)
 *   - one scanner fanning out across many hosts and ports (a star)
 *   - point-to-point pairs with no other peers (islands)
 *
 * Usage: node scripts/generate_sample_flows.mjs [ES_HOST] [USER] [PASSWORD]
 */
const ES = process.argv[2] || 'http://localhost:9200';
const U = process.argv[3] || 'elastic';
const P = process.argv[4] || 'changeme';
const IDX = 'netflow-sample';
const AUTH = Buffer.from(`${U}:${P}`).toString('base64');

// Explicit mappings matter: under dynamic mapping an IP string becomes `text`
// and a `terms` aggregation on it fails outright.
const MAPPINGS = {
  properties: {
    '@timestamp': { type: 'date' },
    source: {
      properties: {
        ip: { type: 'ip' },
        port: { type: 'long' },
        bytes: { type: 'long' },
        packets: { type: 'long' },
      },
    },
    destination: {
      properties: {
        ip: { type: 'ip' },
        port: { type: 'long' },
        bytes: { type: 'long' },
        packets: { type: 'long' },
      },
    },
    client: { properties: { ip: { type: 'ip' } } },
    server: { properties: { ip: { type: 'ip' } } },
    network: {
      properties: {
        bytes: { type: 'long' },
        packets: { type: 'long' },
        transport: { type: 'keyword' },
        direction: { type: 'keyword' },
      },
    },
    host: { properties: { name: { type: 'keyword' } } },
    user: { properties: { name: { type: 'keyword' } } },
    event: {
      properties: {
        category: { type: 'keyword' },
        kind: { type: 'keyword' },
        duration: { type: 'long' },
        outcome: { type: 'keyword' },
      },
    },
    observer: { properties: { type: { type: 'keyword' } } },
  },
};

const HUBS = [
  { ip: '10.0.1.10', name: 'hub-web-01', ports: [443, 80] },
  { ip: '10.0.1.11', name: 'hub-db-01', ports: [5432, 3306] },
  { ip: '10.0.1.12', name: 'hub-dns-01', ports: [53] },
];
const SCANNER = { ip: '10.0.9.66', name: 'unknown-host' };
const EXTERNAL = ['203.0.113.20', '203.0.113.21', '198.51.100.7'];
const USERS = ['a.chen', 'r.patel', 'j.okafor', 'm.silva', 'k.novak', 'svc-backup', 'svc-monitor'];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const ephemeralPort = () => 32768 + rnd(28000);

/** ~60 workstations across two subnets, each owned by one of USERS. */
const CLIENTS = [];
for (const [subnet, prefix] of [
  ['10.0.2', 'ws-a'],
  ['10.0.3', 'ws-b'],
]) {
  for (let i = 1; i <= 30; i++) {
    CLIENTS.push({
      ip: `${subnet}.${i}`,
      name: `${prefix}-${String(i).padStart(2, '0')}`,
      user: pick(USERS),
    });
  }
}

/** Point-to-point pairs that stay disconnected from everything else. */
const ISLANDS = [];
for (let i = 0; i < 12; i++) {
  ISLANDS.push({
    src: `192.168.${50 + i}.2`,
    dst: `192.168.${50 + i}.3`,
    name: `edge-${String(i).padStart(2, '0')}`,
    port: pick([22, 161, 514, 8080]),
  });
}

const WINDOW_MS = 15 * 60 * 1000;
const now = Date.now();
const someTime = () => new Date(now - rnd(WINDOW_MS)).toISOString();

function flow({ srcIp, dstIp, dstPort, transport = 'tcp', host, user, bytes, packets }) {
  const b = bytes ?? 400 + rnd(250_000);
  const p = packets ?? 2 + rnd(400);
  return {
    '@timestamp': someTime(),
    event: { category: 'network', kind: 'event', duration: rnd(5_000_000_000), outcome: 'success' },
    source: {
      ip: srcIp,
      port: ephemeralPort(),
      bytes: Math.floor(b * 0.4),
      packets: Math.floor(p * 0.4),
    },
    destination: {
      ip: dstIp,
      port: dstPort,
      bytes: Math.floor(b * 0.6),
      packets: Math.floor(p * 0.6),
    },
    // client/server mirror source/destination so the "Client IP → Server IP"
    // preset works against this data too.
    client: { ip: srcIp },
    server: { ip: dstIp },
    network: { bytes: b, packets: p, transport, direction: 'internal' },
    ...(host ? { host: { name: host } } : {}),
    ...(user ? { user: { name: user } } : {}),
    observer: { type: 'netflow' },
  };
}

const docs = [];

// Clients → hubs. Each client hits every hub a few times, which makes the hubs
// high-degree and the clients tight satellites around them.
for (const client of CLIENTS) {
  for (const hub of HUBS) {
    const sessions = 2 + rnd(6);
    for (let s = 0; s < sessions; s++) {
      docs.push(
        flow({
          srcIp: client.ip,
          dstIp: hub.ip,
          dstPort: pick(hub.ports),
          transport: hub.ip === '10.0.1.12' ? 'udp' : 'tcp',
          host: client.name,
          user: client.user,
        })
      );
    }
  }
}

// Hub → hub chatter (web tier talking to the database), so hubs are 'both'.
for (let i = 0; i < 40; i++) {
  docs.push(
    flow({
      srcIp: HUBS[0].ip,
      dstIp: HUBS[1].ip,
      dstPort: 5432,
      host: HUBS[0].name,
      bytes: 20_000 + rnd(900_000),
    })
  );
}

// Egress to the internet from a handful of clients.
for (let i = 0; i < 120; i++) {
  const client = pick(CLIENTS);
  docs.push(
    flow({
      srcIp: client.ip,
      dstIp: pick(EXTERNAL),
      dstPort: pick([443, 443, 443, 80]),
      host: client.name,
      user: client.user,
    })
  );
}

// Scanner: one source, wide fan-out, tiny transfers. Renders as a star and is
// the reason `destination.port` is a useful pivot.
for (let i = 1; i <= 200; i++) {
  const target = i <= 100 ? `10.0.2.${(i % 30) + 1}` : `10.0.4.${i - 100}`;
  docs.push(
    flow({
      srcIp: SCANNER.ip,
      dstIp: target,
      dstPort: pick([22, 23, 80, 443, 445, 3389, 8080, 8443]),
      host: SCANNER.name,
      bytes: 60 + rnd(200),
      packets: 1 + rnd(3),
    })
  );
}

// Islands: pairs that only ever talk to each other.
for (const island of ISLANDS) {
  const sessions = 3 + rnd(5);
  for (let s = 0; s < sessions; s++) {
    docs.push(
      flow({
        srcIp: island.src,
        dstIp: island.dst,
        dstPort: island.port,
        host: island.name,
        bytes: 1_000 + rnd(40_000),
      })
    );
  }
}

async function esFetch(path, init = {}) {
  const res = await fetch(`${ES}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${AUTH}`,
      ...(init.headers || {}),
    },
  });
  return res;
}

async function ensureIndex() {
  const head = await esFetch(`/${IDX}`, { method: 'HEAD' });
  if (head.status === 404) {
    const res = await esFetch(`/${IDX}`, {
      method: 'PUT',
      body: JSON.stringify({ mappings: MAPPINGS }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create ${IDX}: ${res.status} ${await res.text()}`);
    }
    console.log(`Created index ${IDX} with explicit ip/long mappings`);
    return;
  }

  // Already there — make sure it is not a dynamically-mapped leftover, since a
  // `text` source.ip would break the aggregation with a confusing error.
  const res = await esFetch(`/${IDX}/_mapping`);
  const body = await res.json();
  const type = body?.[IDX]?.mappings?.properties?.source?.properties?.ip?.type;
  if (type !== 'ip') {
    throw new Error(
      `${IDX} exists but source.ip is mapped as "${type ?? 'unmapped'}" instead of "ip". ` +
        `Delete it first:  curl -u ${U}:*** -XDELETE ${ES}/${IDX}`
    );
  }
  console.log(`Appending to existing index ${IDX}`);
}

async function bulk(batch) {
  const body = batch.flatMap((d) => [{ create: { _index: IDX } }, d]);
  const res = await esFetch('/_bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: body.map((l) => JSON.stringify(l)).join('\n') + '\n',
  });
  const json = await res.json();
  if (json.errors) {
    const failed = json.items.find((i) => i.create?.error);
    if (failed) console.error('Err:', JSON.stringify(failed.create.error));
  }
}

async function main() {
  console.log(`=== Generating sample flows → ${ES}/${IDX} ===`);
  await ensureIndex();
  console.log(
    `${docs.length} flow docs: ${CLIENTS.length} clients, ${HUBS.length} hubs, ` +
      `1 scanner, ${ISLANDS.length} isolated pairs (last 15 minutes)`
  );
  for (let i = 0; i < docs.length; i += 500) {
    await bulk(docs.slice(i, i + 500));
    process.stdout.write(`\r  ${Math.min(i + 500, docs.length)}/${docs.length}`);
  }
  await esFetch(`/${IDX}/_refresh`, { method: 'POST' });
  console.log('\n=== Done ===');
  console.log(
    `Open Network Topology → Connections. Create a data view for "${IDX}" (or "netflow-*") ` +
      `and use the default source.ip → destination.ip pair.`
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
