/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useState, useCallback } from 'react';
import {
  EuiPage, EuiPageBody, EuiPageHeader, EuiPageHeaderSection,
  EuiTitle, EuiTabs, EuiTab, EuiBreadcrumbs, EuiSpacer,
  EuiFlexGroup, EuiFlexItem, EuiSuperDatePicker,
} from '@elastic/eui';
import { SiteOverview } from './site_overview';
import { SegmentOverview } from './segment_overview';
import { TopologyView } from './topology_view';
import { DeviceListView } from './device_list';
import { SetupGuide } from './setup_guide';

type ViewMode = 'overview' | 'topology' | 'devices' | 'setup';

export const NetworkTopologyApp: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [scope, setScope] = useState<{ site?: string; cidr?: string }>({});
  const [start, setStart] = useState('now-15m');
  const [end, setEnd] = useState('now');
  const [isPaused, setIsPaused] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [refreshKey, setRefreshKey] = useState(0);

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
    setRefreshKey(k => k + 1);
  }, []);

  const handleRefresh = useCallback(({ start: s, end: e }: { start: string; end: string }) => {
    setStart(s);
    setEnd(e);
    setRefreshKey(k => k + 1);
  }, []);

  const handleRefreshChange = useCallback(({ isPaused: ip, refreshInterval: ri }: { isPaused: boolean; refreshInterval: number }) => {
    setIsPaused(ip);
    setRefreshInterval(ri);
  }, []);

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
                <EuiTitle size="l"><h1>Network Topology</h1></EuiTitle>
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
              {tab === 'overview' ? 'Overview' : tab === 'topology' ? 'Topology Map' : tab === 'devices' ? 'Devices' : 'Setup'}
            </EuiTab>
          ))}
        </EuiTabs>

        <EuiSpacer size="l" />

        {viewMode === 'overview' && (
          <>
            <SiteOverview onSiteClick={handleSiteClick} from={start} to={end} refreshKey={refreshKey} />
            <EuiSpacer size="xl" />
            <EuiTitle size="s"><h2>Network Segments</h2></EuiTitle>
            <EuiSpacer size="m" />
            <SegmentOverview onSegmentClick={handleSegmentClick} from={start} to={end} refreshKey={refreshKey} />
          </>
        )}
        {viewMode === 'topology' && <TopologyView site={scope.site} cidr={scope.cidr} onBackToOverview={handleBackToOverview} from={start} to={end} refreshKey={refreshKey} />}
        {viewMode === 'devices' && <DeviceListView site={scope.site} from={start} to={end} refreshKey={refreshKey} />}
        {viewMode === 'setup' && <SetupGuide />}
      </EuiPageBody>
    </EuiPage>
  );
};
