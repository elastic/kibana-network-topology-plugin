import React, { useEffect, useState } from 'react';
import {
  EuiFlyout, EuiFlyoutHeader, EuiFlyoutBody, EuiTitle, EuiHealth,
  EuiBasicTable, EuiFlexGroup, EuiFlexItem, EuiSpacer, EuiLoadingSpinner,
  EuiCallOut, EuiDescriptionList, EuiBadge, EuiTabs, EuiTab,
} from '@elastic/eui';
import { useApi } from '../hooks/use_api';
import type { DeviceDetailResponse } from '../../common';
import { DEVICE_TYPE_CONFIG, STATUS_EUI_COLORS, BGP_EUI_COLORS, OSPF_EUI_COLORS } from '../../common';

interface Props { deviceId: string; onClose: () => void; from: string; to: string; }

function fmtBytes(b: number) { if (!b) return '0 B'; const k = 1024; const s = ['B','KB','MB','GB','TB']; const i = Math.floor(Math.log(b)/Math.log(k)); return `${(b/Math.pow(k,i)).toFixed(1)} ${s[i]}`; }
function fmtSpeed(bps: number) { if (bps >= 1e9) return `${(bps/1e9).toFixed(0)} Gbps`; if (bps >= 1e6) return `${(bps/1e6).toFixed(0)} Mbps`; return `${bps} bps`; }
function fmtUptime(s: number) { if (!s) return '—'; const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60); return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`; }
function fmtNum(n: number) { return n >= 1000 ? n.toLocaleString() : String(n); }

export const DeviceFlyout: React.FC<Props> = ({ deviceId, onClose, from, to }) => {
  const api = useApi();
  const [data, setData] = useState<DeviceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'interfaces' | 'neighbors' | 'bgp' | 'ospf'>('interfaces');

  useEffect(() => {
    let c = false; setLoading(true);
    api.fetchDeviceDetail(deviceId, { from, to })
      .then(r => { if (!c) { setData(r); setLoading(false); } })
      .catch(e => { if (!c) { setError(e.message); setLoading(false); } });
    return () => { c = true; };
  }, [api, deviceId]);

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus>
      <EuiFlyoutHeader hasBorder>
        {loading ? <EuiLoadingSpinner size="l" /> : data ? (
          <>
            <EuiFlexGroup alignItems="center" gutterSize="m">
              <EuiFlexItem grow={false}><EuiBadge color={DEVICE_TYPE_CONFIG[data.device.type]?.color || '#98A2B3'}>{data.device.type}</EuiBadge></EuiFlexItem>
              <EuiFlexItem><EuiTitle size="m"><h2>{data.device.name}</h2></EuiTitle></EuiFlexItem>
              <EuiFlexItem grow={false}><EuiHealth color={STATUS_EUI_COLORS[data.device.status] || 'subdued'}>{data.device.status}</EuiHealth></EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer size="s" />
            <EuiDescriptionList type="inline" compressed listItems={[
              { title: 'IP', description: data.device.ip || '—' },
              { title: 'Vendor', description: data.device.vendor || '—' },
              { title: 'Site', description: data.device.site || '—' },
              { title: 'Role', description: data.device.role || '—' },
              { title: 'Interfaces', description: `${data.device.interfaceCount} (${data.device.downInterfaceCount} down)` },
            ]} />
          </>
        ) : null}
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        {error && <EuiCallOut title="Error" color="danger"><p>{error}</p></EuiCallOut>}
        {data && (
          <>
            <EuiTabs size="s">
              <EuiTab isSelected={tab === 'interfaces'} onClick={() => setTab('interfaces')}>Interfaces ({data.interfaces.length})</EuiTab>
              <EuiTab isSelected={tab === 'neighbors'} onClick={() => setTab('neighbors')}>ARP Neighbors ({data.neighbors.length})</EuiTab>
              {data.bgpPeers.length > 0 && <EuiTab isSelected={tab === 'bgp'} onClick={() => setTab('bgp')}>BGP Peers ({data.bgpPeers.length})</EuiTab>}
              {data.ospfNeighbors.length > 0 && <EuiTab isSelected={tab === 'ospf'} onClick={() => setTab('ospf')}>OSPF ({data.ospfNeighbors.length})</EuiTab>}
            </EuiTabs>
            <EuiSpacer size="m" />
            {tab === 'interfaces' && <EuiBasicTable items={data.interfaces} compressed columns={[
              { field: 'operStatus', name: 'Status', width: '70px', render: (s: string) => <EuiHealth color={STATUS_EUI_COLORS[s] || 'subdued'}>{s}</EuiHealth> },
              { field: 'name', name: 'Interface', sortable: true },
              { field: 'speed', name: 'Speed', width: '100px', render: fmtSpeed },
              { field: 'trafficIn', name: 'In', render: fmtBytes },
              { field: 'trafficOut', name: 'Out', render: fmtBytes },
              { field: 'errorsIn', name: 'Err In', width: '70px' },
              { field: 'errorsOut', name: 'Err Out', width: '70px' },
            ]} />}
            {tab === 'neighbors' && <EuiBasicTable items={data.neighbors} compressed columns={[
              { field: 'ip', name: 'IP Address' }, { field: 'mac', name: 'MAC Address' },
            ]} />}
            {tab === 'bgp' && <EuiBasicTable items={data.bgpPeers} compressed columns={[
              { field: 'state', name: 'State', width: '100px', render: (s: string) => <EuiHealth color={BGP_EUI_COLORS[s] || 'subdued'}>{s}</EuiHealth> },
              { field: 'remoteIP', name: 'Peer IP' },
              { field: 'remoteASN', name: 'Remote AS', width: '90px' },
              { field: 'prefixesReceived', name: 'Pfx RX', width: '90px', render: fmtNum },
              { field: 'prefixesSent', name: 'Pfx TX', width: '80px', render: fmtNum },
              { field: 'uptimeSeconds', name: 'Uptime', width: '80px', render: fmtUptime },
              { field: 'inUpdates', name: 'Upd In', width: '80px', render: fmtNum },
              { field: 'outUpdates', name: 'Upd Out', width: '80px', render: fmtNum },
            ]} />}
            {tab === 'ospf' && <EuiBasicTable items={data.ospfNeighbors} compressed columns={[
              { field: 'state', name: 'State', width: '90px', render: (s: string) => <EuiHealth color={OSPF_EUI_COLORS[s] || 'subdued'}>{s}</EuiHealth> },
              { field: 'neighborIP', name: 'Neighbor IP' },
              { field: 'routerID', name: 'Router ID' },
              { field: 'areaID', name: 'Area', width: '100px' },
              { field: 'priority', name: 'Priority', width: '70px' },
              { field: 'retransCount', name: 'Events', width: '70px' },
            ]} />}
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
