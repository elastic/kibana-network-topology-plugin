import React, { useEffect, useState } from 'react';
import {
  EuiFlexGroup, EuiFlexItem, EuiPanel, EuiTitle, EuiText,
  EuiStat, EuiHealth, EuiLoadingSpinner, EuiCallOut, EuiSpacer, EuiIcon,
} from '@elastic/eui';
import { useApi } from '../hooks/use_api';
import type { SiteHealth } from '../../common';
import { STATUS_COLORS } from '../../common';

interface Props { onSiteClick: (site: string) => void; from: string; to: string; refreshKey: number; }

export const SiteOverview: React.FC<Props> = ({ onSiteClick, from, to, refreshKey }) => {
  const api = useApi();
  const [sites, setSites] = useState<SiteHealth[]>([]);
  const [totalDevices, setTotalDevices] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.fetchSites({ from, to })
      .then((r) => { if (!cancelled) { setSites(r.sites); setTotalDevices(r.totalDevices); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, from, to, refreshKey]);

  if (loading) return <EuiFlexGroup justifyContent="center" style={{ minHeight: 300 }}><EuiFlexItem grow={false}><EuiLoadingSpinner size="xl" /></EuiFlexItem></EuiFlexGroup>;
  if (error) return <EuiCallOut title="Error loading sites" color="danger"><p>{error}</p></EuiCallOut>;

  return (
    <>
      <EuiFlexGroup>
        <EuiFlexItem><EuiStat title={totalDevices} description="Total Devices" titleSize="l" /></EuiFlexItem>
        <EuiFlexItem><EuiStat title={sites.length} description="Sites" titleSize="l" /></EuiFlexItem>
        <EuiFlexItem><EuiStat title={sites.filter(s => s.worstStatus === 'down').length} description="Sites with Issues" titleSize="l" titleColor="danger" /></EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="l" />
      <EuiFlexGroup wrap gutterSize="l">
        {sites.map((site) => (
          <EuiFlexItem key={site.site} style={{ minWidth: 280, maxWidth: 360 }}>
            <EuiPanel hasBorder hasShadow={false} paddingSize="l" onClick={() => onSiteClick(site.site)} style={{ cursor: 'pointer' }}>
              <EuiFlexGroup alignItems="center" gutterSize="s">
                <EuiFlexItem grow={false}>
                  <EuiIcon type="globe" size="l" color={STATUS_COLORS[site.worstStatus] || STATUS_COLORS.unknown} />
                </EuiFlexItem>
                <EuiFlexItem><EuiTitle size="s"><h3>{site.site}</h3></EuiTitle></EuiFlexItem>
              </EuiFlexGroup>
              <EuiSpacer size="m" />
              <EuiText size="s"><strong>{site.deviceCount}</strong> devices</EuiText>
              <EuiSpacer size="s" />
              <EuiFlexGroup gutterSize="m">
                <EuiFlexItem grow={false}><EuiHealth color="success">{site.upCount} up</EuiHealth></EuiFlexItem>
                {site.degradedCount > 0 && <EuiFlexItem grow={false}><EuiHealth color="warning">{site.degradedCount} degraded</EuiHealth></EuiFlexItem>}
                {site.downCount > 0 && <EuiFlexItem grow={false}><EuiHealth color="danger">{site.downCount} down</EuiHealth></EuiFlexItem>}
              </EuiFlexGroup>
            </EuiPanel>
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
    </>
  );
};
