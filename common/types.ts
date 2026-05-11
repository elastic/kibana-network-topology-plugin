/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export type DeviceType = 'router' | 'switch' | 'firewall' | 'server' | 'ap' | 'unknown';
export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown';
export type NetworkRole = 'core' | 'distribution' | 'access' | 'server';
export type InterfaceStatus = 'up' | 'down' | 'testing' | 'unknown';

export interface NetworkDevice {
  id: string;
  name: string;
  ip: string;
  mac?: string;
  type: DeviceType;
  vendor?: string;
  os?: string;
  status: DeviceStatus;
  site?: string;
  building?: string;
  role?: string;
  interfaceCount: number;
  downInterfaceCount: number;
  lastSeen: string;
}

export interface DeviceInterface {
  name: string;
  id: string;
  speed: number;
  adminStatus: InterfaceStatus;
  operStatus: InterfaceStatus;
  trafficIn: number;
  trafficOut: number;
  errorsIn: number;
  errorsOut: number;
  utilization?: number;
}

export interface TopologyNode {
  id: string;
  label: string;
  ip: string;
  type: DeviceType;
  status: DeviceStatus;
  site?: string;
  role?: NetworkRole;
  x?: number;
  y?: number;
  /** false = discovered from a neighbor's ARP table only; no direct SNMP polling data */
  managed?: boolean;
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  status: 'up' | 'down' | 'degraded';
  trafficVolume?: number;
  method: 'arp' | 'mac' | 'lldp' | 'cdp' | 'bgp' | 'ospf' | 'manual';
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  links: TopologyLink[];
  discoveredAt: string;
  method: string;
}

export interface SiteHealth {
  site: string;
  deviceCount: number;
  upCount: number;
  downCount: number;
  degradedCount: number;
  worstStatus: DeviceStatus;
  topIssues: string[];
}

export interface SegmentHealth {
  /** CIDR notation, e.g. "192.168.1.0/24" */
  segment: string;
  deviceCount: number;
  upCount: number;
  downCount: number;
  degradedCount: number;
  /** ARP-discovered IPs in this subnet not being directly polled */
  discoveredCount: number;
  worstStatus: DeviceStatus;
}

export interface TopologyResponse {
  graph: TopologyGraph;
  timestamp: string;
  scope?: { site?: string; building?: string; role?: string };
}

export interface SitesResponse {
  sites: SiteHealth[];
  totalDevices: number;
  /** Unique IPs seen via ARP across all sites */
  discoveredCount: number;
  timestamp: string;
}

export interface SegmentsResponse {
  segments: SegmentHealth[];
  totalDevices: number;
  timestamp: string;
}

export interface DevicesResponse {
  devices: NetworkDevice[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BGPPeerSession {
  remoteIP: string;
  remoteASN: number;
  localASN: number;
  state: string;
  prefixesReceived: number;
  prefixesSent: number;
  uptimeSeconds: number;
  inUpdates: number;
  outUpdates: number;
}

export interface OSPFNeighbor {
  neighborIP: string;
  routerID: string;
  state: string;
  areaID: string;
  priority: number;
  retransCount: number;
}

export interface DeviceDetailResponse {
  device: NetworkDevice;
  interfaces: DeviceInterface[];
  neighbors: Array<{ ip: string; mac: string }>;
  bgpPeers: BGPPeerSession[];
  ospfNeighbors: OSPFNeighbor[];
  recentEvents: Array<{ timestamp: string; message: string; level: string }>;
}

export interface SetupHealthResponse {
  indexTemplate: { installed: boolean };
  ingestPipeline: { installed: boolean };
  recentData: { hasData: boolean; deviceCount: number; siteCount: number };
  fieldCoverage: {
    interfaces: boolean;
    arpTable: boolean;
    macTable: boolean;
    ipAddrTable: boolean;
    bgpPeers: boolean;
    ospfNeighbors: boolean;
  };
}
