import type { PluginInitializerContext } from '@kbn/core/server';
import { NetworkTopologyServerPlugin } from './plugin';

export function plugin(initializerContext: PluginInitializerContext) {
  return new NetworkTopologyServerPlugin(initializerContext);
}

export type { NetworkTopologyServerPlugin };
