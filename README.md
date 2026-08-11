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

## Plugin Installation

### Supported Versions

Kibana / Elasticsearch **8.19.12+** and **9.0.0+**

> A single version of the plugin is compatible with all supported versions of Kibana. We don't distribute separate bundles for each stack version.

### Installation Instructions

> [!NOTE]
> The plugin depends on Kibana and Elasticsearch. Consult these [docs](https://www.elastic.co/docs/deploy-manage/deploy/self-managed) if you don't already have them setup. 

#### Pre-built bundle

1. Download the latest version of the plugin from the [releases section](https://github.com/elastic/kibana-network-topology-plugin/releases)
2. Un-zip the plugin bundle
3. Open the `kibana.json` manifest file included in the plugin bundle. You'll find it under `kibana/networkTopology/kibana.json`
4. Locate the `kibanaVersion` property and replace the placeholder value with your exact Kibana version. Save the file after the edit is done
5. Re-zip the whole plugin bundle. Be sure to keep the `kibana/networkTopology` folder hierarchy as it was, otherwise installation will fail.
6. Head over to your Kibana binaries. From the root of the Kibana folder run `bin/kibana-plugin install file:///absolute/path/to/networkTopology.zip`

#### Building from source

1. Clone Kibana

```bash
git clone https://github.com/elastic/kibana.git
cd kibana

# For a specific Kibana version, checkout a supported release tag, otherwise checkout main:
git checkout v8.19.12 # or: git checkout main
```

2. Clone the plugin into `kibana/plugins/`

```bash
cd plugins
git clone git@github.com:elastic/kibana-network-topology-plugin.git networkTopology
cd ..

nvm use
yarn kbn bootstrap
```

3. Build the plugin zip

```bash
cd plugins/networkTopology/
yarn build --kibana-version X.Y.Z # This version should match the version you're using in Kibana
```

Output: `build/networkTopology-X.Y.Z.zip`

The zip is self-contained — all `@kbn/*` dependencies and the compiled frontend bundle are included.

4. Install on a Kibana server

```bash
cd /absolute/path/to/kibana/binaries
bin/kibana-plugin install file:///absolute/path/to/networkTopology-X.Y.Z.zip
# Restart Kibana after installation
```

> **Version matching**: The version in the zip must exactly match the target Kibana instance version. Rebuild from the matching Kibana source tree when upgrading.

## Development Quick Start

### Prerequisites

- Node.js — use the version from the Kibana checkout’s `.nvmrc` / `.node-version` (supported Kibana versions: **8.19.12+** and **9.0.0+**)
- If you have [`nvm`](https://www.elastic.co/docs/extend/kibana/getting-started/set-up-a-development-environment#install-dependencies), it can take care of the correct versions/dependencies.
  - From `<kibana-repo-root>`, run `nvm install && npm install -g yarn`

This plugin lives **outside** the Kibana repository (separate repo + separate releases). Kibana’s dev tooling still expects the plugin under `<kibana-repo-root>/plugins/` so that relative scripts such as `../../scripts/plugin_helpers` resolve correctly.

### 1. Clone Kibana and checkout desired version/branch

```bash
git clone https://github.com/elastic/kibana.git
cd kibana

# For a specific Kibana version, checkout a supported release tag, or checkout main for latest:
git checkout v8.19.12 # or: git checkout main
```

You can consult [Kibana Dev Setup](https://www.elastic.co/docs/extend/kibana/getting-started/set-up-a-development-environment) docs for more information and options.

### 2. Add this plugin as a worktree under `<kibana-repo-root>/plugins/`

> [!NOTE]
> **git worktree** is preferred to clone a copy of the plugin as a separate branch within `<kibana-repo-root>/plugins/`. A symlink is not guaranteed to work).

From plugin's repo root (`<plugin-repo-root>`), branch a new worktree into `<kibana-repo-root>/plugins/`

```bash
git worktree add "<kibana-repo-root>/plugins/networkTopology" -b dev-local main
```

This creates the directory `<kibana-repo-root>/plugins/networkTopology`, which shares the same git tracking and history as the plugin's cloned repo.
That means commits from within this directory will belong to plugin repo's branch `dev-local`, which can be pushed/merged as normal.

Note that the command format is  `git worktree add "<target-directory>" -b <new-branch-name> <base-branch>` so the branch or base branch can be changed as desired.
`git worktree remove "<target-directory>"` will remove the directory/worktree.

### 3. Bootstrap Kibana (once, after the worktree exists)

```bash
cd /absolute/path/to/kibana
nvm use
yarn kbn bootstrap
```

### 4. Start Elasticsearch

```bash
# From the Kibana repo root
yarn es snapshot --license trial
```

### 5. Set up Elasticsearch resources + load sample data

```bash
# From Kibana root, cd into `plugins/networkTopology` (pwd should point to </absolute/path/to/kibana>/plugins/networkTopology)
chmod +x scripts/setup_elasticsearch.sh
./scripts/setup_elasticsearch.sh

node scripts/generate_sample_data.mjs
```

> Note: `scripts/setup_elasticsearch.sh` and the data generators default to:
>
> - Elasticsearch URL: `http://localhost:9200`
> - credentials: `elastic / changeme`

### 6. Start Kibana + build the plugin UI bundle (two terminals)

(From Kibana root) start Kibana in one terminal:

```bash
# From the Kibana repo root
yarn start --no-base-path
```

In a second terminal, from Kibana root, cd into plugins/networkTopology (pwd should point to </absolute/path/to/kibana>/plugins/networkTopology). 
And build the plugin UI bundle in watch mode (required so Kibana can serve `networkTopology.plugin.js`):

```bash
yarn dev --watch
```

### 7. Open in browser

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
