/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EuiBadge,
  EuiButtonEmpty,
  EuiCallOut,
  EuiComboBox,
  EuiEmptyPrompt,
  EuiFieldNumber,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiIconTip,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiSwitch,
  EuiText,
} from '@elastic/eui';
import type { Filter, Query } from '@kbn/es-query';
import type { DataPublicPluginStart } from '@kbn/data-plugin/public';
import type { UnifiedSearchPublicPluginStart } from '@kbn/unified-search-plugin/public';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { CoreStart } from '@kbn/core/public';
import { useApi } from '../hooks/use_api';
import { useDataViewSelector } from '../hooks/use_data_view_selector';
import type { ConnectionsGraph } from '../../common';
import {
  CONNECTION_FIELD_PRESETS,
  CONNECTION_ROLE_COLORS,
  CONNECTIONS_DEFAULTS,
  CONNECTIONS_LIMITS,
} from '../../common';
import { ConnectionsCanvas } from '../components/connections_canvas';
import { ConnectionNodeFlyout } from '../components/connection_node_flyout';
import { formatCount } from '../utils/format';
import { buildGroupColorMap } from '../utils/group_colors';

// Matches topology_view: above this size animations auto-disable to protect
// against perf cliffs. Users can always override via the toolbar switch.
const LARGE_GRAPH_NODE_THRESHOLD = 300;
// Safety net on top of the server-side caps — a 200 × 25 request can legitimately
// return ~5,000 links, which is past what the canvas is budgeted for.
const MAX_RENDER_NODES = 1200;
const MAX_RENDER_LINKS = 2000;
// Field and size controls fetch as you change them; this collapses keystrokes
// into a single request.
const FETCH_DEBOUNCE_MS = 300;
const CANVAS_HEIGHT = 700;

/** Kibana field types that can back a `terms` aggregation for this view. */
const PIVOTABLE_FIELD_TYPES = new Set(['ip', 'string', 'number']);

const CUSTOM_PRESET = 'custom';

interface Props {
  from: string;
  to: string;
  refreshKey: number;
}

type KibanaServices = CoreStart & {
  data: DataPublicPluginStart;
  unifiedSearch: UnifiedSearchPublicPluginStart;
};

