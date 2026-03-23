import type {
  CoreSetup, CoreStart, Plugin, AppMountParameters, PluginInitializerContext,
} from '@kbn/core/public';
import type { DataPublicPluginStart } from '@kbn/data-plugin/public';
import type { UnifiedSearchPublicPluginStart } from '@kbn/unified-search-plugin/public';
import { PLUGIN_ID, PLUGIN_NAME } from '../common';

interface PluginStartDeps {
  data: DataPublicPluginStart;
  unifiedSearch: UnifiedSearchPublicPluginStart;
}

export class NetworkTopologyPlugin implements Plugin {
  constructor(private readonly initializerContext: PluginInitializerContext) {}

  public setup(core: CoreSetup<PluginStartDeps>) {
    core.application.register({
      id: PLUGIN_ID,
      title: PLUGIN_NAME,
      category: { id: 'observability', label: 'Observability', order: 8000 },
      order: 8500,
      async mount(params: AppMountParameters) {
        const { renderApp } = await import('./application');
        const [coreStart, { data, unifiedSearch }] = await core.getStartServices();
        return renderApp(coreStart, data, unifiedSearch, params);
      },
    });
  }

  public start(_core: CoreStart) {}
  public stop() {}
}
