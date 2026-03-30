import React, { useEffect, useState, useCallback } from 'react';
import {
  EuiTitle, EuiSpacer, EuiPanel, EuiFlexGroup, EuiFlexItem,
  EuiHealth, EuiText, EuiButtonEmpty, EuiLoadingSpinner, EuiCallOut,
  EuiAccordion, EuiCodeBlock, EuiTabs, EuiTab, EuiBasicTable,
  EuiBadge, EuiHorizontalRule,
} from '@elastic/eui';
import { useApi } from '../hooks/use_api';
import type { SetupHealthResponse } from '../../common';

type CollectorTab = 'logstash' | 'elastic-agent' | 'telegraf' | 'direct';

const LOGSTASH_CONF = `# Logstash SNMP collector — one pipeline per device role.
# Requires: bin/logstash-plugin install logstash-input-snmp
# Full reference config: docs/collectors/logstash.conf

# Duplicate this file per role (core, distribution, access, server).
# Each pipeline walks ALL SNMP tables in a single poll per device.

input {
  snmp {
    id       => "snmp_YOUR_ROLE"
    hosts    => [
      { host => "udp:DEVICE_IP/161" community => "public" version => "2c" }
    ]
    get      => ["1.3.6.1.2.1.1.5.0",    # sysName
                 "1.3.6.1.2.1.1.1.0"]    # sysDescr
    walk     => [
      "1.3.6.1.2.1.2.2",                  # ifTable         → interface.*
      "1.3.6.1.2.1.4.22",                 # ipNetToMedia    → arp.*
      "1.3.6.1.2.1.17.4.3",               # dot1dTpFdbTable → mac_table.*
      "1.3.6.1.2.1.4.20"                  # ipAddrTable     → ip_addr.*
    ]
    interval => 60
    add_field => {
      "[network][site]" => "YOUR_SITE"
      "[network][role]" => "YOUR_ROLE"     # core | distribution | access | server
      "[host][type]"    => "YOUR_TYPE"     # router | switch | firewall | ap | server
    }
  }
}

filter {
  # A unified Ruby filter parses all four table types from the combined walk
  # and emits one document per row (interface, ARP entry, MAC entry, IP addr).
  # See docs/collectors/logstash.conf for the full filter implementation.
  ruby {
    code => "... see docs/collectors/logstash.conf ..."
    tag_on_exception => "_ruby_exception"
  }
}

output {
  elasticsearch {
    hosts    => ["https://YOUR_ES_HOST:9200"]
    user     => "elastic"
    password => "YOUR_PASSWORD"
    ssl_certificate_verification => false
    index    => "snmp-%{+YYYY.MM.dd}"
    pipeline => "snmp-device-enrichment"   # auto-enriches vendor, host.type
  }
}
`;

