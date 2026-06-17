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

export const DEVICE_TYPE_CONFIG: Record<string, { color: string; icon: string }> = {
  router: { color: '#0077CC', icon: 'node' },
  switch: { color: '#00BFB3', icon: 'layers' },
  firewall: { color: '#F5A623', icon: 'lock' },
  server: { color: '#9170B8', icon: 'compute' },
  ap: { color: '#54B399', icon: 'wifi' },
  unknown: { color: '#98A2B3', icon: 'question' },
};

export const STATUS_COLORS: Record<string, string> = {
  up: '#00BFB3',
  down: '#BD271E',
  degraded: '#F5A623',
  unknown: '#98A2B3',
};

// A device is considered down if no SNMP data has arrived within this window.
// Default: 5 minutes — roughly 5× the standard Logstash interface polling interval (60s).
export const DEVICE_DOWN_THRESHOLD_MS = 5 * 60 * 1000;

// EUI semantic colour names for use with EUI components (EuiHealth, EuiIcon, EuiBadge, etc.).
// These adapt automatically to Kibana's light/dark/high-contrast themes.
// The hex constants above remain in place for the D3 canvas renderer.
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
