import React from 'react';
import ReactDOM from 'react-dom';
import type { CoreStart, AppMountParameters } from '@kbn/core/public';
import type { DataPublicPluginStart } from '@kbn/data-plugin/public';
import type { UnifiedSearchPublicPluginStart } from '@kbn/unified-search-plugin/public';
import { KibanaContextProvider } from '@kbn/kibana-react-plugin/public';
import { Router, Route, Switch } from 'react-router-dom';
import { NetworkTopologyApp } from './pages/app';

export function renderApp(
  core: CoreStart,
  data: DataPublicPluginStart,
  unifiedSearch: UnifiedSearchPublicPluginStart,
  { element, history }: AppMountParameters
) {
  ReactDOM.render(
    <KibanaContextProvider services={{ ...core, data, unifiedSearch }}>
      <Router history={history}>
        <Switch>
          <Route path="/" component={NetworkTopologyApp} />
        </Switch>
      </Router>
    </KibanaContextProvider>,
    element
  );
  return () => ReactDOM.unmountComponentAtNode(element);
}