const TELEGRAF_TOML = `# Telegraf SNMP collector — one config per device role.
# Requires: Telegraf 1.20+, outputs.elasticsearch plugin
# Full reference config: docs/collectors/telegraf.toml

[[inputs.snmp]]
  agents = ["udp://DEVICE_IP:161"]
  version = 2
  community = "public"
  interval = "60s"
  name = "snmp_interface"

  [[inputs.snmp.field]]
    name = "host_name"
    oid  = "SNMPv2-MIB::sysName.0"

  [[inputs.snmp.field]]
    name = "sys_descr"
    oid  = "SNMPv2-MIB::sysDescr.0"

  [[inputs.snmp.table]]
    name = "interface"
    inherit_tags = ["host_name", "sys_descr"]

    [[inputs.snmp.table.field]]
      name = "name"
      oid  = "IF-MIB::ifDescr"
      is_tag = true

    [[inputs.snmp.table.field]]
      name = "speed"
      oid  = "IF-MIB::ifSpeed"

    [[inputs.snmp.table.field]]
      name = "admin_status"
      oid  = "IF-MIB::ifAdminStatus"

    [[inputs.snmp.table.field]]
      name = "oper_status"
      oid  = "IF-MIB::ifOperStatus"

    [[inputs.snmp.table.field]]
      name = "traffic_in_bytes"
      oid  = "IF-MIB::ifInOctets"

    [[inputs.snmp.table.field]]
      name = "traffic_out_bytes"
      oid  = "IF-MIB::ifOutOctets"

    [[inputs.snmp.table.field]]
      name = "errors_in"
      oid  = "IF-MIB::ifInErrors"

    [[inputs.snmp.table.field]]
      name = "errors_out"
      oid  = "IF-MIB::ifOutErrors"

  # ARP table (ipNetToMediaTable), MAC table (dot1dTpFdbTable), and
  # IP address table (ipAddrTable) are also collected in the full config.
  # See docs/collectors/telegraf.toml for complete table definitions,
  # field renames, and the Starlark CIDR computation processor.

[[processors.rename]]
  [[processors.rename.replace]]
    field = "host_name"
    dest  = "host.name"
  [[processors.rename.replace]]
    field = "sys_descr"
    dest  = "observer.sys_descr"
  [[processors.rename.replace]]
    field = "interface_name"
    dest  = "interface.name"
  [[processors.rename.replace]]
    field = "speed"
    dest  = "interface.speed"
  [[processors.rename.replace]]
    field = "admin_status"
    dest  = "interface.status.admin"
  [[processors.rename.replace]]
    field = "oper_status"
    dest  = "interface.status.oper"
  [[processors.rename.replace]]
    field = "traffic_in_bytes"
    dest  = "interface.traffic.in.bytes"
  [[processors.rename.replace]]
    field = "traffic_out_bytes"
    dest  = "interface.traffic.out.bytes"
  [[processors.rename.replace]]
    field = "errors_in"
    dest  = "interface.errors.in"
  [[processors.rename.replace]]
    field = "errors_out"
    dest  = "interface.errors.out"

[[outputs.elasticsearch]]
  urls      = ["https://YOUR_ES_HOST:9200"]
  username  = "elastic"
  password  = "YOUR_PASSWORD"
  index_name = "snmp-%Y.%m.%d"
  pipeline  = "snmp-device-enrichment"
  [outputs.elasticsearch.headers]
    Content-Type = "application/json"
`;

const ELASTIC_AGENT_MD = `# Elastic Agent — SNMP Integration

The official **Elastic SNMP integration** (in technical preview as of 8.x) collects
interface metrics via Elastic Agent Fleet policies.

## Setup

1. In Kibana → **Fleet** → **Agent Policies** → Add integration → search **SNMP**
2. Configure the target device IP, community string, and OID list
3. The integration writes to \`logs-snmp.*\` data streams

## Field remapping

Elastic Agent's SNMP integration uses different field paths than this plugin's schema.
Add the following **ingest pipeline processor** to remap fields before they reach
the plugin's indices.

Create a pipeline named \`snmp-elastic-agent-remap\` and set it as the
\`default_pipeline\` on the \`logs-snmp.*\` index template, or chain it into the
existing \`snmp-device-enrichment\` pipeline:

\`\`\`json
{
  "processors": [
    { "rename": { "field": "snmp.sysName",    "target_field": "host.name",          "ignore_missing": true } },
    { "rename": { "field": "snmp.sysDescr",   "target_field": "observer.sys_descr", "ignore_missing": true } },
    { "rename": { "field": "snmp.ifDescr",    "target_field": "interface.name",     "ignore_missing": true } },
    { "rename": { "field": "snmp.ifSpeed",    "target_field": "interface.speed",    "ignore_missing": true } },
    { "rename": { "field": "snmp.ifInOctets", "target_field": "interface.traffic.in.bytes",  "ignore_missing": true } },
    { "rename": { "field": "snmp.ifOutOctets","target_field": "interface.traffic.out.bytes", "ignore_missing": true } },
    { "rename": { "field": "snmp.ifAdminStatus", "target_field": "interface.status.admin", "ignore_missing": true } },
    { "rename": { "field": "snmp.ifOperStatus",  "target_field": "interface.status.oper",  "ignore_missing": true } },
    { "rename": { "field": "snmp.ipNetToMediaPhysAddress", "target_field": "arp.mac_addr",   "ignore_missing": true } },
    { "rename": { "field": "snmp.ipNetToMediaNetAddress",  "target_field": "arp.ip_addr",    "ignore_missing": true } },
    { "rename": { "field": "snmp.ipNetToMediaIfIndex",     "target_field": "arp.interface_index", "ignore_missing": true } },
    { "rename": { "field": "snmp.dot1dTpFdbAddress", "target_field": "mac_table.mac_addr",   "ignore_missing": true } },
    { "rename": { "field": "snmp.dot1dTpFdbPort",    "target_field": "mac_table.port_index",  "ignore_missing": true } },
    { "rename": { "field": "snmp.dot1dTpFdbStatus",  "target_field": "mac_table.status",      "ignore_missing": true } }
  ]
}
\`\`\`
`;

