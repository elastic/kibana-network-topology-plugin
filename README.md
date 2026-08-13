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
> The plugin depends on Kibana and Elasticsearch. If you do not already have a running stack, see the [self-managed deployment docs](https://www.elastic.co/docs/deploy-manage/deploy/self-managed). For day-to-day plugin development, prefer the [Development Quick Start](#development-quick-start) below (Kibana’s `yarn es` / `yarn start` workflow).

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

# For a specific Kibana version, check out a supported release tag; otherwise use main:
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

- Node.js — match the version in the Kibana checkout’s `.nvmrc` / `.node-version` (supported Kibana versions: **8.19.12+** and **9.0.0+**)
- Optional: [`nvm`](https://github.com/nvm-sh/nvm) — after cloning Kibana, from `<kibana-repo-root>` run `nvm install && nvm use`, then install Yarn classic if needed (`npm install -g yarn`)

See also Elastic’s [Kibana development environment](https://www.elastic.co/docs/extend/kibana/getting-started/set-up-a-development-environment) guide.

This plugin lives **outside** the Kibana repository (separate repo + separate releases). Kibana’s dev tooling still expects it under `<kibana-repo-root>/plugins/` so relative scripts such as `../../scripts/plugin_helpers` resolve correctly.

### 1. Clone Kibana and check out the desired version/branch

```bash
git clone https://github.com/elastic/kibana.git
cd kibana

# For a specific Kibana version, check out a supported release tag; otherwise use main:
git checkout v8.19.12 # or: git checkout main
```

### 2. Add this plugin as a git worktree under `<kibana-repo-root>/plugins/`

> [!NOTE]
> Use a **git worktree** (not a symlink). A symlink under `plugins/networkTopology` is not reliable: Node resolves `../../scripts/plugin_helpers` from the realpath of the linked directory, so `yarn` looks outside the Kibana tree and fails.

If you do not already have a clone of this plugin:

```bash
git clone https://github.com/elastic/kibana-network-topology-plugin.git
cd kibana-network-topology-plugin
```

From the plugin repo root (`<plugin-repo-root>`), add a worktree into Kibana’s `plugins/` directory:

```bash
# Creates branch `dev-local` from `main` and checks it out at the target path
git worktree add "<kibana-repo-root>/plugins/networkTopology" -b dev-local main
```

That directory shares the same Git object database as `<plugin-repo-root>`. Commits made there land on branch `dev-local` and can be pushed/merged like any other branch.

Tips:

- Command shape: `git worktree add "<target-directory>" -b <new-branch> <base-commit-ish>`
- If `dev-local` already exists: `git worktree add "<kibana-repo-root>/plugins/networkTopology" dev-local`
- To remove later: `git worktree remove "<kibana-repo-root>/plugins/networkTopology"`
- Prefer working inside the worktree path for `yarn` commands so `pwd -P` resolves under Kibana (not the standalone clone)

### 3. Bootstrap Kibana (once, after the worktree exists)

```bash
cd "<kibana-repo-root>"
nvm use   # if you use nvm
yarn kbn bootstrap
```

### 4. Start Elasticsearch

```bash
# From <kibana-repo-root>
yarn es snapshot --license trial
```

### 5. Set up Elasticsearch resources + load sample data

```bash
cd "<kibana-repo-root>/plugins/networkTopology"
chmod +x scripts/setup_elasticsearch.sh
./scripts/setup_elasticsearch.sh

node scripts/generate_sample_data.mjs
```

> Note: `scripts/setup_elasticsearch.sh` and the data generators default to:
>
> - Elasticsearch URL: `http://localhost:9200`
> - credentials: `elastic` / `changeme`

### 6. Start Kibana + build the plugin UI bundle (two terminals)

Terminal A — Kibana:

```bash
cd "<kibana-repo-root>"
yarn start --no-base-path
```

Terminal B — plugin UI bundle in watch mode (required so Kibana can serve `networkTopology.plugin.js`):

```bash
cd "<kibana-repo-root>/plugins/networkTopology"
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
cd "<kibana-repo-root>/plugins/networkTopology"
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
