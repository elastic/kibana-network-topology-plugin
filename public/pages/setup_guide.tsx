/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { compressToEncodedURIComponent } from 'lz-string';
import {
  EuiTitle, EuiSpacer, EuiPanel, EuiFlexGroup, EuiFlexItem,
  EuiHealth, EuiText, EuiButton, EuiButtonEmpty, EuiLoadingSpinner, EuiCallOut,
  EuiAccordion, EuiCodeBlock, EuiTabs, EuiTab, EuiBasicTable,
  EuiBadge, EuiHorizontalRule,
} from '@elastic/eui';
import { useApi } from '../hooks/use_api';
import type { SetupHealthResponse } from '../../common';

type CollectorTab = 'logstash' | 'direct';

const LOGSTASH_CONF = `# Logstash SNMP collector for logs-snmp.topology data stream
# ──────────────────────────────────────────────────────────────────────────────
# Requirements:
#   bin/logstash-plugin install logstash-input-snmp
#   Logstash 8.x+
#
# Architecture: ONE PIPELINE PER DEVICE ROLE
#   Duplicate this file for each role in your network (e.g. snmp-core.conf,
#   snmp-distribution.conf, snmp-access.conf). Each pipeline walks ALL SNMP
#   tables in a single poll per device — no key collisions because OID paths
#   are namespaced by MIB entry name (ifEntry, ipNetToMediaEntry, etc.).
#
# Device type classification:
#   host.type is set explicitly in add_field (not inferred from sysDescr).
#   Use the translate filter block (commented below) for mixed-type pipelines.
#
# Replace: DEVICE_*_IP, YOUR_SITE, YOUR_ROLE, YOUR_TYPE, YOUR_ES_HOST, YOUR_PASSWORD
# ──────────────────────────────────────────────────────────────────────────────

input {
  snmp {
    id       => "snmp_YOUR_ROLE"
    hosts    => [
      { host => "udp:DEVICE_1_IP/161" community => "public" version => "2c" },
      { host => "udp:DEVICE_2_IP/161" community => "public" version => "2c" }
    ]
    get      => [
      "1.3.6.1.2.1.1.5.0",   # sysName
      "1.3.6.1.2.1.1.1.0",   # sysDescr
      "1.3.6.1.2.1.15.2.0"   # BGP4-MIB::bgpLocalAs
    ]
    walk     => [
      "1.3.6.1.2.1.2.2",     # IF-MIB::ifTable
      "1.3.6.1.2.1.4.22",    # IP-MIB::ipNetToMediaTable (ARP)
      "1.3.6.1.2.1.17.4.3",  # BRIDGE-MIB::dot1dTpFdbTable (MAC)
      "1.3.6.1.2.1.4.20",    # IP-MIB::ipAddrTable
      "1.3.6.1.2.1.15.3",    # BGP4-MIB::bgpPeerTable
      "1.3.6.1.2.1.14.10"    # OSPF-MIB::ospfNbrTable
    ]
    interval => 60
    add_field => {
      "[network][site]"  => "YOUR_SITE"
      "[network][role]"  => "YOUR_ROLE"
      "[host][type]"     => "YOUR_TYPE"
    }
  }
}

filter {
  ruby {
    code => '
      host_name = nil; sys_descr = nil
      host_ip   = event.get("[@metadata][host_address]") ||
                  event.get("[@metadata][input][snmp][host][address]") || ""
      site      = event.get("[network][site]") || ""
      role      = event.get("[network][role]") || ""
      host_type = event.get("[host][type]") || ""
      local_asn = nil
      timestamp = event.get("@timestamp")

      base = lambda do
        e = LogStash::Event.new
        e.set("@timestamp",            timestamp)
        e.set("[host][name]",          host_name.to_s)
        e.set("[host][ip]",            host_ip)
        e.set("[host][type]",          host_type) unless host_type.empty?
        e.set("[observer][sys_descr]", sys_descr.to_s)
        e.set("[network][site]",       site)
        e.set("[network][role]",       role)
        e
      end

      if_cols   = %w[ifDescr ifSpeed ifAdminStatus ifOperStatus
                     ifInOctets ifInErrors ifOutOctets ifOutErrors].to_set
      admin_map = { "1"=>"up", "2"=>"down", "3"=>"testing" }
      oper_map  = { "1"=>"up", "2"=>"down", "3"=>"testing", "4"=>"unknown", "5"=>"dormant" }
      arp_cols  = %w[ipNetToMediaIfIndex ipNetToMediaPhysAddress ipNetToMediaNetAddress].to_set
      mac_cols  = %w[dot1dTpFdbAddress dot1dTpFdbPort dot1dTpFdbStatus].to_set
      status_map = { "3"=>"learned", "4"=>"static", "5"=>"mgmt" }
      bgp_cols  = %w[bgpPeerState bgpPeerRemoteAddr bgpPeerRemoteAs
                     bgpPeerInUpdates bgpPeerOutUpdates bgpPeerFsmEstablishedTime].to_set
      bgp_state_map = { "1"=>"Idle","2"=>"Connect","3"=>"Active",
                        "4"=>"OpenSent","5"=>"OpenConfirm","6"=>"Established" }
      ospf_cols = %w[ospfNbrIpAddr ospfNbrRtrId ospfNbrState ospfNbrPriority ospfNbrEvents].to_set
      ospf_state_map = { "1"=>"Down","2"=>"Attempt","3"=>"Init","4"=>"2-Way",
                         "5"=>"ExStart","6"=>"Exchange","7"=>"Loading","8"=>"Full" }
      ip_cols   = %w[ipAdEntAddr ipAdEntNetMask ipAdEntIfIndex].to_set

      prefix_len = lambda { |mask| mask.split(".").map { |o| o.to_i.to_s(2).count("1") }.sum }
      to_cidr = lambda do |ip, mask|
        net = ip.split(".").map(&:to_i).zip(mask.split(".").map(&:to_i)).map { |i,m| i & m }
        "#{net.join(".")}/#{prefix_len.call(mask)}"
      end

      interfaces = {}; arp_entries = {}; mac_entries = {}
      ip_entries = {}; bgp_entries = {}; ospf_entries = {}

      event.to_hash.each do |key, val|
        if key =~ /sysName\\.0$/i;    host_name = val.to_s; next; end
        if key =~ /sysDescr\\.0$/i;   sys_descr = val.to_s; next; end
        if key =~ /bgpLocalAs\\.0$/i; local_asn = val.to_i; next; end

        if (m = key.match(/\\.ifEntry\\.(\\w+)\\.(\\d+(?:\\.\\d+)*)$/))
          col, idx = m[1], m[2]; next unless if_cols.include?(col)
          (interfaces[idx] ||= {})[col] = val; next
        end
        if (m = key.match(/\\.ipNetToMediaEntry\\.(\\w+)\\.(.+)$/))
          col, idx = m[1], m[2]; next unless arp_cols.include?(col)
          (arp_entries[idx] ||= {})[col] = val; next
        end
        if (m = key.match(/\\.dot1dTpFdbEntry\\.(\\w+)\\.(.+)$/))
          col, idx = m[1], m[2]; next unless mac_cols.include?(col)
          (mac_entries[idx] ||= {})[col] = val; next
        end
        if (m = key.match(/\\.ipAddrEntry\\.(\\w+)\\.(\\d+\\.\\d+\\.\\d+\\.\\d+)$/))
          col, ip_idx = m[1], m[2]; next unless ip_cols.include?(col)
          (ip_entries[ip_idx] ||= {})[col] = val.to_s; next
        end
        if (m = key.match(/\\.bgpPeerEntry\\.(\\w+)\\.(\\d+\\.\\d+\\.\\d+\\.\\d+)$/))
          col, peer_ip = m[1], m[2]; next unless bgp_cols.include?(col)
          (bgp_entries[peer_ip] ||= {})[col] = val; next
        end
        if (m = key.match(/\\.ospfNbrEntry\\.(\\w+)\\.(\\d+\\.\\d+\\.\\d+\\.\\d+)\\.\\d+$/))
          col, nbr_ip = m[1], m[2]; next unless ospf_cols.include?(col)
          (ospf_entries[nbr_ip] ||= {})[col] = val; next
        end
      end

      interfaces.each do |_idx, d|
        e = base.call
        e.set("[interface][name]",               d["ifDescr"].to_s)
        e.set("[interface][speed]",              d["ifSpeed"].to_i)
        e.set("[interface][traffic][in][bytes]",  d["ifInOctets"].to_i)
        e.set("[interface][traffic][out][bytes]", d["ifOutOctets"].to_i)
        e.set("[interface][errors][in]",          d["ifInErrors"].to_i)
        e.set("[interface][errors][out]",         d["ifOutErrors"].to_i)
        e.set("[interface][status][admin]", admin_map[d["ifAdminStatus"].to_s] || d["ifAdminStatus"].to_s)
        e.set("[interface][status][oper]",  oper_map[d["ifOperStatus"].to_s]   || d["ifOperStatus"].to_s)
        new_event_block.call(e)
      end

      arp_entries.each do |_idx, d|
        next unless d["ipNetToMediaPhysAddress"] && d["ipNetToMediaNetAddress"]
        e = base.call
        e.set("[arp][mac_addr]",       d["ipNetToMediaPhysAddress"].to_s)
        e.set("[arp][ip_addr]",        d["ipNetToMediaNetAddress"].to_s)
        e.set("[arp][interface_index]", d["ipNetToMediaIfIndex"].to_i)
        new_event_block.call(e)
      end

      mac_entries.each do |_idx, d|
        sl = status_map[d["dot1dTpFdbStatus"].to_s]; next unless sl
        e = base.call
        e.set("[mac_table][mac_addr]",   d["dot1dTpFdbAddress"].to_s)
        e.set("[mac_table][port_index]", d["dot1dTpFdbPort"].to_i)
        e.set("[mac_table][status]",     sl)
        new_event_block.call(e)
      end

      ip_entries.each do |ip_idx, d|
        addr = d["ipAdEntAddr"] || ip_idx; mask = d["ipAdEntNetMask"] || ""
        next if addr.empty? || mask.empty?
        first = addr.split(".").first.to_i
        next if first == 0 || first == 127 || first >= 224
        next if addr.start_with?("169.254.")
        e = base.call
        e.set("[ip_addr][address]",       addr)
        e.set("[ip_addr][netmask]",       mask)
        e.set("[ip_addr][network]",       to_cidr.call(addr, mask))
        e.set("[ip_addr][prefix_length]", prefix_len.call(mask))
        e.set("[ip_addr][if_index]",      d["ipAdEntIfIndex"].to_i)
        new_event_block.call(e)
      end

      bgp_entries.each do |peer_ip, d|
        e = base.call
        e.set("[bgp_peer][remote_ip]",         peer_ip)
        e.set("[bgp_peer][remote_asn]",        d["bgpPeerRemoteAs"].to_i)
        e.set("[bgp_peer][local_asn]",         local_asn.to_i) if local_asn
        e.set("[bgp_peer][peer_state]",        bgp_state_map[d["bgpPeerState"].to_s] || d["bgpPeerState"].to_s)
        e.set("[bgp_peer][uptime_seconds]",    d["bgpPeerFsmEstablishedTime"].to_i)
        e.set("[bgp_peer][in_updates]",        d["bgpPeerInUpdates"].to_i)
        e.set("[bgp_peer][out_updates]",       d["bgpPeerOutUpdates"].to_i)
        e.set("[bgp_peer][prefixes_received]", 0)
        e.set("[bgp_peer][prefixes_sent]",     0)
        new_event_block.call(e)
      end

      ospf_entries.each do |nbr_ip, d|
        e = base.call
        e.set("[ospf_neighbor][neighbor_ip]",   nbr_ip)
        e.set("[ospf_neighbor][router_id]",     d["ospfNbrRtrId"].to_s)
        e.set("[ospf_neighbor][state]",         ospf_state_map[d["ospfNbrState"].to_s] || d["ospfNbrState"].to_s)
        e.set("[ospf_neighbor][priority]",      d["ospfNbrPriority"].to_i)
        e.set("[ospf_neighbor][retrans_count]", d["ospfNbrEvents"].to_i)
        new_event_block.call(e)
      end

      event.cancel
    '
    tag_on_exception => "_ruby_exception"
  }

  if ![interface][name] and ![arp][mac_addr] and ![mac_table][mac_addr] and ![ip_addr][address] and ![bgp_peer][remote_ip] and ![ospf_neighbor][neighbor_ip] {
    drop {}
  }

  # Optional: per-device host.type overrides (uncomment for mixed-type pipelines)
  # translate {
  #   source           => "[host][ip]"
  #   target           => "[host][type]"
  #   override         => true
  #   fallback         => ""
  #   dictionary_path  => "/etc/logstash/device-types.yml"
  #   refresh_interval => 300
  # }
}

output {
  elasticsearch {
    hosts    => ["https://YOUR_ES_HOST:9200"]
    user     => "elastic"
    password => "YOUR_PASSWORD"
    ssl_certificate_verification => false
    data_stream           => true
    data_stream_type      => "logs"
    data_stream_dataset   => "snmp.topology"
    data_stream_namespace => "default"
  }
}


# ── pipelines.yml example ─────────────────────────────────────────────────────
# - pipeline.id: snmp-core
#   path.config: "/etc/logstash/conf.d/snmp-core.conf"
#   pipeline.workers: 1
#
# - pipeline.id: snmp-distribution
#   path.config: "/etc/logstash/conf.d/snmp-distribution.conf"
#   pipeline.workers: 1
#
# - pipeline.id: snmp-access
#   path.config: "/etc/logstash/conf.d/snmp-access.conf"
#   pipeline.workers: 1
`;



