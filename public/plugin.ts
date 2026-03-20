import type {
  CoreSetup, CoreStart, Plugin, AppMountParameters, PluginInitializerContext,
} from '@kbn/core/public';
import { PLUGIN_ID, PLUGIN_NAME } from '../common';

export class NetworkTopologyPlugin implements Plugin {
  constructor(private readonly initializerContext: PluginInitializerContext) {}

  public setup(core: CoreSetup) {
    core.application.register({
      id: PLUGIN_ID,
      title: PLUGIN_NAME,
      category: { id: 'observability', label: 'Observability', order: 8000 },
      order: 8500,
      async mount(params: AppMountParameters) {
        const { renderApp } = await import('./application');
        const [coreStart] = await core.getStartServices();
        return renderApp(coreStart, params);
      },
    });
  }

  public start(_core: CoreStart) {}
  public stop() {}
}
