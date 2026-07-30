# Connections View — Implementation Plan

Arkime-style entity relationship graph for the Network Topology Kibana plugin
(`elastic/kibana-network-topology-plugin`). Renders a force-directed graph of
relationships between two configurable ECS fields (default: `source.ip` ↔
`destination.ip`) aggregated from event/flow indices, with node sizing by
volume, click-to-inspect, and field-pair pivoting.

## Context and prior art

This replaces a Vega PoC that validated the data model but failed on rendering.
Lessons that are now hard requirements:

1. **Never use `multi_terms`** for the pair aggregation. It cannot use global
   ordinals and materializes composite keys for every src×dst combination —
   it caused ES socket hang-ups (~5s to node distress) on realistic flow data.
   Use nested `terms` (top-N sources → top-M destinations per source). Both
   levels use global ordinals and the semantics ("top talkers") are correct
   for this view.
2. **Own the tick→draw path.** The graph must be a d3-force simulation
   rendering directly to canvas per tick. No declarative dataflow between the
   simulation and the pixels.
3. Server shapes the graph; client only renders. The API returns ready
   `nodes[]` / `links[]`, not raw agg buckets.

## What already exists to reuse

- `public/components/topology_canvas.tsx` — canvas scaffolding to imitate (not
  necessarily share code with, for MVP): dual base/overlay canvas, `d3-zoom`
  pan/zoom with `transformRef`, `d3-quadtree` hit detection, drag overrides
  map, 15fps-throttled overlay animation, DPR handling. The Connections canvas
  should be a **sibling component** (`connections_canvas.tsx`) copying these
  patterns; extracting a shared canvas engine is a follow-up refactor, not MVP.
- `d3-force@^3.0.0` is already a dependency with type declarations in
  `public/types/vendor.d.ts` — currently unused. This view is its first
  consumer. Verify the vendor typings cover `forceSimulation`, `forceLink`,
  `forceManyBody`, `forceCollide`, `forceCenter`, `forceX/forceY`; extend if
  needed.
- Server route conventions: `server/routes/topology.ts` (route registration
  shape), `server/routes/route_security.ts` (apply the same security wrapper),
  `server/services/topology_builder.ts` (typed `esClient.search` + aggs
  patterns, size caps).
- `common/constants.ts`: `API_BASE`, `API_ROUTES` (add `CONNECTIONS`),
  `DEFAULT_NETFLOW_INDEX` already exists — use it in the default index
  pattern list alongside `logs-*`.
- `public/pages/app.tsx`: `ViewMode` tab union — add `'connections'`.
- `public/hooks/use_data_view_selector.ts`, `use_api.ts`,
  `public/services/api_client.ts` — extend, don't duplicate.
- `public/components/device_flyout.tsx` — pattern reference for the node
  detail flyout (EUI flyout, section layout).
- License headers required on all new files (see `docs/license_headers.md`).

## MVP scope

### 1. Common (`common/`)

Add to `common/types.ts`:

```ts
export interface ConnectionsNode {
  id: string;            // field value, e.g. "10.1.2.3"
  role: 'source' | 'target' | 'both';
  sessions: number;      // total doc_count across links touching this node
  bytes?: number;
  packets?: number;
  degree: number;        // number of links
}

export interface ConnectionsLink {
  id: string;            // `${source}→${target}`
  source: string;        // ConnectionsNode.id
  target: string;
  sessions: number;
  bytes?: number;
  packets?: number;
}

export interface ConnectionsGraph {
  nodes: ConnectionsNode[];
  links: ConnectionsLink[];
  truncated: boolean;    // true if source or fanout caps were hit
  took: number;
}

export interface ConnectionsRequest {
  index: string;
  srcField: string;      // default 'source.ip'
  dstField: string;      // default 'destination.ip'
  from: string;
  to: string;
  query?: string;        // optional KQL, parsed server-side or passed as query_string
  maxSources: number;    // default 50, cap 200
  maxDstPerSource: number; // default 10, cap 25
  minSessions: number;   // default 1 (client may also filter locally)
}
```

