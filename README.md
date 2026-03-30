# Network Topology — Kibana Plugin

A Kibana Observability plugin for **network monitoring and topology mapping**. Collects SNMP data (device identity, interface metrics, ARP/MAC tables, routing protocol adjacencies) via Logstash or Telegraf, stores it in Elasticsearch, and renders an interactive topology graph with drill-down device detail.

## Features

- **Site overview** — Health card grid showing aggregated device and interface status per site
- **Interactive topology graph** — Canvas-based, D3 force-directed layout with zoom, pan, drag, and node type visibility toggles
- **Device detail flyout** — Interface table, ARP neighbors, BGP peer sessions, OSPF adjacencies
- **Device inventory list** — Searchable, paginated table of all devices with KQL filtering
- **Multi-layer topology discovery** — L2 (MAC table), L3 (ARP), BGP overlay, and OSPF adjacency links
- **Routing protocol monitoring** — BGP peer state, AS numbers, prefix counts, uptime; OSPF adjacency state, router ID, area, priority
- **Elasticsearch ingest pipeline** — Auto-classifies device type and vendor from `sysDescr`

## Target Version

Kibana / Elasticsearch **8.19.12**

## Quick Start (Development)

### Prerequisites

- Docker (4 GB+ RAM allocated)
- Node.js **22.22.0** (match Kibana's `.node-version` — use `nvm use` from the repo root)
- Yarn 1.x (classic)

### 1. Clone Kibana and place the plugin

```bash
git clone https://github.com/elastic/kibana.git
cd kibana
git checkout v8.19.12

nvm use
yarn kbn bootstrap
```

The plugin lives at `plugins/kibana-network-o11y/` inside the Kibana repo. If you are working from a separate checkout, copy or symlink it there.

### 2. Start Elasticsearch + Kibana (Docker)

```bash
docker compose -f plugins/kibana-network-o11y/docker-compose.dev.yml up -d
```

### 3. Set up index templates and load sample data

```bash
cd plugins/kibana-network-o11y

chmod +x scripts/setup_elasticsearch.sh
./scripts/setup_elasticsearch.sh

node scripts/generate_sample_data.mjs
```

### 4. Start Kibana in dev mode

```bash
# From the Kibana repo root
yarn start --no-base-path
```

### 5. Open in browser

Navigate to **http://localhost:5601** → **Observability** → **Network Topology**

Default login: `elastic` / `changeme`

---

## Building for Production

### Build the plugin zip

```bash
cd plugins/kibana-network-o11y
node ../../scripts/plugin_helpers build --kibana-version 8.19.12
```

Output: `build/networkTopology-8.19.12.zip`

The zip is self-contained — all `@kbn/*` dependencies and the compiled frontend bundle are included.

### Install on a production Kibana server

```bash
bin/kibana-plugin install file:///absolute/path/to/networkTopology-8.19.12.zip
# Restart Kibana after installation
```

> **Version matching**: The version in the zip must exactly match the target Kibana instance version. Rebuild from the matching Kibana source tree when upgrading.

---

## Connecting Live SNMP Data

See [`docs/collectors/logstash.conf`](docs/collectors/logstash.conf) for a consolidated Logstash pipeline that walks IF-MIB, IP-MIB (ARP + IP address), BRIDGE-MIB, BGP4-MIB, and OSPF-MIB per device and emits correctly mapped documents.

Alternatives:
- [`docs/collectors/telegraf.toml`](docs/collectors/telegraf.toml) — Telegraf SNMP input plugin config
- [`docs/collectors/elastic-agent.md`](docs/collectors/elastic-agent.md) — Elastic Agent notes

Field mappings are documented in [`docs/field-reference.md`](docs/field-reference.md).

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│ Kibana 8.19 Platform                                 │
│  Observability nav · EUI · Data plugin               │
├──────────────────────────────────────────────────────┤
│ Client (public/)                                     │
│  Site Overview → Topology Canvas → Device Flyout     │
│  D3 force layout · Canvas 2D · Quadtree hit detect   │
│  Visibility toggles · BGP/OSPF/ARP link rendering    │
├──────────────────────────────────────────────────────┤
│ Server (server/)                                     │
│  Topology builder: ARP/MAC/BGP/OSPF adjacency        │
│  Device detail: interfaces, neighbors, routing peers │
│  Setup health check: template, pipeline, coverage    │
├──────────────────────────────────────────────────────┤
│ Elasticsearch 8.19                                   │
│  Index pattern: snmp-*                               │
│  Ingest pipeline: snmp-device-enrichment             │
│  Index template: snmp-network-o11y                   │
└──────────────────────────────────────────────────────┘
```

Document types written per SNMP poll cycle (one per device):

| Document type | Key field | Data source |
|---|---|---|
| Interface metrics | `interface.name` | IF-MIB ifTable |
| ARP entries | `arp.mac_addr` | IP-MIB ipNetToMediaTable |
| MAC table entries | `mac_table.mac_addr` | BRIDGE-MIB dot1dTpFdbTable |
| IP address entries | `ip_addr.address` | IP-MIB ipAddrTable |
| BGP peer sessions | `bgp_peer.remote_ip` | BGP4-MIB bgpPeerTable |
| OSPF neighbors | `ospf_neighbor.neighbor_ip` | OSPF-MIB ospfNbrTable |

---

## Roadmap

- [ ] LLDP/CDP neighbor discovery (replaces ARP/MAC inference for supported devices)
- [ ] Layout persistence via Saved Objects
- [ ] WebGL renderer for 500+ node topologies
- [ ] Syslog/NetFlow correlation in device detail
- [ ] Kibana alerting integration (interface down, BGP session drop)
- [ ] Custom Elastic Agent SNMP integration

## License

Elastic License 2.0
