/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiPageHeader,
  EuiPageHeaderSection,
  EuiTitle,
  EuiTabs,
  EuiTab,
  EuiBreadcrumbs,
  EuiSpacer,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSuperDatePicker,
  EuiBetaBadge,
} from '@elastic/eui';
import { SiteOverview } from './site_overview';
import { SegmentOverview } from './segment_overview';
import { TopologyView } from './topology_view';
import { DeviceListView } from './device_list';
import { SetupGuide } from './setup_guide';

type ViewMode = 'overview' | 'topology' | 'devices' | 'setup';

interface ApmTx {
  name: string;
  addLabels: (labels: Record<string, string | number | boolean>) => void;
  end: () => void;
}

export const NetworkTopologyApp: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [scope, setScope] = useState<{ site?: string; cidr?: string }>({});
  const [start, setStart] = useState('now-15m');
  const [end, setEnd] = useState('now');
  const [isPaused, setIsPaused] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [refreshKey, setRefreshKey] = useState(0);
  // Use the already-initialized RUM agent core sets up on window — avoids a direct
  // @elastic/apm-rum import and correctly no-ops when APM is inactive.
  const rumApm = (window as any).elasticApm as
    | { startTransaction: (name: string, type: string) => ApmTx | null }
    | undefined;
  const txRef = useRef<ApmTx | null>(null);
  const overviewReadyCount = useRef(0);

  useEffect(() => {
    if (txRef.current) {
      txRef.current.addLabels({ tab_load_complete: false });
      txRef.current.end();
    }
    overviewReadyCount.current = 0;
    txRef.current = rumApm?.startTransaction(`networkTopology ${viewMode}`, 'custom') ?? null;
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOverviewReady = useCallback(() => {
    overviewReadyCount.current += 1;
    if (overviewReadyCount.current >= 2) {
      txRef.current?.addLabels({ tab_load_complete: true });
      txRef.current?.end();
      txRef.current = null;
    }
  }, []);

  const handleTabReady = useCallback(() => {
    txRef.current?.addLabels({ tab_load_complete: true });
    txRef.current?.end();
    txRef.current = null;
  }, []);

  const handleSiteClick = useCallback((site: string) => {
    setScope({ site });
    setViewMode('topology');
  }, []);

  const handleSegmentClick = useCallback((cidr: string) => {
    setScope({ cidr });
    setViewMode('topology');
  }, []);

  const handleBackToOverview = useCallback(() => {
    setScope({});
    setViewMode('overview');
  }, []);

  const handleTimeChange = useCallback(({ start: s, end: e }: { start: string; end: string }) => {
    setStart(s);
    setEnd(e);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleRefresh = useCallback(({ start: s, end: e }: { start: string; end: string }) => {
    setStart(s);
    setEnd(e);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleRefreshChange = useCallback(
    ({ isPaused: ip, refreshInterval: ri }: { isPaused: boolean; refreshInterval: number }) => {
      setIsPaused(ip);
      setRefreshInterval(ri);
    },
    []
  );

  const breadcrumbs = [{ text: 'Network Topology', onClick: handleBackToOverview }];
  if (scope.site) breadcrumbs.push({ text: scope.site, onClick: () => {} });
  if (scope.cidr) breadcrumbs.push({ text: scope.cidr, onClick: () => {} });

  return (
    <EuiPage paddingSize="l">
      <EuiPageBody>
        <EuiPageHeader>
          <EuiPageHeaderSection style={{ width: '100%' }}>
            <EuiBreadcrumbs breadcrumbs={breadcrumbs} truncate={false} />
            <EuiSpacer size="s" />
            <EuiFlexGroup alignItems="center" gutterSize="m" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiTitle size="l">
                  <h1>
                    Network Topology &nbsp;
                    <EuiBetaBadge
                      label="Technical preview"
                      tooltipContent="This functionality is in technical preview and is not ready for production usage. Technical preview features may change or be removed at any time. Elastic will work to fix any issues, but features in technical preview are not subject to the support SLA of official GA features. Specific Support terms apply."
                    />
                  </h1>
                </EuiTitle>
              </EuiFlexItem>
              <EuiFlexItem />
              <EuiFlexItem grow={false}>
                <EuiSuperDatePicker
                  start={start}
                  end={end}
                  onTimeChange={handleTimeChange}
                  onRefresh={handleRefresh}
                  isPaused={isPaused}
                  refreshInterval={refreshInterval}
                  onRefreshChange={handleRefreshChange}
                />
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPageHeaderSection>
        </EuiPageHeader>

        <EuiTabs>
          {(['overview', 'topology', 'devices', 'setup'] as ViewMode[]).map((tab) => (
            <EuiTab key={tab} isSelected={viewMode === tab} onClick={() => setViewMode(tab)}>
              {tab === 'overview'
                ? 'Overview'
                : tab === 'topology'
                ? 'Topology Map'
                : tab === 'devices'
                ? 'Devices'
                : 'Setup'}
            </EuiTab>
          ))}
        </EuiTabs>

        <EuiSpacer size="l" />

        {viewMode === 'overview' && (
          <>
            <SiteOverview
              onSiteClick={handleSiteClick}
              from={start}
              to={end}
              refreshKey={refreshKey}
              onReady={handleOverviewReady}
            />
            <EuiSpacer size="xl" />
            <EuiTitle size="s">
              <h2>Network Segments</h2>
            </EuiTitle>
            <EuiSpacer size="m" />
            <SegmentOverview
              onSegmentClick={handleSegmentClick}
              from={start}
              to={end}
              refreshKey={refreshKey}
              onReady={handleOverviewReady}
            />
          </>
        )}
        {viewMode === 'topology' && (
          <TopologyView
            site={scope.site}
            cidr={scope.cidr}
            onBackToOverview={handleBackToOverview}
            from={start}
            to={end}
            refreshKey={refreshKey}
            onReady={handleTabReady}
          />
        )}
        {viewMode === 'devices' && (
          <DeviceListView
            site={scope.site}
            from={start}
            to={end}
            refreshKey={refreshKey}
            onReady={handleTabReady}
          />
        )}
        {viewMode === 'setup' && <SetupGuide onReady={handleTabReady} />}
      </EuiPageBody>
    </EuiPage>
  );
};
