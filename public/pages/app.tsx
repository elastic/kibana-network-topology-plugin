import React, { useState, useCallback } from 'react';
import {
  EuiPage, EuiPageBody, EuiPageHeader, EuiPageHeaderSection,
  EuiTitle, EuiTabs, EuiTab, EuiBreadcrumbs, EuiSpacer,
} from '@elastic/eui';
import { SiteOverview } from './site_overview';
import { TopologyView } from './topology_view';
import { DeviceListView } from './device_list';

type ViewMode = 'overview' | 'topology' | 'devices';

export const NetworkTopologyApp: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [scope, setScope] = useState<{ site?: string }>({});

  const handleSiteClick = useCallback((site: string) => {
    setScope({ site });
    setViewMode('topology');
  }, []);

  const handleBackToOverview = useCallback(() => {
    setScope({});
    setViewMode('overview');
  }, []);

  const breadcrumbs = [{ text: 'Network Topology', onClick: handleBackToOverview }];
  if (scope.site) breadcrumbs.push({ text: scope.site, onClick: () => {} });

  return (
    <EuiPage paddingSize="l">
      <EuiPageBody>
        <EuiPageHeader>
          <EuiPageHeaderSection>
            <EuiBreadcrumbs breadcrumbs={breadcrumbs} truncate={false} />
            <EuiSpacer size="s" />
            <EuiTitle size="l"><h1>Network Topology</h1></EuiTitle>
          </EuiPageHeaderSection>
        </EuiPageHeader>

        <EuiTabs>
          {(['overview', 'topology', 'devices'] as ViewMode[]).map((tab) => (
            <EuiTab key={tab} isSelected={viewMode === tab} onClick={() => setViewMode(tab)}>
              {tab === 'overview' ? 'Overview' : tab === 'topology' ? 'Topology Map' : 'Devices'}
            </EuiTab>
          ))}
        </EuiTabs>

        <EuiSpacer size="l" />

        {viewMode === 'overview' && <SiteOverview onSiteClick={handleSiteClick} />}
        {viewMode === 'topology' && <TopologyView site={scope.site} onBackToOverview={handleBackToOverview} />}
        {viewMode === 'devices' && <DeviceListView site={scope.site} />}
      </EuiPageBody>
    </EuiPage>
  );
};
