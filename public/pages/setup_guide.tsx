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

const LOGSTASH_CONF = `# Logstash SNMP collector — writes directly to the plugin schema.
# Requires the logstash-input-snmp plugin: bin/logstash-plugin install logstash-input-snmp

# ─── Interface metrics pipeline ───────────────────────────────────────────────
input {
  snmp {
    hosts => [{ host => "udp:DEVICE_IP/161" community => "public" version => "2c" }]
    walk  => ["1.3.6.1.2.1.2.2"]          # ifTable
    get   => ["1.3.6.1.2.1.1.5.0",        # sysName
              "1.3.6.1.2.1.1.1.0"]        # sysDescr
    interval => 60
    tables => [{
      name    => "ifTable"
      columns => ["1.3.6.1.2.1.2.2.1.2",  # ifDescr  → interface.name
                  "1.3.6.1.2.1.2.2.1.5",  # ifSpeed  → interface.speed
                  "1.3.6.1.2.1.2.2.1.7",  # ifAdminStatus
                  "1.3.6.1.2.1.2.2.1.8",  # ifOperStatus
                  "1.3.6.1.2.1.2.2.1.10", # ifInOctets
                  "1.3.6.1.2.1.2.2.1.16", # ifOutOctets
                  "1.3.6.1.2.1.2.2.1.14", # ifInErrors
                  "1.3.6.1.2.1.2.2.1.20"] # ifOutErrors
    }]
    add_field => {
      "[host][ip]"     => "DEVICE_IP"
      "[network][site]" => "YOUR_SITE_NAME"
      "[network][role]" => "access"         # core | distribution | access | server
    }
  }
}

filter {
  mutate {
    rename => {
      "[SNMPv2-MIB::sysName][0]"   => "[host][name]"
      "[SNMPv2-MIB::sysDescr][0]"  => "[observer][sys_descr]"
      "[ifTable][ifDescr]"         => "[interface][name]"
      "[ifTable][ifSpeed]"         => "[interface][speed]"
      "[ifTable][ifInOctets]"      => "[interface][traffic][in][bytes]"
      "[ifTable][ifOutOctets]"     => "[interface][traffic][out][bytes]"
      "[ifTable][ifInErrors]"      => "[interface][errors][in]"
      "[ifTable][ifOutErrors]"     => "[interface][errors][out]"
    }
    # Map integer status codes to strings
    gsub => ["[ifTable][ifAdminStatus]", "^1$", "up",
             "[ifTable][ifAdminStatus]", "^2$", "down"]
    gsub => ["[ifTable][ifOperStatus]",  "^1$", "up",
             "[ifTable][ifOperStatus]",  "^2$", "down",
             "[ifTable][ifOperStatus]",  "^3$", "testing"]
    rename => {
      "[ifTable][ifAdminStatus]" => "[interface][status][admin]"
      "[ifTable][ifOperStatus]"  => "[interface][status][oper]"
    }
  }
}

output {
  elasticsearch {
    hosts    => ["https://YOUR_ES_HOST:9200"]
    user     => "elastic"
    password => "YOUR_PASSWORD"
    index    => "snmp-%{+YYYY.MM.dd}"
    pipeline => "snmp-device-enrichment"   # auto-enriches vendor, host.type
  }
}

# ─── ARP table pipeline (run separately or on same device list) ───────────────
# Walk ipNetToMediaTable (1.3.6.1.2.1.4.22) and map:
#   ipNetToMediaPhysAddress → arp.mac_addr
#   ipNetToMediaNetAddress  → arp.ip_addr
`;

const TELEGRAF_TOML = `# Telegraf SNMP collector — writes to the plugin schema via the ES output plugin.
# Requires: Telegraf 1.20+, outputs.elasticsearch plugin

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

# Rename Telegraf fields to plugin schema before sending to ES
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
  # Apply the enrichment pipeline to auto-detect vendor/host.type
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
    { "rename": { "field": "snmp.ifOperStatus",  "target_field": "interface.status.oper",  "ignore_missing": true } }
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
  { field: 'mac_table.mac_addr',          type: 'keyword', ecs: 'Custom',     description: 'Bridge forwarding table MAC (dot1dTpFdbAddress)', example: 'aa:bb:cc:dd:ee:05' },
  { field: 'mac_table.port_index',        type: 'integer', ecs: 'Custom',     description: 'Bridge port index (dot1dTpFdbPort)', example: '2' },
  { field: 'ip_addr.address',             type: 'ip',      ecs: 'Custom',     description: 'Interface IP address (ipAdEntAddr) — used for subnet/segment lookup', example: '192.168.10.1' },
  { field: 'ip_addr.netmask',             type: 'keyword', ecs: 'Custom',     description: 'Interface subnet mask (ipAdEntNetMask)', example: '255.255.255.0' },
  { field: 'ip_addr.network',             type: 'keyword', ecs: 'Custom',     description: 'Computed CIDR block from address + netmask — used for segment grouping', example: '192.168.10.0/24' },
  { field: 'ip_addr.prefix_length',       type: 'integer', ecs: 'Custom',     description: 'Prefix length derived from netmask', example: '24' },
  { field: 'ip_addr.if_index',            type: 'integer', ecs: 'Custom',     description: 'Interface index (ipAdEntIfIndex) linking this IP to an interface row', example: '3' },
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
