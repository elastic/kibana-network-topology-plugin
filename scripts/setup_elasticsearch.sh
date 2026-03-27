#!/usr/bin/env bash
set -euo pipefail
ES_URL="${1:-https://localhost:9200}"
ES_USER="${2:-elastic}"
ES_PASS="${3:-09ed4afed47fd7533d9eef6438cefd81cdde512b306304d55dec0e35e77f9f8d}"
CURL="curl -k -s -u ${ES_USER}:${ES_PASS}"

echo "=== Network Topology Plugin: Elasticsearch Setup ==="

echo "[1/3] Creating ingest pipeline: snmp-device-enrichment"
$CURL -X PUT "${ES_URL}/_ingest/pipeline/snmp-device-enrichment" -H 'Content-Type: application/json' -d '
{
  "description": "Enrich SNMP device data",
  "processors": [
    { "set": { "field": "host.type", "value": "unknown", "if": "ctx.host?.type == null" } },
    { "set": { "field": "network.site", "value": "Ungrouped", "if": "ctx.network?.site == null" } },
    { "script": { "if": "ctx.host?.type == \"unknown\" && ctx.observer?.sys_descr != null", "source": "def d=ctx.observer.sys_descr.toLowerCase();if(d.contains(\"router\")||d.contains(\"ios xr\")||d.contains(\"junos\")){ctx.host.type=\"router\"}else if(d.contains(\"switch\")||d.contains(\"catalyst\")||d.contains(\"nexus\")||d.contains(\"eos\")){ctx.host.type=\"switch\"}else if(d.contains(\"firewall\")||d.contains(\"asa\")||d.contains(\"fortigate\")||d.contains(\"palo alto\")){ctx.host.type=\"firewall\"}else if(d.contains(\"access point\")||d.contains(\"aironet\")||d.contains(\"aruba ap\")){ctx.host.type=\"ap\"}else if(d.contains(\"linux\")||d.contains(\"windows\")||d.contains(\"vmware\")){ctx.host.type=\"server\"}" } },
    { "script": { "if": "ctx.observer?.vendor == null && ctx.observer?.sys_descr != null", "source": "def d=ctx.observer.sys_descr.toLowerCase();if(d.contains(\"cisco\")){ctx.observer.vendor=\"Cisco\"}else if(d.contains(\"juniper\")){ctx.observer.vendor=\"Juniper\"}else if(d.contains(\"arista\")){ctx.observer.vendor=\"Arista\"}else if(d.contains(\"fortinet\")){ctx.observer.vendor=\"Fortinet\"}else if(d.contains(\"palo alto\")){ctx.observer.vendor=\"Palo Alto\"}else if(d.contains(\"aruba\")||d.contains(\"hpe\")){ctx.observer.vendor=\"HPE/Aruba\"}else{ctx.observer.vendor=\"Unknown\"}" } }
  ]
}'
echo " done."

# The template name matches what setup.ts checks for (API_ROUTES.SETUP_HEALTH).
# ip_addr.address and arp.ip_addr are mapped as ip type so native CIDR term queries
# work: { "term": { "ip_addr.address": "192.168.10.0/24" } } matches all interface
# IPs inside that subnet — this is how segment filtering resolves device membership.
# ip_addr.network is keyword (not text) so terms aggregations work without .keyword.
echo "[2/3] Creating index template: snmp-network-o11y"
$CURL -X PUT "${ES_URL}/_index_template/snmp-network-o11y" -H 'Content-Type: application/json' -d '
{
  "index_patterns": ["snmp-*", "logstash-snmp-*"],
  "priority": 200,
  "template": {
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0,
      "index.default_pipeline": "snmp-device-enrichment"
    },
    "mappings": {
      "dynamic": true,
      "properties": {
        "@timestamp": { "type": "date" },
        "host": {
          "properties": {
            "name": { "type": "keyword" },
            "ip":   { "type": "ip" },
            "mac":  { "type": "keyword" },
            "type": { "type": "keyword" }
          }
        },
        "observer": {
          "properties": {
            "vendor":    { "type": "keyword" },
            "type":      { "type": "keyword" },
            "sys_descr": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
            "os":        { "properties": { "full": { "type": "keyword" } } }
          }
        },
        "network": {
          "properties": {
            "site":     { "type": "keyword" },
            "building": { "type": "keyword" },
            "role":     { "type": "keyword" }
          }
        },
        "interface": {
          "properties": {
            "name":  { "type": "keyword" },
            "speed": { "type": "long" },
            "status": {
              "properties": {
                "admin": { "type": "keyword" },
                "oper":  { "type": "keyword" }
              }
            },
            "traffic": {
              "properties": {
                "in":  { "properties": { "bytes": { "type": "long" } } },
                "out": { "properties": { "bytes": { "type": "long" } } }
              }
            },
            "errors": {
              "properties": {
                "in":  { "type": "long" },
                "out": { "type": "long" }
              }
            }
          }
        },
        "ip_addr": {
          "properties": {
            "address":       { "type": "ip" },
            "netmask":       { "type": "keyword" },
            "network":       { "type": "keyword" },
            "prefix_length": { "type": "integer" },
            "if_index":      { "type": "integer" }
          }
        },
        "arp": {
          "properties": {
            "ip_addr":         { "type": "ip" },
            "mac_addr":        { "type": "keyword" },
            "interface_index": { "type": "integer" }
          }
        },
        "mac_table": {
          "properties": {
            "mac_addr":   { "type": "keyword" },
            "port_index": { "type": "integer" },
            "status":     { "type": "keyword" }
          }
        }
      }
    }
  }
}'
echo " done."

echo "[3/3] Creating initial index: snmp-topology"
$CURL -X PUT "${ES_URL}/snmp-topology" -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true
echo " done."
echo ""
echo "=== Setup complete. Run: node scripts/generate_sample_data.mjs ==="