const DIRECT_CONF = `# Direct Elasticsearch indexing (Python / custom script)
# POST documents to the logs-snmp.topology-default data stream.
# Set ?pipeline=snmp-device-enrichment to auto-enrich vendor and host.type.

import requests, datetime

doc = {
    "@timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    "host": {
        "name": "hq-core-rtr-01",
        "ip":   "10.1.1.2",
        "mac":  "aa:bb:cc:dd:ee:01",
        "type": "router"          # ingest pipeline can infer this from observer.sys_descr
    },
    "observer": {
        "vendor":   "Cisco",
        "sys_descr": "Cisco IOS XR, ASR 9000 Series"
    },
    "network": {
        "site":     "HQ-DC1",
        "building": "Main",
        "role":     "core"        # core | distribution | access | server
    },
    "interface": {
        "name":   "Gi0/0/0",
        "speed":  10000000000,
        "status": { "admin": "up", "oper": "up" },
        "traffic": { "in": { "bytes": 125000000 }, "out": { "bytes": 87500000 } },
        "errors": { "in": 0, "out": 0 }
    }
}

requests.post(
    "https://YOUR_ES_HOST:9200/logs-snmp.topology-default/_doc?pipeline=snmp-device-enrichment",
    json=doc,
    auth=("elastic", "YOUR_PASSWORD"),
    verify=False
)
`;

