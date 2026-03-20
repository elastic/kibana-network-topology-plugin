import React from 'react';
import ReactDOM from 'react-dom';
import type { CoreStart, AppMountParameters } from '@kbn/core/public';
import { KibanaContextProvider } from '@kbn/kibana-react-plugin/public';
import { Router, Route, Switch } from 'react-router-dom';
import { NetworkTopologyApp } from './pages/app';

export function renderApp(core: CoreStart, { element, history }: AppMountParameters) {
  ReactDOM.render(
    <KibanaContextProvider services={{ ...core }}>
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
