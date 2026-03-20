# Network Topology — Kibana Plugin

A Kibana Observability plugin for **network monitoring and topology mapping**. Discovers network device adjacency from SNMP data (ARP/MAC tables) stored in Elasticsearch and renders an interactive, drill-down topology graph.

## Features (MVP)

- **Site overview** — Health card grid showing aggregated device status per site
- **Interactive topology graph** — Canvas-based, D3 force-directed layout with zoom, pan, drag
- **Device detail flyout** — Interface table, ARP neighbors, status badges
- **Device inventory list** — Searchable, paginated table of all devices
- **ARP/MAC topology discovery** — Infers L2/L3 adjacency from SNMP table data
- **Elasticsearch ingest pipelines** — Auto-classify device type and vendor from sysDescr

## Target Version

- Kibana / Elasticsearch **8.17.0** (dev), targeting **8.19.12** for production

## Quick Start

### Prerequisites

- Docker Desktop (4 GB+ RAM)
- Git
- Node.js 18.18.2+ (match Kibana's `.node-version`)
- Yarn 1.x (classic)

### 1. Clone Kibana and install the plugin

```bash
git clone https://github.com/elastic/kibana.git
cd kibana && git checkout 8.17

# Copy or symlink this plugin into the plugins directory
cp -r /path/to/network_topology plugins/

nvm use $(cat .node-version)
yarn kbn bootstrap
```

### 2. Start Elasticsearch (Docker)

```bash
docker compose -f plugins/network_topology/docker-compose.dev.yml up -d
```

### 3. Set up index templates and load sample data

```bash
chmod +x plugins/network_topology/scripts/setup_elasticsearch.sh
./plugins/network_topology/scripts/setup_elasticsearch.sh
node plugins/network_topology/scripts/generate_sample_data.mjs
```

### 4. Start Kibana

```bash
# Terminal 1 — build plugin frontend (watches for changes)
cd plugins/network_topology && yarn dev --watch

# Terminal 2 — start Kibana (from repo root)
yarn start --no-base-path
```

### 5. Open in browser

Navigate to **http://localhost:5601** → **Observability** → **Network Topology**

Login: `elastic` / `changeme`

## Architecture

```
┌────────────────────────────────────────────────────┐
│ Kibana 8.17 Platform                               │
│  Observability nav · EUI · Data plugin             │
├────────────────────────────────────────────────────┤
│ Client (public/)                                   │
│  Site Overview → Topology Canvas → Device Flyout   │
│  D3 force layout · Canvas 2D · Quadtree hit detect │
├────────────────────────────────────────────────────┤
│ Server (server/)                                   │
│  Hierarchy builder · ARP/MAC adjacency resolver    │
│  Field normalizer (Logstash ↔ OTel)               │
├────────────────────────────────────────────────────┤
│ Elasticsearch 8.17                                 │
│  snmp-* · logstash-snmp-* · logs-* · netflow-*    │
│  Ingest pipelines: device enrichment               │
└────────────────────────────────────────────────────┘
```

## Connecting Live SNMP Data

See `scripts/logstash-snmp.conf.example` for a Logstash configuration that
collects interface metrics, ARP tables, and MAC address tables via SNMP and
indexes them into Elasticsearch with the correct field mappings.

## Roadmap

- [ ] Hierarchical building/floor/rack drill-down
- [ ] Layout persistence via Saved Objects
- [ ] WebGL renderer for 500+ node topologies
- [ ] LLDP/CDP neighbor discovery
- [ ] Syslog/NetFlow correlation in device detail
- [ ] Kibana alerting integration
- [ ] Custom Elastic Agent SNMP integration

## License

Elastic License 2.0