// ── DevTools deep-link helpers ──────────────────────────────────────────────
// Kibana Console supports load_from=data:text/plain,<url-encoded content>
// which pre-populates the editor. User just needs to click ▶ to run.

function devToolsUrl(content: string): string {
  // Kibana Console reads load_from, strips the data:text/plain, prefix, then calls
  // decompressFromEncodedURIComponent — so the payload must be lz-string compressed.
  const compressed = compressToEncodedURIComponent(content);
  return `/app/dev_tools#/console?load_from=${encodeURIComponent(`data:text/plain,${compressed}`)}`;
}

const PIPELINE_BODY = {
  description: 'Enrich SNMP device data — auto-detects device type and vendor from sysDescr',
  processors: [
    { set: { field: 'host.type',    value: 'unknown',    if: 'ctx.host?.type == null' } },
    { set: { field: 'network.site', value: 'Ungrouped',  if: 'ctx.network?.site == null' } },
    {
      script: {
        description: 'Infer host.type from sysDescr when not set by collector',
        if: 'ctx.host?.type == "unknown" && ctx.observer?.sys_descr != null',
        source: 'def d=ctx.observer.sys_descr.toLowerCase(); if(d.contains("router")||d.contains("ios xr")||d.contains("junos")){ctx.host.type="router"} else if(d.contains("switch")||d.contains("catalyst")||d.contains("nexus")||d.contains("eos")){ctx.host.type="switch"} else if(d.contains("firewall")||d.contains("asa")||d.contains("fortigate")||d.contains("palo alto")){ctx.host.type="firewall"} else if(d.contains("access point")||d.contains("aironet")||d.contains("aruba ap")){ctx.host.type="ap"} else if(d.contains("linux")||d.contains("windows")||d.contains("vmware")){ctx.host.type="server"}',
      },
    },
    {
      script: {
        description: 'Detect vendor from sysDescr',
        if: 'ctx.observer?.vendor == null && ctx.observer?.sys_descr != null',
        source: 'def d=ctx.observer.sys_descr.toLowerCase(); if(d.contains("cisco")){ctx.observer.vendor="Cisco"} else if(d.contains("juniper")){ctx.observer.vendor="Juniper"} else if(d.contains("arista")){ctx.observer.vendor="Arista"} else if(d.contains("fortinet")){ctx.observer.vendor="Fortinet"} else if(d.contains("palo alto")){ctx.observer.vendor="Palo Alto"} else if(d.contains("aruba")||d.contains("hpe")){ctx.observer.vendor="HPE/Aruba"} else{ctx.observer.vendor="Unknown"}',
      },
    },
  ],
};

