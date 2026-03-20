import type { PluginInitializerContext } from '@kbn/core/public';
import { NetworkTopologyPlugin } from './plugin';

export function plugin(initializerContext: PluginInitializerContext) {
  return new NetworkTopologyPlugin(initializerContext);
}

export type { NetworkTopologyPlugin };