Add to `common/constants.ts`:

```ts
export const API_ROUTES = { ...existing, CONNECTIONS: `${API_BASE}/connections` };

export const CONNECTION_FIELD_PRESETS: Array<{label: string; src: string; dst: string}> = [
  { label: 'Source IP → Destination IP', src: 'source.ip', dst: 'destination.ip' },
  { label: 'Client IP → Server IP',      src: 'client.ip', dst: 'server.ip' },
  { label: 'Source IP → Destination Port', src: 'source.ip', dst: 'destination.port' },
  { label: 'Host → Destination IP',      src: 'host.name', dst: 'destination.ip' },
  { label: 'User → Host',                src: 'user.name', dst: 'host.name' },
];
```

Presets are conveniences; the two field selectors remain free-form (any
aggregatable keyword/ip/numeric field), which is the Arkime-style pivot.

### 2. Server (`server/`)

New `server/services/connections_builder.ts`:

- `buildConnectionsGraph(esClient, req: ConnectionsRequest): ConnectionsGraph`
- Single `esClient.search`, `size: 0`, `@timestamp` range filter + optional
  query, agg shape:

```
aggs.src:  terms(srcField, size=maxSources, order=_count desc)
  aggs.dst: terms(dstField, size=maxDstPerSource, order=_count desc)
    aggs.bytes:   sum(network.bytes)    // tolerate missing field
    aggs.packets: sum(network.packets)
```

- Flatten to links; derive nodes (union of endpoints, summed metrics, role
  from src/dst membership, degree). Drop links below `minSessions`
  server-side. Set `truncated` if `sum_other_doc_count > 0` at either level.
- Numeric fields (e.g. `destination.port`) come back as numbers — coerce node
  ids to strings.
- Unit-test the bucket→graph transform with fixture agg responses (no ES
  needed): role derivation, metric summation, truncation flag, min-session
  filtering, numeric field coercion.

New `server/routes/connections.ts`, registered in `server/routes/index.ts`,
following the `route_security.ts` pattern of the existing routes. Validate
params with `@kbn/config-schema`; clamp `maxSources`/`maxDstPerSource` to hard
caps regardless of client input.

### 3. Client (`public/`)

**Tab and page.** Add `'connections'` to `ViewMode` in `app.tsx`; new
`public/pages/connections_view.tsx` modeled on `topology_view.tsx`: controls
bar + canvas + flyout, fetch on control change with loading/error/empty
states (EUI patterns already in the codebase).

**Controls bar** (EUI, one row + collapsible advanced):

- Index pattern selector — reuse `use_data_view_selector`.
- Field pair: preset dropdown + two `EuiComboBox`es populated from the field
  caps of the selected index (filter to aggregatable `ip`, `keyword`, and
  numeric types). Preset selection fills the comboboxes; manual edits switch
  preset to "Custom".
- Time range (reuse existing from/to handling in the app).
- Query size (`maxSources`) and Min sessions number inputs.
- Optional KQL bar if `topology_view` already wires one; otherwise defer.

**`public/components/connections_canvas.tsx`** — the core deliverable:

- Props: `graph: ConnectionsGraph`, `width`, `height`,
  `onNodeClick(nodeId)`, `selectedNodeId`, `animationsDisabled`.
- d3-force simulation: `forceLink` (id accessor, distance ~60,
  strength scaled down for high-degree nodes), `forceManyBody`
  (strength ~ -80), `forceCollide` (radius = nodeRadius + 2), `forceX/forceY`
  weak centering (better than `forceCenter` for disconnected components —
  flow data always has islands).
- Node radius: `clamp(4 + sqrt(sessions) * k, 4, 26)`; link width
  `clamp(sqrt(sessions), 1, 6)`; colors by role — reuse the plugin's existing
  palette conventions (see `DEVICE_TYPE_CONFIG`/`STATUS_COLORS` usage) with
  three role colors + selected/hover states.
