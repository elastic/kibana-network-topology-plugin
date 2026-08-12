/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const PLUGIN_ID = 'networkTopology';
export const PLUGIN_NAME = 'Network Topology';

export const SNMP_DATA_STREAM = 'logs-snmp.topology-default';
export const DEFAULT_SNMP_INDEX = 'logs-snmp.*';
export const DEFAULT_SYSLOG_INDEX = 'logs-*,filebeat-*';
export const DEFAULT_NETFLOW_INDEX = 'netflow-*';
export const DEFAULT_METRICS_INDEX = 'metricbeat-*';

export const API_BASE = '/api/network_topology';
export const API_ROUTES = {
  TOPOLOGY: `${API_BASE}/topology`,
  SITES: `${API_BASE}/sites`,
  SEGMENTS: `${API_BASE}/segments`,
  DEVICES: `${API_BASE}/devices`,
  DEVICE_DETAIL: `${API_BASE}/device`,
  INTERFACES: `${API_BASE}/interfaces`,
  HEALTH: `${API_BASE}/health`,
  SETUP_HEALTH: `${API_BASE}/setup/health`,
} as const;

/**
 * Names of the icons EUI actually ships, as a literal union.
 *
 * Typed rather than left as `string` because EuiIcon does not fail loudly on a name
 * it doesn't know — it treats the value as an image URL and renders a broken image,
 * so a typo or an icon that only exists in a newer EUI turns into a silently broken
 * device on the map. Typing it moves that failure to `yarn type-check` and the IDE.
 *
 * Imported from the `src` path because that is what EUI's bundled ambient
 * declarations are keyed on, and as `import type` so nothing reaches runtime — this
 * module is shared with the server, which must not pull in browser code.
 * `EuiIconType` is not re-exported from the package root, and the root's `IconType`
 * is widened with `| string`, which would defeat the whole point.
 */
type EuiIconName = keyof typeof import('@elastic/eui/src/components/icon/icon_map').typeToPathMap;

export const DEVICE_TYPE_CONFIG: Record<string, { color: string; icon: EuiIconName }> = {
  router: { color: '#0077CC', icon: 'node' },
  switch: { color: '#00BFB3', icon: 'layers' },
  firewall: { color: '#F5A623', icon: 'lock' },
  server: { color: '#9170B8', icon: 'compute' },
  // EUI has no 'wifi' glyph; 'securitySignal' is its radiating-signal icon and the
  // closest available match for a wireless access point.
  ap: { color: '#54B399', icon: 'securitySignal' },
  unknown: { color: '#98A2B3', icon: 'question' },
};

// A device is considered down if no SNMP data has arrived within this window.
// Default: 5 minutes — roughly 5× the standard Logstash interface polling interval (60s).
export const DEVICE_DOWN_THRESHOLD_MS = 5 * 60 * 1000;

// EUI semantic colour names for use with EUI components (EuiHealth, EuiIcon, EuiBadge, etc.).
// These adapt automatically to Kibana's light/dark/high-contrast themes.
export const STATUS_EUI_COLORS: Record<string, string> = {
  up: 'success',
  down: 'danger',
  degraded: 'warning',
  unknown: 'subdued',
};

export const BGP_EUI_COLORS: Record<string, string> = {
  Established: 'success',
  Active: 'warning',
  Connect: 'warning',
  OpenSent: 'warning',
  OpenConfirm: 'warning',
  Idle: 'danger',
  Down: 'danger',
};

export const OSPF_EUI_COLORS: Record<string, string> = {
  Full: 'success',
  '2-Way': 'success',
  Loading: 'warning',
  Exchange: 'warning',
  ExStart: 'warning',
  Init: 'warning',
  Attempt: 'danger',
  Down: 'danger',
};
