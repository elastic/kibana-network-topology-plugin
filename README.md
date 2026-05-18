# Network Topology — Kibana Plugin

A Kibana Observability plugin for **network monitoring and topology mapping**. Collects SNMP data (device identity, interface metrics, ARP/MAC tables, routing protocol adjacencies) via Logstash or Telegraf, stores it in Elasticsearch, and renders an interactive topology graph with drill-down device detail.

> [!NOTE]
>
> ### Technical Preview
>
> This functionality is in technical preview and is not ready for production usage. Technical preview features may change or be removed at any time. Elastic will work to fix any issues, but features in technical preview are not subject to the support SLA of official GA features. Specific Support terms apply.

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
- Node.js **22.22.0** managed via `nvm` (matches Kibana `v8.19.12` `.node-version`)
- Yarn 1.x (classic)
- `git` and a working GitHub HTTPS credential (the bootstrap clones via HTTPS; if the plugin repo is private, run `gh auth login` first)

### 1. Run the bootstrap script

A single script handles the full setup: clones Kibana at the pinned version, clones this plugin into `<kibana>/plugins/networkTopology`, runs `yarn kbn bootstrap`, and writes a multi-root code workspace (`.code-workspace`) with both Kibana and the plugin as separate roots. The format is understood by VSCode, Cursor, and other VSCode-compatible editors.

```bash
curl -fsSL https://github.com/elastic/kibana-network-topology-plugin/blob/main/scripts/bootstrap.sh | bash
```

By default it sets up in your current working directory. Open the generated workspace in your editor:

```bash
code network-topology.code-workspace      # or: cursor network-topology.code-workspace
```

Common flags (pass after `--` so they reach the script, not `bash`):

```bash
curl -fsSL <url> | bash -s -- --dir ~/dev/network-topology       # custom parent directory, ignored if an existing kibana checkout is reused
curl -fsSL <url> | bash -s -- --kibana /path/to/existing/kibana  # reuse an existing Kibana checkout
curl -fsSL <url> | bash -s -- --no-workspace                     # skip the .code-workspace file
curl -fsSL <url> | bash -s -- --no-bootstrap                     # skip yarn kbn bootstrap
```

Re-running is safe: existing checkouts are detected and skipped, and the workspace file isn't overwritten if it already exists. Kibana is fetched as a partial clone (`--filter=blob:none --branch v8.19.12`) so the initial download is hundreds of MB instead of multi-GB.

<details>
<summary>What the script does (manual equivalent)</summary>

```bash
git clone --filter=blob:none --branch v8.19.12 \
  https://github.com/elastic/kibana.git
git clone https://github.com/elastic/kibana-network-topology-plugin.git \
  kibana/plugins/networkTopology

cd kibana
nvm use
yarn kbn bootstrap
```

The plugin lives at `<kibana>/plugins/networkTopology` as a normal git clone. Kibana's `.gitignore` excludes `plugins/*`, so the two repos stay independent.

</details>

### 2. Start Elasticsearch (Docker)

```bash
# From the plugin directory inside Kibana:
cd <kibana>/plugins/networkTopology
docker compose -f docker-compose.dev.yml up -d
```

### 3. Set up Elasticsearch resources + load sample data

```bash
# Still from <kibana>/plugins/networkTopology:
chmod +x scripts/setup_elasticsearch.sh
./scripts/setup_elasticsearch.sh

node scripts/generate_sample_data.mjs
```

> Note: `scripts/setup_elasticsearch.sh` and the data generators default to:
>
> - Elasticsearch URL: `http://localhost:9200`
> - credentials: `elastic / changeme`

### 4. Configure Kibana to use local Elasticsearch

Kibana must authenticate to Elasticsearch as a service user (not `elastic`). For local dev, set a password for `kibana_system` in the Docker container:

```bash
docker exec -it es-network-topology /usr/share/elasticsearch/bin/elasticsearch-reset-password -u kibana_system -i
```

Then configure Kibana (example `config/kibana.dev.yml`):

```yaml
elasticsearch:
  hosts: http://localhost:9200
  username: kibana_system
  password: <the password you set above>
  ssl:
    verificationMode: none
```

### 5. Start Kibana + build the plugin UI bundle (two terminals)

Start Kibana in one terminal:

```bash
# From the Kibana repo root
yarn start --no-base-path
```

In a second terminal, build the plugin UI bundle in watch mode (this is required so Kibana can serve `networkTopology.plugin.js`):

```bash
cd /absolute/path/to/kibana/plugins/networkTopology
nvm use 22.22.0
yarn dev --watch
```

### 6. Open in browser

Navigate to **http://localhost:5601** → **Observability** → **Network Topology**

Default login: `elastic` / `changeme`

> **Data shows 0 devices?** Check the time range. Sample data uses current timestamps, so use **Last 15 minutes** and click **Refresh**.

---

## Troubleshooting

### `.../bundles/plugin/networkTopology/...networkTopology.plugin.js` returns 404

This indicates Kibana registered the plugin, but the UI bundle is not available.

Most commonly, `yarn dev --watch` is not running (or crashed). Ensure you have a second terminal running:

```bash
cd /absolute/path/to/kibana/plugins/networkTopology
yarn dev --watch
```

### Setup page says “Recent data (last 1h): No data found” but `_count` is > 0

The plugin health checks look for **recent** documents. If you loaded sample data earlier, switch the time range to **Last 15 minutes** and/or regenerate sample data:

```bash
node scripts/generate_sample_data.mjs http://localhost:9200 elastic changeme
```

---

## Building for Production

### Build the plugin zip

```bash
cd /absolute/path/to/kibana/plugins/networkTopology
yarn build --kibana-version 8.19.12
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
│  Data stream: logs-snmp.topology-default             │
│  Ingest pipeline: snmp-device-enrichment             │
│  Index template: logs-snmp.topology@template         │
└──────────────────────────────────────────────────────┘
```

Document types written per SNMP poll cycle (one per device):

| Document type      | Key field                   | Data source                |
| ------------------ | --------------------------- | -------------------------- |
| Interface metrics  | `interface.name`            | IF-MIB ifTable             |
| ARP entries        | `arp.mac_addr`              | IP-MIB ipNetToMediaTable   |
| MAC table entries  | `mac_table.mac_addr`        | BRIDGE-MIB dot1dTpFdbTable |
| IP address entries | `ip_addr.address`           | IP-MIB ipAddrTable         |
| BGP peer sessions  | `bgp_peer.remote_ip`        | BGP4-MIB bgpPeerTable      |
| OSPF neighbors     | `ospf_neighbor.neighbor_ip` | OSPF-MIB ospfNbrTable      |

---

## License

Elastic License 2.0. See `LICENSE.txt`.

## Development policy

- License headers are required on source files. See `docs/license_headers.md`.