const DIRECT_CONF = `# Direct Elasticsearch indexing (Python / custom script)
# POST documents to the snmp-* index that match the plugin schema exactly.
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
    "https://YOUR_ES_HOST:9200/snmp-today/_doc?pipeline=snmp-device-enrichment",
    json=doc,
    auth=("elastic", "YOUR_PASSWORD"),
    verify=False
)
`;

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
    logstash:       { label: 'Logstash',       lang: 'ruby',   content: LOGSTASH_CONF },
    'elastic-agent':{ label: 'Elastic Agent',  lang: 'markdown', content: ELASTIC_AGENT_MD },
    telegraf:       { label: 'Telegraf',        lang: 'toml',   content: TELEGRAF_TOML },
    direct:         { label: 'Direct / Custom', lang: 'python', content: DIRECT_CONF },
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
              <EuiHealth color={health.indexTemplate.installed ? 'success' : 'danger'}>
                <strong>Index template</strong> (snmp-data) —{' '}
                {health.indexTemplate.installed ? 'Installed' : 'Not found — run scripts/setup.sh to install'}
              </EuiHealth>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiHealth color={health.ingestPipeline.installed ? 'success' : 'danger'}>
                <strong>Ingest pipeline</strong> (snmp-device-enrichment) —{' '}
                {health.ingestPipeline.installed ? 'Installed' : 'Not found — run scripts/setup.sh to install'}
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
            The <strong>index template</strong> (<code>snmp-network-o11y</code>) applies field mappings to every{' '}
            <code>snmp-*</code> index. Critical mappings include <code>host.ip</code>, <code>ip_addr.address</code>,
            and <code>arp.ip_addr</code> as <code>ip</code> type — this enables native CIDR term queries for segment
            filtering. <code>ip_addr.network</code> is mapped as <code>keyword</code> so it can be aggregated
            directly. The <strong>ingest pipeline</strong> auto-classifies device type and vendor from the raw{' '}
            <code>observer.sys_descr</code> SNMP field.
          </p>
          <p>
            Apply the index template before indexing data (it only affects new indices). The template definition
            is at <code>docs/elasticsearch/index-template.json</code>:
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiCodeBlock language="bash" isCopyable paddingSize="m">
          {`# Apply index template\ncurl -X PUT "https://YOUR_ES_HOST:9200/_index_template/snmp-network-o11y" \\\n  -H "Content-Type: application/json" \\\n  -u elastic:YOUR_PASSWORD \\\n  -d @docs/elasticsearch/index-template.json\n\n# Apply ingest pipeline (if using the enrichment pipeline)\nbash scripts/setup.sh https://YOUR_ES_HOST:9200 elastic YOUR_PASSWORD`}
        </EuiCodeBlock>
        <EuiSpacer size="s" />
        <EuiText size="xs" color="subdued">
          <p>
            The template must be applied before data is indexed. If you already have data in <code>snmp-*</code> indices,
            reindex into a new index (e.g. <code>snmp-reindex</code>) with the template applied first.
          </p>
        </EuiText>
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
