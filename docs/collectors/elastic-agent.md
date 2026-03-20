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
  "description": "Remap Elastic Agent SNMP fields to kibana-network-o11y schema",
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
    { "rename": { "field": "snmp.ipNetToMediaPhysAddress", "target_field": "arp.mac_addr",              "ignore_missing": true } },
    { "rename": { "field": "snmp.ipNetToMediaNetAddress",  "target_field": "arp.ip_addr",               "ignore_missing": true } },
    { "rename": { "field": "snmp.dot1dTpFdbAddress",  "target_field": "mac_table.mac_addr",             "ignore_missing": true } },
    { "rename": { "field": "snmp.dot1dTpFdbPort",     "target_field": "mac_table.port_index",           "ignore_missing": true } },
    { "pipeline": { "name": "snmp-device-enrichment", "ignore_missing_pipeline": true } }
  ]
}
```

### Option B — Re-index into `snmp-*`

If you prefer to keep the Elastic Agent data stream untouched, run a periodic
re-index (or use an Enrich policy) to copy documents from `logs-snmp.*` into
`snmp-*` with the field names remapped.

## Index pattern

After remapping, the plugin's default index pattern (`snmp-*,logstash-snmp-*`)
will not cover `logs-snmp.*` unless you either:
- Change the plugin's index setting to include `logs-snmp-*`, or
- Re-index data into `snmp-*` as described above

## Notes

- The Elastic Agent SNMP integration does not currently collect ARP or MAC
  forwarding tables. For topology link discovery you will need a supplementary
  collector (Logstash or Telegraf) for those document types.
- Vendor and `host.type` enrichment is handled by the `snmp-device-enrichment`
  pipeline — make sure it is invoked either as part of the remap pipeline (as
  shown above) or as the data stream's default pipeline.
