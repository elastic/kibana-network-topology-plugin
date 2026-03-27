# Field Reference & ECS Compliance

This document describes every Elasticsearch field the plugin reads or writes,
its ECS compliance status, mapping type, and expected values.

## ECS Status Key

| Badge | Meaning |
|-------|---------|
| **Core ECS** | Defined in the [Elastic Common Schema](https://www.elastic.co/guide/en/ecs/current/index.html) and used as specified |
| **ECS ext.** | Uses an ECS-defined namespace but with values that extend beyond the official spec |
| **Custom** | No ECS equivalent — SNMP-specific data for which ECS does not define field sets |

---

## Base Fields

| Field | Type | ECS Status | Description | Example |
|-------|------|-----------|-------------|---------|
| `@timestamp` | date | Core ECS | Document timestamp — when the SNMP poll was collected | `2024-01-01T12:00:00.000Z` |

---

## `host.*` — Device Identity

ECS `host` fields identify the monitored network device.

| Field | Type | ECS Status | Description | Example |
|-------|------|-----------|-------------|---------|
| `host.name` | keyword | Core ECS | Device hostname (SNMP `sysName`) | `hq-core-rtr-01` |
| `host.ip` | ip | Core ECS | Primary management IP address | `10.1.1.2` |
| `host.mac` | keyword | Core ECS | Primary MAC address | `aa:bb:cc:dd:ee:01` |
| `host.type` | keyword | ECS ext. | Device category — set explicitly in the Logstash/Telegraf collector config. The ingest pipeline can infer it from `observer.sys_descr` as a fallback when unset. | `router`, `switch`, `firewall`, `server`, `ap`, `unknown` |

---

## `observer.*` — Device Classification

ECS `observer` fields describe the network device as the observed system.

| Field | Type | ECS Status | Description | Example |
|-------|------|-----------|-------------|---------|
| `observer.vendor` | keyword | Core ECS | Vendor name — auto-detected from `observer.sys_descr` by the ingest pipeline | `Cisco`, `Juniper`, `Palo Alto`, `Arista`, `Fortinet`, `HPE`, `Aruba` |
| `observer.sys_descr` | text | Core ECS | Raw SNMP `sysDescr` string — the ingest pipeline uses this to populate `observer.vendor` and `host.type` | `Cisco IOS XR Software, ASR 9000 Series Router` |
| `observer.os.full` | keyword | Core ECS | Full OS version string | `IOS-XR 7.3.2`, `Junos 22.1R1` |

---

## `network.*` — Location & Role Metadata

These fields provide hierarchical location context for the device. The ECS `network`
field set covers protocol/transport data; the site/building/role fields below are
justified custom extensions within that namespace.

| Field | Type | ECS Status | Description | Example |
|-------|------|-----------|-------------|---------|
| `network.site` | keyword | ECS ext. | Site or datacenter identifier. Defaults to `Ungrouped` if absent (set by ingest pipeline). | `HQ-DC1`, `Branch-NYC`, `Branch-CHI` |
| `network.building` | keyword | ECS ext. | Building within the site | `Main`, `Annex`, `Tower-B` |
| `network.role` | keyword | ECS ext. | Network tier — used for topology hierarchy. Controls the vertical position of nodes in the topology map. | `core`, `distribution`, `access`, `server` |

---

## `interface.*` — SNMP Interface Metrics (Custom)

No ECS field set covers SNMP interface MIB (IF-MIB, RFC 2863) data.
These fields are plugin-defined under a consistent `interface.*` namespace.

| Field | Type | ECS Status | SNMP MIB OID | Description | Example |
|-------|------|-----------|--------------|-------------|---------|
| `interface.name` | keyword | Custom | `ifDescr` (1.3.6.1.2.1.2.2.1.2) | Interface name | `Gi0/0/0`, `eth0`, `xe-0/0/0` |
| `interface.speed` | long | Custom | `ifSpeed` (1.3.6.1.2.1.2.2.1.5) | Interface speed in bits/sec | `10000000000` (10 Gbps) |
| `interface.status.admin` | keyword | Custom | `ifAdminStatus` (1.3.6.1.2.1.2.2.1.7) | Administrative status | `up`, `down` |
| `interface.status.oper` | keyword | Custom | `ifOperStatus` (1.3.6.1.2.1.2.2.1.8) | Operational status | `up`, `down`, `testing` |
| `interface.traffic.in.bytes` | long | Custom | `ifInOctets` (1.3.6.1.2.1.2.2.1.10) | Cumulative inbound bytes | `125000000` |
| `interface.traffic.out.bytes` | long | Custom | `ifOutOctets` (1.3.6.1.2.1.2.2.1.16) | Cumulative outbound bytes | `87500000` |
| `interface.errors.in` | long | Custom | `ifInErrors` (1.3.6.1.2.1.2.2.1.14) | Inbound error count | `0` |
| `interface.errors.out` | long | Custom | `ifOutErrors` (1.3.6.1.2.1.2.2.1.20) | Outbound error count | `0` |

> **Note:** These are cumulative counters (not rates). If you need bits/sec, compute
> the delta between two consecutive polls in your collector or with a Kibana scripted field.

---

## `arp.*` — ARP Table Entries (Custom)

Populated from the IP-MIB `ipNetToMediaTable` (RFC 1213, OID `1.3.6.1.2.1.4.22`).
Used to infer layer-3 adjacency in the topology map.

| Field | Type | ECS Status | SNMP MIB OID | Description | Example |
|-------|------|-----------|--------------|-------------|---------|
| `arp.ip_addr` | ip | Custom | `ipNetToMediaNetAddress` (.4) | ARP neighbor IP address | `10.1.1.3` |
| `arp.mac_addr` | keyword | Custom | `ipNetToMediaPhysAddress` (.2) | ARP neighbor MAC address | `aa:bb:cc:dd:ee:02` |
| `arp.interface_index` | integer | Custom | `ipNetToMediaIfIndex` (.1) | Interface on which the ARP entry was learned | `1` |

---

## `mac_table.*` — MAC Forwarding Table Entries (Custom)

Populated from the BRIDGE-MIB `dot1dTpFdbTable` (RFC 1493, OID `1.3.6.1.2.1.17.4.3`).
Used to infer layer-2 adjacency between switches in the topology map.

| Field | Type | ECS Status | SNMP MIB OID | Description | Example |
|-------|------|-----------|--------------|-------------|---------|
| `mac_table.mac_addr` | keyword | Custom | `dot1dTpFdbAddress` (.1) | MAC address in forwarding table | `aa:bb:cc:dd:ee:05` |
| `mac_table.port_index` | integer | Custom | `dot1dTpFdbPort` (.2) | Bridge port on which this MAC was seen | `2` |
| `mac_table.status` | keyword | Custom | `dot1dTpFdbStatus` (.3) | Entry type | `learned`, `static`, `mgmt` |

---

## `ip_addr.*` — IP Address Table Entries (Custom)

Populated from the IP-MIB `ipAddrTable` (RFC 1213, OID `1.3.6.1.2.1.4.20`).
Used to determine which network segments (CIDRs) each device participates in.

| Field | Type | ECS Status | SNMP MIB OID | Description | Example |
|-------|------|-----------|--------------|-------------|---------|
| `ip_addr.address` | ip | Custom | `ipAdEntAddr` (.1) | Interface IP address — used for CIDR-based segment lookups | `192.168.10.1` |
| `ip_addr.netmask` | keyword | Custom | `ipAdEntNetMask` (.3) | Interface subnet mask | `255.255.255.0` |
| `ip_addr.network` | keyword | Custom | *computed* | CIDR block derived from address & netmask — used for segment grouping | `192.168.10.0/24` |
| `ip_addr.prefix_length` | integer | Custom | *computed* | Prefix length derived from netmask | `24` |
| `ip_addr.if_index` | integer | Custom | `ipAdEntIfIndex` (.2) | Interface index linking this IP to an interface row | `3` |

> **Note:** Loopback (127.x), link-local (169.254.x), multicast (≥224), and unspecified (0.x)
> addresses are filtered out at collection time.

---

## Document Types

A single SNMP poll cycle produces **four document types** per device,
all indexed into `snmp-YYYY.MM.dd`:

| Document type | Distinguishing field | Purpose |
|---------------|----------------------|---------|
| Interface metrics | `interface.name` present | Per-interface status, speed, traffic, errors |
| ARP entry | `arp.mac_addr` present | Layer-3 neighbor discovery |
| MAC table entry | `mac_table.mac_addr` present | Layer-2 forwarding topology |
| IP address entry | `ip_addr.address` present | Interface IPs and subnet membership for segment views |

All four share the same `host.*`, `observer.*`, and `network.*` fields to identify
which device the data belongs to.

---

## Ingest Pipeline: `snmp-device-enrichment`

The pipeline performs the following on every incoming document:

1. **Device type default** — sets `host.type = "unknown"` if the field is absent
2. **Site default** — sets `network.site = "Ungrouped"` if the field is absent
3. **Device type inference** (fallback) — if `host.type` is still `"unknown"`, keyword match on
   `observer.sys_descr` → sets `host.type` (router, switch, firewall, ap, server).
   This is a best-effort fallback; setting `host.type` explicitly in the collector config is preferred.
4. **Vendor detection** — regex match on `observer.sys_descr` → sets `observer.vendor`
   (covers Cisco, Juniper, Arista, Fortinet, Palo Alto, HPE, Aruba)

The pipeline is created by `scripts/setup_elasticsearch.sh`.
