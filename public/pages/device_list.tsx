import React, { useEffect, useState, useCallback } from 'react';
import {
  EuiBasicTable, EuiHealth, EuiFieldSearch, EuiSpacer,
  EuiFlexGroup, EuiFlexItem, EuiCallOut,
} from '@elastic/eui';
import { useApi } from '../hooks/use_api';
import type { NetworkDevice } from '../../common';
import { STATUS_COLORS } from '../../common';

interface Props { site?: string; from: string; to: string; refreshKey: number; }

export const DeviceListView: React.FC<Props> = ({ site, from, to, refreshKey }) => {
  const api = useApi();
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.fetchDevices({ site, page, pageSize, search: search || undefined, from, to });
      setDevices(r.devices); setTotal(r.total); setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [api, site, page, pageSize, search, from, to]);

  useEffect(() => { fetchData(); }, [fetchData, refreshKey]);

  if (error) return <EuiCallOut title="Error" color="danger"><p>{error}</p></EuiCallOut>;

  return (
    <div style={{ alignSelf: 'flex-start', width: '100%' }}>
      <EuiFlexGroup><EuiFlexItem>
        <EuiFieldSearch placeholder="Search devices..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }} isClearable fullWidth />
      </EuiFlexItem></EuiFlexGroup>
      <EuiSpacer size="m" />
      <EuiBasicTable items={devices} loading={loading}
        columns={[
          { field: 'status', name: 'Status', width: '80px', render: (s: string) => <EuiHealth color={STATUS_COLORS[s] || '#98A2B3'}>{s}</EuiHealth> },
          { field: 'name', name: 'Hostname', sortable: true },
          { field: 'ip', name: 'IP Address' },
          { field: 'type', name: 'Type' },
          { field: 'vendor', name: 'Vendor' },
          { field: 'site', name: 'Site' },
          { field: 'interfaceCount', name: 'Interfaces', width: '100px' },
          { field: 'downInterfaceCount', name: 'Down', width: '80px', render: (c: number) => <span style={{ color: c > 0 ? STATUS_COLORS.down : 'inherit' }}>{c}</span> },
        ]}
        pagination={{ pageIndex: page, pageSize, totalItemCount: total, pageSizeOptions: [25, 50, 100] }}
        onChange={({ page: p }: any) => { if (p) { setPage(p.index); setPageSize(p.size); } }}
      />
    </div>
  );
};
