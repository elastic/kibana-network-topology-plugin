/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { NetworkTopologyConfig } from '../../server/config';

interface KibanaServices {
  networkTopologyConfig: NetworkTopologyConfig;
}

/**
 * Reads the plugin's kibana.yml-configurable settings, exposed to the browser
 * via server/index.ts's `exposeToBrowser` and threaded in through
 * KibanaContextProvider (see application.tsx).
 */
export const useNetworkTopologyConfig = (): NetworkTopologyConfig => {
  const { services } = useKibana<KibanaServices>();
  return services.networkTopologyConfig;
};
