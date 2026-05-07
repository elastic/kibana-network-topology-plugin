/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IRouter, Logger } from '@kbn/core/server';
import { registerTopologyRoutes } from './topology';
import { registerSitesRoutes } from './sites';
import { registerSegmentsRoutes } from './segments';
import { registerDevicesRoutes } from './devices';
import { registerSetupRoutes } from './setup';

export function registerRoutes(router: IRouter, logger: Logger) {
  registerTopologyRoutes(router, logger);
  registerSitesRoutes(router, logger);
  registerSegmentsRoutes(router, logger);
  registerDevicesRoutes(router, logger);
  registerSetupRoutes(router, logger);
}