export const ConnectionsView: React.FC<Props> = ({ from, to, refreshKey }) => {
  const api = useApi();
  const { services } = useKibana<KibanaServices>();
  const SearchBar = services.unifiedSearch.ui.SearchBar;
  const getSecurityUrl = useCallback(
    (path: string) => services.application.getUrlForApp('security', { path }),
    [services.application]
  );
  const { selectedDataView, savedDataViews, onChangeDataView } = useDataViewSelector();

  const [srcField, setSrcField] = useState<string>(CONNECTIONS_DEFAULTS.srcField);
  const [dstField, setDstField] = useState<string>(CONNECTIONS_DEFAULTS.dstField);
  const [maxSources, setMaxSources] = useState<number>(CONNECTIONS_DEFAULTS.maxSources);
  const [maxDstPerSource, setMaxDstPerSource] = useState<number>(
    CONNECTIONS_DEFAULTS.maxDstPerSource
  );
  const [minSessions, setMinSessions] = useState<number>(CONNECTIONS_DEFAULTS.minSessions);
  const [groupField, setGroupField] = useState<string>('');
  const [maxGroups, setMaxGroups] = useState<number>(CONNECTIONS_DEFAULTS.maxGroups);

  // query drives the SearchBar display; submittedQuery drives the actual fetch
  const [query, setQuery] = useState<Query>({ language: 'kuery', query: '' });
  const [submittedQuery, setSubmittedQuery] = useState<Query>({ language: 'kuery', query: '' });
  const [filters, setFilters] = useState<Filter[]>([]);

  const [graph, setGraph] = useState<ConnectionsGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());
  // null = follow auto (off on large graphs, on otherwise). true/false = explicit user choice.
  const [animationsUserPref, setAnimationsUserPref] = useState<boolean | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [releasePinsKey, setReleasePinsKey] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Read the initial width immediately (ResizeObserver fires async)
    const initial = el.getBoundingClientRect().width;
    if (initial) setCanvasWidth(Math.floor(initial));
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setCanvasWidth(Math.floor(w));
    });
    obs.observe(el);
    return () => obs.disconnect();
    // Re-runs once a graph arrives and the container div is actually in the DOM.
  }, [graph]);

  const indexPattern = selectedDataView?.getIndexPattern();
  const kql = typeof submittedQuery.query === 'string' ? submittedQuery.query : '';
  const filtersJson = filters.length > 0 ? JSON.stringify(filters) : undefined;

  useEffect(() => {
    if (!srcField || !dstField) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .fetchConnections({
          index: indexPattern,
          srcField,
          dstField,
          from,
          to,
          kql: kql || undefined,
          filters: filtersJson,
          maxSources: Math.min(Math.max(1, maxSources), CONNECTIONS_LIMITS.maxSources),
          maxDstPerSource: Math.min(
            Math.max(1, maxDstPerSource),
            CONNECTIONS_LIMITS.maxDstPerSource
          ),
          minSessions: Math.max(1, minSessions),
          groupField: groupField || undefined,
          maxGroups: Math.max(1, maxGroups),
        })
        .then((g) => {
          if (cancelled) return;
          setGraph(g);
          setError(null);
          setLoading(false);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e.body?.message ?? e.message);
          setLoading(false);
        });
    }, FETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    api,
    indexPattern,
    srcField,
    dstField,
    from,
    to,
    kql,
    filtersJson,
    maxSources,
    maxDstPerSource,
    minSessions,
    groupField,
    maxGroups,
    refreshKey,
  ]);

  // Any new field pair or group change is a different graph — stale focus/hide/selection
  // would silently filter the new result.
  useEffect(() => {
    setSelectedNodeId(null);
    setFocusNodeId(null);
    setHiddenNodes(new Set());
  }, [srcField, dstField, groupField, indexPattern]);

  const fieldOptions = useMemo(() => {
    const fields = selectedDataView?.fields ?? [];
    return fields
      .filter((f) => f.aggregatable && PIVOTABLE_FIELD_TYPES.has(f.type) && !f.name.startsWith('_'))
      .map((f) => ({ label: f.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [selectedDataView]);

  // Derived rather than stored, so a manual field edit can't desync the dropdown.
  const presetValue = useMemo(() => {
    const i = CONNECTION_FIELD_PRESETS.findIndex((p) => p.src === srcField && p.dst === dstField);
    return i === -1 ? CUSTOM_PRESET : String(i);
  }, [srcField, dstField]);

  const onPresetChange = useCallback((value: string) => {
    const preset = CONNECTION_FIELD_PRESETS[Number(value)];
    if (!preset) return;
    setSrcField(preset.src);
    setDstField(preset.dst);
  }, []);

  const handleAddFilter = useCallback((field: string, value: string, negate: boolean) => {
    setFilters((prev) => [
      ...prev,
      {
        meta: {
          type: 'phrase',
          key: field,
          negate,
          disabled: false,
          alias: null,
          params: { query: value },
        },
        query: { match_phrase: { [field]: value } },
      } as Filter,
    ]);
  }, []);

  const handleNodeClick = useCallback((id: string) => setSelectedNodeId(id), []);
  const handleBackgroundReset = useCallback(() => {
    setSelectedNodeId(null);
    setFocusNodeId(null);
  }, []);
  const toggleHide = useCallback((id: string) => {
    setHiddenNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleFocus = useCallback(
    (id: string) => setFocusNodeId((prev) => (prev === id ? null : id)),
    []
  );

  // Focus → hide → cap, in that order: the operator's intent first, the safety
  // net last.
  const displayed = useMemo(() => {
    if (!graph) return null;
    let nodes = graph.nodes;
    let links = graph.links;

    if (focusNodeId) {
      const neighbourhood = new Set<string>([focusNodeId]);
      for (const l of links) {
        if (l.source === focusNodeId) neighbourhood.add(l.target);
        else if (l.target === focusNodeId) neighbourhood.add(l.source);
      }
      nodes = nodes.filter((n) => neighbourhood.has(n.id));
      links = links.filter((l) => neighbourhood.has(l.source) && neighbourhood.has(l.target));
    }

    if (hiddenNodes.size > 0) {
      nodes = nodes.filter((n) => !hiddenNodes.has(n.id));
      links = links.filter((l) => !hiddenNodes.has(l.source) && !hiddenNodes.has(l.target));
    }

    let capped = false;
    if (links.length > MAX_RENDER_LINKS || nodes.length > MAX_RENDER_NODES) {
      capped = true;
      // The server returns both lists busiest-first, so slicing keeps the
      // most significant part of the graph.
      links = links.slice(0, MAX_RENDER_LINKS);
      const linked = new Set<string>();
      for (const l of links) {
        linked.add(l.source);
        linked.add(l.target);
      }
      nodes = nodes.filter((n) => linked.has(n.id)).slice(0, MAX_RENDER_NODES);
      const kept = new Set(nodes.map((n) => n.id));
      links = links.filter((l) => kept.has(l.source) && kept.has(l.target));
    }

    return { graph: { ...graph, nodes, links }, capped };
  }, [graph, focusNodeId, hiddenNodes]);

  // From the unfiltered graph, so the flyout still works for a hidden node.
  const selectedNode = useMemo(
    () => (selectedNodeId ? graph?.nodes.find((n) => n.id === selectedNodeId) : undefined),
    [graph, selectedNodeId]
  );

  const dataViewPickerProps = {
    trigger: {
      label: selectedDataView?.getName() ?? 'Select data view',
      title: selectedDataView?.getIndexPattern() ?? '',
    },
    currentDataViewId: selectedDataView?.id,
    savedDataViews,
    onChangeDataView,
  };

  const isLargeGraph = (displayed?.graph.nodes.length ?? 0) >= LARGE_GRAPH_NODE_THRESHOLD;
  const animationsDisabled = animationsUserPref ?? isLargeGraph;

  // When a groupField is active, build the group→colour map for the legend.
  const groupColorMap = useMemo(
    () => (graph && groupField ? buildGroupColorMap(graph.nodes) : new Map<string, string>()),
    [graph, groupField]
  );

  return (
    <div style={{ alignSelf: 'flex-start', width: '100%' }}>
      <SearchBar
        appName="networkTopology"
        useDefaultBehaviors={false}
        indexPatterns={selectedDataView ? [selectedDataView] : []}
        query={query}
        filters={filters}
        showDatePicker={false}
        showFilterBar={true}
        showQueryInput={true}
        showSubmitButton={true}
        displayStyle="inPage"
        placeholder="Filter events… (e.g. network.transport:tcp)"
        dataViewPickerComponentProps={dataViewPickerProps}
        onQueryChange={({ query: q }) => {
          // Update SearchBar display only — do not fetch until submitted
          if (q) setQuery(q as Query);
        }}
        onQuerySubmit={({ query: q }) => {
          const committed = (q as Query) ?? query;
          setQuery(committed);
          setSubmittedQuery(committed);
        }}
        onFiltersUpdated={setFilters}
      />

      <EuiSpacer size="m" />

      <EuiFlexGroup gutterSize="m" alignItems="flexEnd" wrap>
        <EuiFlexItem grow={false} style={{ minWidth: 220 }}>
          <EuiFormRow label="Field pair" display="rowCompressed">
            <EuiSelect
              compressed
              value={presetValue}
              onChange={(e) => onPresetChange(e.target.value)}
              options={[
                ...CONNECTION_FIELD_PRESETS.map((p, i) => ({ value: String(i), text: p.label })),
                { value: CUSTOM_PRESET, text: 'Custom' },
              ]}
              aria-label="Field pair preset"
            />
          </EuiFormRow>
        </EuiFlexItem>

        <EuiFlexItem grow={false} style={{ minWidth: 220 }}>
          <EuiFormRow label="From field" display="rowCompressed">
            <EuiComboBox
              compressed
              singleSelection={{ asPlainText: true }}
              isClearable={false}
              options={fieldOptions}
              selectedOptions={srcField ? [{ label: srcField }] : []}
              onChange={(opts) => setSrcField(opts[0]?.label ?? '')}
              onCreateOption={(value) => setSrcField(value.trim())}
              placeholder="source.ip"
              aria-label="Source field"
            />
          </EuiFormRow>
        </EuiFlexItem>

        <EuiFlexItem grow={false} style={{ minWidth: 220 }}>
          <EuiFormRow label="To field" display="rowCompressed">
            <EuiComboBox
              compressed
              singleSelection={{ asPlainText: true }}
              isClearable={false}
              options={fieldOptions}
              selectedOptions={dstField ? [{ label: dstField }] : []}
              onChange={(opts) => setDstField(opts[0]?.label ?? '')}
              onCreateOption={(value) => setDstField(value.trim())}
              placeholder="destination.ip"
              aria-label="Destination field"
            />
          </EuiFormRow>
        </EuiFlexItem>

        <EuiFlexItem grow={false} style={{ width: 130 }}>
          <EuiFormRow
            label="Top sources"
            display="rowCompressed"
            labelAppend={
              <EuiIconTip
                type="questionInCircle"
                color="subdued"
                content={`Highest-volume values of the "from" field to expand. Max ${CONNECTIONS_LIMITS.maxSources}.`}
                aria-label="About top sources"
              />
            }
          >
            <EuiFieldNumber
              compressed
              min={1}
              max={CONNECTIONS_LIMITS.maxSources}
              value={maxSources}
              onChange={(e) => setMaxSources(Number(e.target.value))}
            />
          </EuiFormRow>
        </EuiFlexItem>

        <EuiFlexItem grow={false} style={{ width: 130 }}>
          <EuiFormRow
            label="Peers each"
            display="rowCompressed"
            labelAppend={
              <EuiIconTip
                type="questionInCircle"
                color="subdued"
                content={`Destinations kept per source. Max ${CONNECTIONS_LIMITS.maxDstPerSource}.`}
                aria-label="About peers per source"
              />
            }
          >
            <EuiFieldNumber
              compressed
              min={1}
              max={CONNECTIONS_LIMITS.maxDstPerSource}
              value={maxDstPerSource}
              onChange={(e) => setMaxDstPerSource(Number(e.target.value))}
            />
          </EuiFormRow>
        </EuiFlexItem>

        <EuiFlexItem grow={false} style={{ width: 130 }}>
          <EuiFormRow label="Min sessions" display="rowCompressed">
            <EuiFieldNumber
              compressed
              min={1}
              value={minSessions}
              onChange={(e) => setMinSessions(Number(e.target.value))}
            />
          </EuiFormRow>
        </EuiFlexItem>

        <EuiFlexItem grow={false} style={{ minWidth: 220 }}>
          <EuiFormRow
            label="Group by"
            display="rowCompressed"
            labelAppend={
              <EuiIconTip
                type="questionInCircle"
                color="subdued"
                content="Disambiguate same-IP or same-hostname entities across different contexts (e.g. observer.hostname, network.site). Source nodes are coloured by group value."
                aria-label="About group by"
              />
            }
          >
            <EuiComboBox
              compressed
              singleSelection={{ asPlainText: true }}
              isClearable={true}
              options={fieldOptions}
              selectedOptions={groupField ? [{ label: groupField }] : []}
              onChange={(opts) => setGroupField(opts[0]?.label ?? '')}
              onCreateOption={(value) => setGroupField(value.trim())}
              placeholder="None (optional)"
              aria-label="Group by field"
            />
          </EuiFormRow>
        </EuiFlexItem>

        {groupField && (
          <EuiFlexItem grow={false} style={{ width: 130 }}>
            <EuiFormRow
              label="Max groups"
              display="rowCompressed"
              labelAppend={
                <EuiIconTip
                  type="questionInCircle"
                  color="subdued"
                  content="Top-K group values retained. Large values may trigger an Elasticsearch circuit-breaker; lower this or reduce sources/peers if you see an error."
                  aria-label="About max groups"
                />
              }
            >
              <EuiFieldNumber
                compressed
                min={1}
                value={maxGroups}
                onChange={(e) => setMaxGroups(Number(e.target.value))}
              />
            </EuiFormRow>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      {groupField && maxGroups * maxSources * maxDstPerSource > 10_000 && (
        <>
          <EuiCallOut
            title="Large aggregation — expect slow queries or Elasticsearch circuit-breaker errors"
            color="warning"
            size="s"
          >
            <p>
              {maxGroups} groups × {maxSources} sources × {maxDstPerSource} peers ={' '}
              {(maxGroups * maxSources * maxDstPerSource).toLocaleString()} potential buckets.
              Lower the limits or narrow the time range before fetching.
            </p>
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}

      {error && (
        <>
          <EuiCallOut title="Could not build the connections graph" color="danger">
            <p>{error}</p>
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}

      {displayed?.graph.truncated && (
        <>
          <EuiCallOut
            title={`Showing the top ${Math.min(
              maxSources,
              CONNECTIONS_LIMITS.maxSources
            )} sources and ${Math.min(
              maxDstPerSource,
              CONNECTIONS_LIMITS.maxDstPerSource
            )} peers each`}
            color="warning"
            size="s"
          >
            <p>
              More pairs matched than were returned. Raise the limits, narrow the time range, or add
              a filter to see the rest.
            </p>
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}

      {displayed?.capped && (
        <>
          <EuiCallOut
            title={`Rendering the busiest ${MAX_RENDER_LINKS.toLocaleString()} connections`}
            color="primary"
            size="s"
          >
            <p>The response was larger than the canvas budget. Lower the limits for a full view.</p>
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}

      {loading && !displayed && (
        <EuiFlexGroup justifyContent="center" style={{ minHeight: 400 }}>
          <EuiFlexItem grow={false}>
            <EuiLoadingSpinner size="xl" />
            <EuiSpacer size="s" />
            <EuiText size="s" textAlign="center">
              Aggregating {srcField} → {dstField}…
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      )}

      {displayed && displayed.graph.nodes.length === 0 && (
        <EuiEmptyPrompt
          iconType="graphApp"
          title={<h2>No connections found</h2>}
          body={
            <p>
              Nothing matched <strong>{srcField}</strong> → <strong>{dstField}</strong> on{' '}
              <strong>{indexPattern ?? 'the default indices'}</strong> in this time range. Check the
              field pair, widen the time range, or lower <strong>Min sessions</strong>.
            </p>
          }
        />
      )}

      {displayed && displayed.graph.nodes.length > 0 && (
        <>
          <EuiFlexGroup alignItems="center" gutterSize="m" responsive={false} wrap>
            <EuiFlexItem grow={false}>
              <EuiText size="s" color="subdued">
                {formatCount(displayed.graph.nodes.length)} nodes ·{' '}
                {formatCount(displayed.graph.links.length)} connections · {displayed.graph.took}ms
              </EuiText>
            </EuiFlexItem>
            {loading && (
              // Refetches keep the current graph on screen, so this is the only
              // signal that a control change is in flight.
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="s" />
              </EuiFlexItem>
            )}
            {focusNodeId && (
              <EuiFlexItem grow={false}>
                <EuiBadge
                  color="accent"
                  iconType="cross"
                  iconSide="right"
                  iconOnClick={() => setFocusNodeId(null)}
                  iconOnClickAriaLabel="Clear focus"
                >
                  Focused: {focusNodeId}
                </EuiBadge>
              </EuiFlexItem>
            )}
            {hiddenNodes.size > 0 && (
              <EuiFlexItem grow={false}>
                <EuiBadge
                  color="default"
                  iconType="cross"
                  iconSide="right"
                  iconOnClick={() => setHiddenNodes(new Set())}
                  iconOnClickAriaLabel="Show hidden nodes"
                >
                  {hiddenNodes.size} hidden
                </EuiBadge>
              </EuiFlexItem>
            )}
            <EuiFlexItem />
            <EuiFlexItem grow={false}>
              <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
                {groupColorMap.size > 0
                  ? // Group-coloured legend: one badge per group value + destination
                    [...groupColorMap.entries()].map(([g, color]) => (
                      <EuiFlexItem grow={false} key={g}>
                        <EuiBadge color={color}>{g}</EuiBadge>
                      </EuiFlexItem>
                    )).concat(
                      <EuiFlexItem grow={false} key="destination">
                        <EuiBadge color={CONNECTION_ROLE_COLORS.destination}>destination</EuiBadge>
                      </EuiFlexItem>
                    )
                  : // Standard role legend
                    (['source', 'both', 'destination'] as const).map((role) => (
                      <EuiFlexItem grow={false} key={role}>
                        <EuiBadge color={CONNECTION_ROLE_COLORS[role]}>{role}</EuiBadge>
                      </EuiFlexItem>
                    ))}
              </EuiFlexGroup>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty
                size="s"
                iconType="refresh"
                onClick={() => setReleasePinsKey((k) => k + 1)}
              >
                Release pins
              </EuiButtonEmpty>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiSwitch
                compressed
                label="Show labels"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
              />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiSwitch
                    compressed
                    label="Disable animations"
                    checked={animationsDisabled}
                    onChange={(e) => setAnimationsUserPref(e.target.checked)}
                  />
                </EuiFlexItem>
                {isLargeGraph && (
                  <EuiFlexItem grow={false}>
                    <EuiIconTip
                      type="questionInCircle"
                      color="subdued"
                      content="Animations are automatically disabled on large graphs to preserve performance. The layout is solved up front instead. Toggle off to re-enable."
                      aria-label="Why animations are disabled by default"
                    />
                  </EuiFlexItem>
                )}
              </EuiFlexGroup>
            </EuiFlexItem>
          </EuiFlexGroup>

          <EuiSpacer size="m" />

          <div ref={containerRef}>
            <EuiPanel hasBorder hasShadow={false} paddingSize="none" style={{ overflow: 'hidden' }}>
              {canvasWidth > 0 && (
                <ConnectionsCanvas
                  graph={displayed.graph}
                  width={canvasWidth}
                  height={CANVAS_HEIGHT}
                  onNodeClick={handleNodeClick}
                  onBackgroundReset={handleBackgroundReset}
                  selectedNodeId={selectedNodeId}
                  releasePinsKey={releasePinsKey}
                  animationsDisabled={animationsDisabled}
                  showLabels={showLabels}
                />
              )}
            </EuiPanel>
          </div>
        </>
      )}

      {selectedNode && graph && (
        <ConnectionNodeFlyout
          node={selectedNode}
          graph={graph}
          srcField={srcField}
          dstField={dstField}
          isHidden={hiddenNodes.has(selectedNode.id)}
          isFocused={focusNodeId === selectedNode.id}
          onClose={() => setSelectedNodeId(null)}
          onToggleHide={toggleHide}
          onToggleFocus={toggleFocus}
          onAddFilter={handleAddFilter}
          getSecurityUrl={getSecurityUrl}
        />
      )}
    </div>
  );
};
