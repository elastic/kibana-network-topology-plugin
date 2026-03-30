# Elastic Agent — SNMP Integration

The official **Elastic SNMP integration** collects interface metrics via Elastic Agent
Fleet policies. As of Elastic Stack 8.x it is available in technical preview.

## Setup in Fleet

1. In Kibana → **Fleet** → **Agent Policies** → add or select a policy
2. **Add integration** → search for **SNMP**
3. Configure the integration:
   - **Host**: `DEVICE_IP:161`
   - **Community**: `public` (or your community string)
   - **Version**: `2c`
   - **Poll interval**: `60s`
4. The integration writes to the `logs-snmp.*` data stream

## Field Remapping

The Elastic Agent SNMP integration uses `snmp.*` field paths, while this plugin
expects the schema defined in [../field-reference.md](../field-reference.md).

### Option A — Ingest pipeline (recommended)

Create a pipeline named `snmp-elastic-agent-remap` and set it as the default
pipeline on the data stream, or prepend it in your existing `snmp-device-enrichment`
pipeline using the `pipeline` processor.

```json
PUT _ingest/pipeline/snmp-elastic-agent-remap
{
  "description": "Remap Elastic Agent SNMP fields to logs-snmp.topology schema",
  "processors": [
    { "rename": { "field": "snmp.sysName",            "target_field": "host.name",                      "ignore_missing": true } },
    { "rename": { "field": "snmp.sysDescr",           "target_field": "observer.sys_descr",             "ignore_missing": true } },
    { "rename": { "field": "snmp.ifDescr",            "target_field": "interface.name",                 "ignore_missing": true } },
    { "rename": { "field": "snmp.ifSpeed",            "target_field": "interface.speed",                "ignore_missing": true } },
    { "rename": { "field": "snmp.ifAdminStatus",      "target_field": "interface.status.admin",         "ignore_missing": true } },
    { "rename": { "field": "snmp.ifOperStatus",       "target_field": "interface.status.oper",          "ignore_missing": true } },
    { "rename": { "field": "snmp.ifInOctets",         "target_field": "interface.traffic.in.bytes",     "ignore_missing": true } },
    { "rename": { "field": "snmp.ifOutOctets",        "target_field": "interface.traffic.out.bytes",    "ignore_missing": true } },
    { "rename": { "field": "snmp.ifInErrors",         "target_field": "interface.errors.in",            "ignore_missing": true } },
    { "rename": { "field": "snmp.ifOutErrors",        "target_field": "interface.errors.out",           "ignore_missing": true } },
    { "rename": { "field": "snmp.ipNetToMediaPhysAddress", "target_field": "arp.mac_addr",           "ignore_missing": true } },
    { "rename": { "field": "snmp.ipNetToMediaNetAddress",  "target_field": "arp.ip_addr",           "ignore_missing": true } },
    { "rename": { "field": "snmp.ipNetToMediaIfIndex",     "target_field": "arp.interface_index",    "ignore_missing": true } },
    { "rename": { "field": "snmp.dot1dTpFdbAddress",  "target_field": "mac_table.mac_addr",        "ignore_missing": true } },
    { "rename": { "field": "snmp.dot1dTpFdbPort",     "target_field": "mac_table.port_index",      "ignore_missing": true } },
    { "rename": { "field": "snmp.dot1dTpFdbStatus",   "target_field": "mac_table.status",          "ignore_missing": true } },
    { "rename": { "field": "snmp.ipAdEntAddr",        "target_field": "ip_addr.address",           "ignore_missing": true } },
    { "rename": { "field": "snmp.ipAdEntNetMask",     "target_field": "ip_addr.netmask",           "ignore_missing": true } },
    { "rename": { "field": "snmp.ipAdEntIfIndex",     "target_field": "ip_addr.if_index",          "ignore_missing": true } },
    { "pipeline": { "name": "snmp-device-enrichment", "ignore_missing_pipeline": true } }
  ]
}
```

### Option B — Re-index into `logs-snmp.*`

If you prefer to keep the Elastic Agent data stream untouched, run a periodic
re-index (or use an Enrich policy) to copy documents from `logs-snmp.*` into
the `logs-snmp.topology-default` data stream with the field names remapped.

## Data stream

The plugin's default query pattern is `logs-snmp.*`. After remapping, the
re-indexed data will be automatically included as long as it targets a data
stream matching that pattern (e.g. `logs-snmp.topology-default`).

## Notes

- The Elastic Agent SNMP integration does not currently collect ARP tables, MAC
  forwarding tables, or IP address tables. For topology link discovery and
  network segment features you will need a supplementary collector (Logstash or
  Telegraf) for those document types.
- The `ip_addr.network` (CIDR) field must be computed from `ip_addr.address` and
  `ip_addr.netmask` at ingest time. The remap pipeline above copies the raw
  values; you will need an additional script processor to compute the CIDR if
  Elastic Agent gains ipAddrTable support in the future.
- `host.type` should be set explicitly in the collector config where possible.
  The `snmp-device-enrichment` pipeline infers it from `observer.sys_descr` as
  a fallback, but vendor string matching is unreliable across device models.