- Render on `simulation.on('tick')` directly to the base canvas (clear,
  draw links, draw nodes, draw labels). Labels: only render when
  `zoom scale > threshold` OR node radius > threshold — cheap and keeps large
  graphs legible (this was a major perf lesson from the PoC).
- Rebuild quadtree on tick end (or every N ticks) for hit detection; reuse
  the pointer→graph coordinate transform approach from `topology_canvas.tsx`.
- Drag: on drag start set `fx/fy` and `simulation.alphaTarget(0.3)`; on end
  release (or keep pinned — add a "release pins" button). Zoom/pan via
  `d3-zoom` exactly as the topology canvas does.
- Freeze: when `alpha < alphaMin` the sim stops naturally; on prop changes
  (new graph) restart with `alpha(1)`. When `animationsDisabled`, run
  `sim.stop()` + `sim.tick(300)` synchronously and draw once — same visual
  contract as the topology canvas's flag.
- Perf budget: smooth at 500 nodes / 1,000 links on a mid laptop. Hard cap
  incoming graph client-side as a safety net and show a truncation callout
  when `graph.truncated`.

**Node interaction (MVP):**

- Click → selection + right-side flyout (pattern from `device_flyout.tsx`):
  node value, role, sessions/bytes/packets, degree, and a top-peers table
  derived client-side from the link list. Buttons: "Hide node" (client-side
  set, like the existing `hiddenTypes` mechanism), "Focus" (client-side
  filter to the node's 1-hop neighborhood + restart sim), and "Copy value".
- Double-click on canvas background → clear focus/selection.

### 4. Sample data + docs

- Extend `scripts/generate_sample_data.mjs` (or add
  `generate_sample_flows.mjs`) to emit a few thousand ECS flow-ish docs
  (`source.ip`, `destination.ip`, `destination.port`, `network.bytes`,
  `network.packets`, `@timestamp`) with a realistic shape: a few hub nodes,
  scanner-like fan-out from one IP, and isolated pairs — this makes the
  layout's clustering visibly meaningful in demos.
- README: new Features bullet + a short "Connections view" section with a
  screenshot placeholder and the field-pair concept.

## Implementation phases (suggested commit sequence)

1. **Types + server**: `common` additions, `connections_builder.ts` with unit
   tests against fixture agg responses, route + registration. Verify with
   `curl` against sample data before touching UI.
2. **Client plumbing**: `api_client.ts` method, tab, `connections_view.tsx`
   with controls fetching and rendering a debug `<pre>` of the graph.
3. **Canvas**: `connections_canvas.tsx` with force sim, zoom/pan, hit
   detection, drag. This is the highest-risk phase; land it with click
   selection only.
4. **Flyout + polish**: node flyout, hide/focus, truncation callout,
   empty/error states, sample data generator, README.

## Non-goals (MVP) — note as follow-ups in the PR description

- Transform-backed pair entity index for large/long-window queries (the
  nested-terms query is interactive-fast; the transform is the scale story).
- Saved connection views / URL state serialization.
- GeoIP/ASN enrichment and group-by-subnet clustering.
- Dashboard embeddable.
- Cross-linking topology view ↔ connections view (e.g. "show flows for this
  device") — high-value fast-follow since both views share IP identity.

## Conventions checklist for the PR

- Elastic License 2.0 headers on every new file (`docs/license_headers.md`).
- Follow `route_security.ts` for the new route.
- Match existing EUI usage and the `ViewMode` tab pattern; no new UI deps.
- No new runtime dependencies at all — d3-force/d3-zoom/d3-quadtree are
  already present.
- Keep `connections_canvas.tsx` self-contained; do not refactor
  `topology_canvas.tsx` in this PR.
- Hard server-side caps on agg sizes regardless of request params.