const TEMPLATE_BODY = {
  index_patterns: ['logs-snmp.*'],
  data_stream: {},
  priority: 200,
  template: {
    settings: {
      'index.number_of_shards': 1,
      'index.auto_expand_replicas': '0-1',
      'index.default_pipeline': 'snmp-device-enrichment',
    },
    mappings: {
      dynamic: true,
      properties: {
        '@timestamp': { type: 'date' },
        host: { properties: { name: { type: 'keyword' }, ip: { type: 'ip' }, mac: { type: 'keyword' }, type: { type: 'keyword' } } },
        observer: {
          properties: {
            vendor: { type: 'keyword' }, type: { type: 'keyword' },
            sys_descr: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            os: { properties: { full: { type: 'keyword' } } },
          },
        },
        network: { properties: { site: { type: 'keyword' }, building: { type: 'keyword' }, role: { type: 'keyword' } } },
        interface: {
          properties: {
            name: { type: 'keyword' }, speed: { type: 'long' },
            status: { properties: { admin: { type: 'keyword' }, oper: { type: 'keyword' } } },
            traffic: { properties: { in: { properties: { bytes: { type: 'long' } } }, out: { properties: { bytes: { type: 'long' } } } } },
            errors: { properties: { in: { type: 'long' }, out: { type: 'long' } } },
          },
        },
        ip_addr: { properties: { address: { type: 'ip' }, netmask: { type: 'keyword' }, network: { type: 'keyword' }, prefix_length: { type: 'integer' }, if_index: { type: 'integer' } } },
        arp: { properties: { ip_addr: { type: 'ip' }, mac_addr: { type: 'keyword' }, interface_index: { type: 'integer' } } },
        mac_table: { properties: { mac_addr: { type: 'keyword' }, port_index: { type: 'integer' }, status: { type: 'keyword' } } },
        bgp_peer: {
          properties: {
            remote_ip: { type: 'ip' }, remote_asn: { type: 'long' }, local_asn: { type: 'long' },
            peer_state: { type: 'keyword' }, prefixes_received: { type: 'long' }, prefixes_sent: { type: 'long' },
            uptime_seconds: { type: 'long' }, in_updates: { type: 'long' }, out_updates: { type: 'long' },
          },
        },
        ospf_neighbor: {
          properties: {
            neighbor_ip: { type: 'ip' }, router_id: { type: 'ip' }, state: { type: 'keyword' },
            area_id: { type: 'keyword' }, priority: { type: 'integer' }, dead_timer: { type: 'integer' }, retrans_count: { type: 'integer' },
          },
        },
      },
    },
  },
};

