/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { PluginConfigDescriptor, PluginInitializerContext } from '@kbn/core/server';
import { configSchema, type NetworkTopologyConfig } from './config';
import { NetworkTopologyServerPlugin } from './plugin';

export const config: PluginConfigDescriptor<NetworkTopologyConfig> = {
  schema: configSchema,
  exposeToBrowser: { useLegacyTopologyMap: true },
};

export function plugin(initializerContext: PluginInitializerContext<NetworkTopologyConfig>) {
  return new NetworkTopologyServerPlugin(initializerContext);
}

export type { NetworkTopologyServerPlugin };
export type { NetworkTopologyConfig } from './config';
