/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  CoreSetup,
  CoreStart,
  Plugin,
  PluginInitializerContext,
  Logger,
} from '@kbn/core/server';
import { registerRoutes } from './routes';

export class NetworkTopologyServerPlugin implements Plugin {
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup) {
    this.logger.info('Network Topology plugin: setting up server');
    const router = core.http.createRouter();
    registerRoutes(router, this.logger);
  }

  public start(_core: CoreStart) {
    this.logger.info('Network Topology plugin: started');
  }

  public stop() {}
}