const ES_PIPELINE_DEVTOOLS = `PUT _ingest/pipeline/snmp-device-enrichment\n${JSON.stringify(PIPELINE_BODY, null, 2)}`;
const ES_TEMPLATE_DEVTOOLS = `PUT _index_template/logs-snmp.topology@template\n${JSON.stringify(TEMPLATE_BODY, null, 2)}`;

const FIELD_ROWS = [
  { field: '@timestamp',                  type: 'date',    ecs: 'Core ECS',   description: 'Poll timestamp', example: '2024-01-01T12:00:00.000Z' },
  { field: 'host.name',                   type: 'keyword', ecs: 'Core ECS',   description: 'Device hostname (sysName)', example: 'hq-core-rtr-01' },
  { field: 'host.ip',                     type: 'ip',      ecs: 'Core ECS',   description: 'Management IP address', example: '10.1.1.2' },
  { field: 'host.mac',                    type: 'keyword', ecs: 'Core ECS',   description: 'Primary MAC address', example: 'aa:bb:cc:dd:ee:01' },
  { field: 'host.type',                   type: 'keyword', ecs: 'ECS ext.',   description: 'Device category', example: 'router, switch, firewall, server, ap' },
  { field: 'observer.vendor',             type: 'keyword', ecs: 'Core ECS',   description: 'Vendor name (auto-detected from sys_descr)', example: 'Cisco, Juniper, Palo Alto' },
  { field: 'observer.sys_descr',          type: 'text',    ecs: 'Core ECS',   description: 'Raw SNMP sysDescr — used by ingest pipeline for enrichment', example: 'Cisco IOS XR Software...' },
  { field: 'observer.os.full',            type: 'keyword', ecs: 'Core ECS',   description: 'OS version string', example: 'IOS-XR 7.3.2' },
  { field: 'network.site',                type: 'keyword', ecs: 'ECS ext.',   description: 'Site / datacenter identifier', example: 'HQ-DC1, Branch-NYC' },
  { field: 'network.building',            type: 'keyword', ecs: 'ECS ext.',   description: 'Building within site', example: 'Main, Annex' },
  { field: 'network.role',                type: 'keyword', ecs: 'ECS ext.',   description: 'Network tier', example: 'core, distribution, access, server' },
  { field: 'interface.name',              type: 'keyword', ecs: 'Custom',     description: 'Interface name / ifDescr', example: 'Gi0/0/0, eth0, xe-0/0/0' },
  { field: 'interface.speed',             type: 'long',    ecs: 'Custom',     description: 'Interface speed in bits/sec (ifSpeed)', example: '10000000000' },
  { field: 'interface.status.admin',      type: 'keyword', ecs: 'Custom',     description: 'Administrative status', example: 'up, down' },
  { field: 'interface.status.oper',       type: 'keyword', ecs: 'Custom',     description: 'Operational status', example: 'up, down, testing' },
  { field: 'interface.traffic.in.bytes',  type: 'long',    ecs: 'Custom',     description: 'Inbound bytes (ifInOctets)', example: '125000000' },
  { field: 'interface.traffic.out.bytes', type: 'long',    ecs: 'Custom',     description: 'Outbound bytes (ifOutOctets)', example: '87500000' },
  { field: 'interface.errors.in',         type: 'long',    ecs: 'Custom',     description: 'Input errors (ifInErrors)', example: '0' },
  { field: 'interface.errors.out',        type: 'long',    ecs: 'Custom',     description: 'Output errors (ifOutErrors)', example: '0' },
  { field: 'arp.ip_addr',                 type: 'ip',      ecs: 'Custom',     description: 'ARP neighbor IP (ipNetToMediaNetAddress)', example: '10.1.1.3' },
  { field: 'arp.mac_addr',                type: 'keyword', ecs: 'Custom',     description: 'ARP neighbor MAC (ipNetToMediaPhysAddress)', example: 'aa:bb:cc:dd:ee:02' },
  { field: 'arp.interface_index',         type: 'integer', ecs: 'Custom',     description: 'Interface on which ARP entry was learned (ipNetToMediaIfIndex)', example: '1' },
  { field: 'mac_table.mac_addr',          type: 'keyword', ecs: 'Custom',     description: 'Bridge forwarding table MAC (dot1dTpFdbAddress)', example: 'aa:bb:cc:dd:ee:05' },
  { field: 'mac_table.port_index',        type: 'integer', ecs: 'Custom',     description: 'Bridge port index (dot1dTpFdbPort)', example: '2' },
  { field: 'mac_table.status',            type: 'keyword', ecs: 'Custom',     description: 'Entry type (dot1dTpFdbStatus)', example: 'learned, static, mgmt' },
  { field: 'ip_addr.address',             type: 'ip',      ecs: 'Custom',     description: 'Interface IP address (ipAdEntAddr) — used for subnet/segment lookup', example: '192.168.10.1' },
  { field: 'ip_addr.netmask',             type: 'keyword', ecs: 'Custom',     description: 'Interface subnet mask (ipAdEntNetMask)', example: '255.255.255.0' },
  { field: 'ip_addr.network',             type: 'keyword', ecs: 'Custom',     description: 'Computed CIDR block from address + netmask — used for segment grouping', example: '192.168.10.0/24' },
  { field: 'ip_addr.prefix_length',       type: 'integer', ecs: 'Custom',     description: 'Prefix length derived from netmask', example: '24' },
  { field: 'ip_addr.if_index',            type: 'integer', ecs: 'Custom',     description: 'Interface index (ipAdEntIfIndex) linking this IP to an interface row', example: '3' },
  { field: 'bgp_peer.remote_ip',          type: 'ip',      ecs: 'Custom',     description: 'BGP peer remote IP address (bgpPeerRemoteAddr)', example: '198.51.100.1' },
  { field: 'bgp_peer.remote_asn',         type: 'long',    ecs: 'Custom',     description: 'BGP peer remote AS number (bgpPeerRemoteAs)', example: '3356' },
  { field: 'bgp_peer.local_asn',          type: 'long',    ecs: 'Custom',     description: 'Local AS number (bgpLocalAs)', example: '65000' },
  { field: 'bgp_peer.peer_state',         type: 'keyword', ecs: 'Custom',     description: 'BGP FSM state (bgpPeerState)', example: 'Established, Idle, Active' },
  { field: 'bgp_peer.prefixes_received',  type: 'long',    ecs: 'Custom',     description: 'Prefixes received from peer (vendor-specific)', example: '920000' },
  { field: 'bgp_peer.prefixes_sent',      type: 'long',    ecs: 'Custom',     description: 'Prefixes advertised to peer (vendor-specific)', example: '12' },
  { field: 'bgp_peer.uptime_seconds',     type: 'long',    ecs: 'Custom',     description: 'Seconds since BGP session established (bgpPeerFsmEstablishedTime)', example: '2592000' },
  { field: 'bgp_peer.in_updates',         type: 'long',    ecs: 'Custom',     description: 'BGP UPDATE messages received (bgpPeerInUpdates)', example: '45000' },
  { field: 'bgp_peer.out_updates',        type: 'long',    ecs: 'Custom',     description: 'BGP UPDATE messages sent (bgpPeerOutUpdates)', example: '1200' },
  { field: 'ospf_neighbor.neighbor_ip',   type: 'ip',      ecs: 'Custom',     description: 'OSPF neighbor IP address (ospfNbrIpAddr)', example: '10.1.1.2' },
  { field: 'ospf_neighbor.router_id',     type: 'ip',      ecs: 'Custom',     description: 'OSPF neighbor router ID (ospfNbrRtrId)', example: '10.1.1.2' },
  { field: 'ospf_neighbor.state',         type: 'keyword', ecs: 'Custom',     description: 'OSPF adjacency state (ospfNbrState)', example: 'Full, 2-Way, Down' },
  { field: 'ospf_neighbor.area_id',       type: 'keyword', ecs: 'Custom',     description: 'OSPF area identifier', example: '0.0.0.0' },
  { field: 'ospf_neighbor.priority',      type: 'integer', ecs: 'Custom',     description: 'OSPF neighbor priority (ospfNbrPriority)', example: '1' },
  { field: 'ospf_neighbor.retrans_count', type: 'integer', ecs: 'Custom',     description: 'OSPF state change events (ospfNbrEvents)', example: '3' },
];

