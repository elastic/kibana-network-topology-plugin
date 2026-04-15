import React, { useEffect, useState, useCallback } from 'react';
import {
  EuiBasicTable, EuiHealth, EuiSpacer,
  EuiFlexGroup, EuiFlexItem, EuiCallOut, EuiText,
} from '@elastic/eui';
import type { Filter, Query } from '@kbn/es-query';
import type { DataPublicPluginStart } from '@kbn/data-plugin/public';
import type { UnifiedSearchPublicPluginStart } from '@kbn/unified-search-plugin/public';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { CoreStart } from '@kbn/core/public';
import { useApi } from '../hooks/use_api';
import { useDataViewSelector } from '../hooks/use_data_view_selector';
import type { NetworkDevice } from '../../common';
import { STATUS_EUI_COLORS } from '../../common';

interface Props { site?: string; from: string; to: string; refreshKey: number; }

type KibanaServices = CoreStart & { data: DataPublicPluginStart; unifiedSearch: UnifiedSearchPublicPluginStart };

export const DeviceListView: React.FC<Props> = ({ site, from, to, refreshKey }) => {
  const api = useApi();
  const { services } = useKibana<KibanaServices>();
  const SearchBar = services.unifiedSearch.ui.SearchBar;
  const { selectedDataView, savedDataViews, onChangeDataView } = useDataViewSelector();

  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  // query drives the SearchBar display; submittedQuery drives the actual fetch
  const [query, setQuery] = useState<Query>({ language: 'kuery', query: '' });
  const [submittedQuery, setSubmittedQuery] = useState<Query>({ language: 'kuery', query: '' });
  const [filters, setFilters] = useState<Filter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const kqlString = typeof submittedQuery.query === 'string' ? submittedQuery.query : '';
      const r = await api.fetchDevices({
        site,
        page,
        pageSize,
        kql: kqlString || undefined,
        filters: filters.length > 0 ? JSON.stringify(filters) : undefined,
        from,
        to,
        index: selectedDataView?.getIndexPattern(),
      });
      setDevices(r.devices); setTotal(r.total); setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [api, site, page, pageSize, submittedQuery, filters, from, to, selectedDataView]);

  useEffect(() => { fetchData(); }, [fetchData, refreshKey]);

  if (error) return <EuiCallOut title="Error" color="danger"><p>{error}</p></EuiCallOut>;

  const dataViewPickerProps = {
    trigger: {
      label: selectedDataView?.getName() ?? 'Select data view',
      title: selectedDataView?.getIndexPattern() ?? '',
    },
    currentDataViewId: selectedDataView?.id,
    savedDataViews,
    onChangeDataView,
  };

  return (
    <div style={{ alignSelf: 'flex-start', width: '100%' }}>
      <EuiFlexGroup><EuiFlexItem>
        <SearchBar
          appName="networkTopology"
          useDefaultBehaviors={false}
          indexPatterns={selectedDataView ? [selectedDataView] : []}
          query={query}
          filters={filters}
          showDatePicker={false}
          showFilterBar={true}
          showQueryInput={true}
          showSubmitButton={true}
          displayStyle="inPage"
          placeholder="Search devices… (e.g. host.name:router-1 or observer.vendor:Cisco)"
          dataViewPickerComponentProps={dataViewPickerProps}
          onQueryChange={({ query: q }) => {
            // Update SearchBar display only — do not fetch until submitted
            if (q) setQuery(q as Query);
          }}
          onQuerySubmit={({ query: q }) => {
            const committed = (q as Query) ?? query;
            setQuery(committed);
            setSubmittedQuery(committed);
            setPage(0);
          }}
          onFiltersUpdated={(f) => {
            setFilters(f);
            setPage(0);
          }}
        />
      </EuiFlexItem></EuiFlexGroup>
      <EuiSpacer size="m" />
      <EuiBasicTable items={devices} loading={loading}
        columns={[
          { field: 'status', name: 'Status', width: '80px', render: (s: string) => <EuiHealth color={STATUS_EUI_COLORS[s] || 'subdued'}>{s}</EuiHealth> },
          { field: 'name', name: 'Hostname', sortable: true },
          { field: 'ip', name: 'IP Address' },
          { field: 'type', name: 'Type' },
          { field: 'vendor', name: 'Vendor' },
          { field: 'site', name: 'Site' },
          { field: 'interfaceCount', name: 'Interfaces', width: '100px' },
          { field: 'downInterfaceCount', name: 'Down', width: '80px', render: (c: number) => <EuiText size="s" color={c > 0 ? 'danger' : 'default'}>{c}</EuiText> },
        ]}
        pagination={{ pageIndex: page, pageSize, totalItemCount: total, pageSizeOptions: [25, 50, 100] }}
        onChange={({ page: p }: any) => { if (p) { setPage(p.index); setPageSize(p.size); } }}
      />
    </div>
  );
};
