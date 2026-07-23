/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import type { CoreStart, AppMountParameters } from '@kbn/core/public';
import type { DataPublicPluginStart } from '@kbn/data-plugin/public';
import type { UnifiedSearchPublicPluginStart } from '@kbn/unified-search-plugin/public';
import { KibanaRenderContextProvider } from '@kbn/react-kibana-context-render';
import { KibanaContextProvider } from '@kbn/kibana-react-plugin/public';
import { Router, Route } from '@kbn/shared-ux-router';
import type { NetworkTopologyConfig } from '../server/config';
import { NetworkTopologyApp } from './pages/app';

export function renderApp(
  core: CoreStart,
  data: DataPublicPluginStart,
  unifiedSearch: UnifiedSearchPublicPluginStart,
  { element, history }: AppMountParameters,
  networkTopologyConfig: NetworkTopologyConfig
) {
  ReactDOM.render(
    <KibanaRenderContextProvider {...core}>
      <KibanaContextProvider services={{ ...core, data, unifiedSearch, networkTopologyConfig }}>
        <Router history={history}>
          <Route path="/" component={NetworkTopologyApp} />
        </Router>
      </KibanaContextProvider>
    </KibanaRenderContextProvider>,
    element
  );
  return () => ReactDOM.unmountComponentAtNode(element);
}
