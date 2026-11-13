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
- **Connections view** — Arkime-style force-directed relationship graph between any two aggregatable ECS fields (`source.ip` → `destination.ip` by default), sized by session volume, with click-to-inspect, 1-hop focus, field-pair pivoting, inline KQL filter buttons, and Security app deep links
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

# Optional: flow data for the Connections view (creates the `netflow-sample` index)
node scripts/generate_sample_flows.mjs
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

## Connections view

The **Connections** tab renders a force-directed graph of the relationship between
**any two aggregatable fields** in the selected data view — not just SNMP topology.
Pick a *field pair* and the server aggregates the top talkers into ready-to-render
nodes and links.

<!-- TODO: screenshot — connections graph with hub clustering and a scanner fan-out -->

**The field-pair concept.** Every graph is "left field → right field":

| Field pair                     | What you see                                        |
| ------------------------------ | --------------------------------------------------- |
| `source.ip` → `destination.ip` | Who talks to whom (default)                         |
| `client.ip` → `server.ip`      | Same, for datasets using the client/server pair     |
| `source.ip` → `destination.port` | Which services each host reaches — spots scanners |
| `host.name` → `destination.ip` | Egress per host                                     |
| `user.name` → `host.name`      | Which users touched which hosts                     |

The presets are shortcuts; both selectors are free-form, so any aggregatable
`ip`, `keyword`, or numeric field works. Switching the pair pivots the whole graph.

**How the aggregation works.** One `size: 0` search with nested `terms`
aggregations — top N values of the left field, then top M values of the right field
within each. Both levels use global ordinals. Node size scales with session count,
link width with the number of matching documents, and node colour shows whether a
value appeared on the left, the right, or both.

> `multi_terms` is deliberately **not** used here. It cannot use global ordinals and
> materializes a composite key for every left×right combination, which does not
> survive realistic flow volumes.

**Interactions**

- **Click** a node to open the detail flyout:
  - Node totals (sessions, bytes, packets, peer count) and role badge
  - Node title links directly to the Security app — IP addresses open the Network IP detail page (source or destination view), hostnames open Hosts, usernames open Users
  - Peer table with direction, session count, and bytes per link
  - **`+` / `−` filter buttons** on each peer row — adds a KQL `match_phrase` inclusion or exclusion filter to the search bar instantly; the graph re-fetches behind the open flyout so you can stack filters without closing it
  - Hide node, Focus, and Copy value actions
- **Focus** narrows the canvas to a node's 1-hop neighbourhood; **double-click** the background to clear focus and selection
- **Drag** a node to pin it in place (pins survive data refreshes); **Release pins** drops all pins and re-runs the layout
- Scroll to zoom, drag the background to pan
- **Show labels** toggle displays or hides node ID labels independently of zoom level
- Disconnected components (island pairs, isolated clusters) are automatically separated into distinct regions of the canvas on initial load

**Group by (diversity field).** Set the optional "Group by" field to disambiguate same-IP or same-hostname entities that actually belong to different network contexts (Docker bridges, overlapping VLANs, multi-tenant environments). When active, a three-level aggregation (`group → source → destination`) is used: source nodes are coloured by group value, destination nodes remain shared. Cross-group communication is naturally visible wherever two group-coloured nodes point at the same destination. Any aggregatable field works — `observer.hostname`, `network.site`, or a customer-specific tenant field are common choices.

**Limits.** `Top sources` and `Peers each` are clamped server-side (200 × 25). When
more pairs match than were returned, a callout says so — narrow the time range or
add a filter rather than raising the caps. `Max groups` has no hard cap — the
Elasticsearch `too_many_buckets_exception` error surfaces if the product of groups
× sources × peers is too large; lower any of the three limits to resolve it.

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
│  Connections Canvas → Node Flyout (field pivoting)   │
│  D3 force layout · Canvas 2D · Quadtree hit detect   │
│  Visibility toggles · BGP/OSPF/ARP link rendering    │
├──────────────────────────────────────────────────────┤
│ Server (server/)                                     │
│  Topology builder: ARP/MAC/BGP/OSPF adjacency        │
│  Connections builder: nested terms → nodes + links   │
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