const ECS_BADGE_COLOR: Record<string, string> = {
  'Core ECS': 'success',
  'ECS ext.': 'warning',
  'Custom':   'default',
};

export const SetupGuide: React.FC = () => {
  const api = useApi();
  const [health, setHealth] = useState<SetupHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collectorTab, setCollectorTab] = useState<CollectorTab>('logstash');

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHealth(await api.checkSetupHealth());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const collectorConfigs: Record<CollectorTab, { label: string; lang: string; content: string }> = {
    logstash: { label: 'Logstash',       lang: 'ruby',   content: LOGSTASH_CONF },
    direct:   { label: 'Direct / Custom', lang: 'python', content: DIRECT_CONF },
  };

  return (
    <div style={{ alignSelf: 'flex-start', width: '100%', maxWidth: 900 }}>
      <EuiTitle size="m"><h2>Plugin Setup Guide</h2></EuiTitle>
      <EuiText size="s" color="subdued">
        <p>
          This guide walks through installing the required Elasticsearch resources and configuring
          an SNMP collector to feed data into this plugin.
        </p>
      </EuiText>

      <EuiSpacer size="l" />

      {/* ── Health panel ── */}
      <EuiPanel hasBorder hasShadow={false} paddingSize="l">
        <EuiFlexGroup alignItems="center" gutterSize="s">
          <EuiFlexItem>
            <EuiTitle size="s"><h3>Data Source Health</h3></EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty iconType="refresh" size="s" onClick={fetchHealth} isLoading={loading}>
              Refresh
            </EuiButtonEmpty>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="m" />

        {loading && !health && (
          <EuiFlexGroup justifyContent="center"><EuiFlexItem grow={false}><EuiLoadingSpinner /></EuiFlexItem></EuiFlexGroup>
        )}
        {error && <EuiCallOut title="Health check failed" color="danger"><p>{error}</p></EuiCallOut>}

        {health && (
          <EuiFlexGroup direction="column" gutterSize="s">
            <EuiFlexItem>
              <EuiHealth color={health.ingestPipeline.installed ? 'success' : 'danger'}>
                <strong>Ingest pipeline</strong> (snmp-device-enrichment) —{' '}
                {health.ingestPipeline.installed ? 'Installed' : 'Not found — use the Open in DevTools button in Step 1a below'}
              </EuiHealth>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiHealth color={health.indexTemplate.installed ? 'success' : 'danger'}>
                <strong>Index template</strong> (logs-snmp.topology@template) —{' '}
                {health.indexTemplate.installed ? 'Installed' : 'Not found — use the Open in DevTools button in Step 1b below'}
              </EuiHealth>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiHealth color={health.recentData.hasData ? 'success' : 'danger'}>
                <strong>Recent data (last 1 h)</strong> —{' '}
                {health.recentData.hasData
                  ? `${health.recentData.deviceCount} device${health.recentData.deviceCount !== 1 ? 's' : ''} across ${health.recentData.siteCount} site${health.recentData.siteCount !== 1 ? 's' : ''}`
                  : 'No data found — configure a collector (Step 2)'}
              </EuiHealth>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiHealth color={health.fieldCoverage.interfaces ? 'success' : 'warning'}>
                <strong>Interface metrics</strong> (interface.*) —{' '}
                {health.fieldCoverage.interfaces ? 'Present' : 'Not detected — topology status depends on this data'}
              </EuiHealth>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiHealth color={health.fieldCoverage.arpTable && health.fieldCoverage.macTable ? 'success' : 'warning'}>
                <strong>ARP / MAC table data</strong> (arp.*, mac_table.*) —{' '}
                {health.fieldCoverage.arpTable && health.fieldCoverage.macTable
                  ? 'Present — topology links will be discovered'
                  : 'Not detected — topology map will show nodes without links'}
              </EuiHealth>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiHealth color={health.fieldCoverage.ipAddrTable ? 'success' : 'warning'}>
                <strong>IP address table</strong> (ip_addr.*) —{' '}
                {health.fieldCoverage.ipAddrTable
                  ? 'Present — network segment view is accurate'
                  : 'Not detected — enable ipAddrTable collection for segment filtering (Step 2)'}
              </EuiHealth>
            </EuiFlexItem>
          </EuiFlexGroup>
        )}
      </EuiPanel>

      <EuiSpacer size="l" />

      {/* ── Step 1 ── */}
      <EuiAccordion id="step1" buttonContent={<strong>Step 1 — Install Index Template &amp; Ingest Pipeline</strong>} initialIsOpen={!health?.indexTemplate.installed || !health?.ingestPipeline.installed}>
        <EuiSpacer size="m" />
        <EuiText size="s">
          <p>
            Two Elasticsearch resources must be installed before data is indexed. Click{' '}
            <strong>Open in DevTools</strong> for each command, then press the run button (▶) in the console to apply.
            Install the pipeline first — the template references it as the default ingest pipeline.
          </p>
        </EuiText>

        <EuiSpacer size="l" />

        {/* 1a — Pipeline */}
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
          <EuiFlexItem>
            <EuiTitle size="xs"><h4>1a — Ingest Pipeline: <code>snmp-device-enrichment</code></h4></EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton size="s" iconType="wrench" href={devToolsUrl(ES_PIPELINE_DEVTOOLS)} target="_blank">
              Open in DevTools
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="xs" />
        <EuiText size="xs" color="subdued">
          <p>
            Classifies device type and detects vendor from <code>observer.sys_descr</code>. The index template sets
            this as the <code>default_pipeline</code>, so it runs automatically on every indexed document.
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiCodeBlock language="json" isCopyable overflowHeight={220} paddingSize="m">
          {ES_PIPELINE_DEVTOOLS}
        </EuiCodeBlock>

        <EuiSpacer size="xl" />

        {/* 1b — Template */}
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
          <EuiFlexItem>
            <EuiTitle size="xs"><h4>1b — Index Template: <code>logs-snmp.topology@template</code></h4></EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton size="s" iconType="wrench" href={devToolsUrl(ES_TEMPLATE_DEVTOOLS)} target="_blank">
              Open in DevTools
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="xs" />
        <EuiText size="xs" color="subdued">
          <p>
            Applies correct field types to the <code>logs-snmp.*</code> data stream — notably <code>ip</code> type for CIDR
            queries and <code>keyword</code> for aggregations. Apply this <em>before</em> indexing any data; the
            data stream will auto-create on first document write.
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiCodeBlock language="json" isCopyable overflowHeight={300} paddingSize="m">
          {ES_TEMPLATE_DEVTOOLS}
        </EuiCodeBlock>
      </EuiAccordion>

      <EuiHorizontalRule margin="l" />

      {/* ── Step 2 ── */}
      <EuiAccordion id="step2" buttonContent={<strong>Step 2 — Configure Your SNMP Collector</strong>} initialIsOpen>
        <EuiSpacer size="m" />
        <EuiText size="s">
          <p>
            The plugin expects data in a consistent schema regardless of vendor. The collector configs
            below map standard MIB OIDs to the plugin's field names. The ingest pipeline handles the
            rest (vendor detection, type classification, defaults).
          </p>
          <p>
            All three collectors support Cisco, Palo Alto, Juniper, Arista, Fortinet, and HPE/Aruba
            — SNMP MIB-II (RFC 1213) is vendor-neutral. Replace <code>DEVICE_IP</code>,{' '}
            <code>YOUR_ES_HOST</code>, and credentials before deploying.
          </p>
        </EuiText>
        <EuiSpacer size="m" />
        <EuiTabs>
          {(Object.keys(collectorConfigs) as CollectorTab[]).map(tab => (
            <EuiTab key={tab} isSelected={collectorTab === tab} onClick={() => setCollectorTab(tab)}>
              {collectorConfigs[tab].label}
            </EuiTab>
          ))}
        </EuiTabs>
        <EuiSpacer size="m" />
        <EuiCodeBlock
          language={collectorConfigs[collectorTab].lang}
          isCopyable
          overflowHeight={420}
          paddingSize="m"
        >
          {collectorConfigs[collectorTab].content}
        </EuiCodeBlock>
      </EuiAccordion>

      <EuiHorizontalRule margin="l" />

      {/* ── Step 3 ── */}
      <EuiAccordion id="step3" buttonContent={<strong>Step 3 — Field Reference &amp; ECS Compliance</strong>}>
        <EuiSpacer size="m" />
        <EuiText size="s">
          <p>
            Fields marked <EuiBadge color="success">Core ECS</EuiBadge> follow the{' '}
            <a href="https://www.elastic.co/guide/en/ecs/current/index.html" target="_blank" rel="noreferrer">
              Elastic Common Schema
            </a>{' '}
            exactly. Fields marked <EuiBadge color="warning">ECS ext.</EuiBadge> use an ECS-defined namespace
            with values that extend beyond the official spec (e.g. using <code>host.type</code> for network
            device categories). Fields marked <EuiBadge color="default">Custom</EuiBadge> have no ECS
            equivalent — SNMP interface metrics, ARP tables, and MAC forwarding tables are not covered by
            any current ECS field set.
          </p>
        </EuiText>
        <EuiSpacer size="m" />
        <EuiBasicTable
          compressed
          items={FIELD_ROWS}
          columns={[
            {
              field: 'field', name: 'Field', width: '260px',
              render: (f: string) => <code>{f}</code>,
            },
            { field: 'type', name: 'Type', width: '80px' },
            {
              field: 'ecs', name: 'ECS', width: '100px',
              render: (e: string) => <EuiBadge color={ECS_BADGE_COLOR[e] || 'default'}>{e}</EuiBadge>,
            },
            { field: 'description', name: 'Description' },
            {
              field: 'example', name: 'Example', width: '220px',
              render: (e: string) => <EuiText size="xs" color="subdued"><span>{e}</span></EuiText>,
            },
          ]}
        />
      </EuiAccordion>
    </div>
  );
};
