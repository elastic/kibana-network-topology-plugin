import type { IRouter, Logger } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import { API_ROUTES, DEFAULT_SNMP_INDEX } from '../../common';
import { buildTopologyFromArpMac } from '../services/topology_builder';

export function registerTopologyRoutes(router: IRouter, logger: Logger) {
  router.get(
    {
      path: API_ROUTES.TOPOLOGY,
      validate: {
        query: schema.object({
          site: schema.maybe(schema.string()),
          building: schema.maybe(schema.string()),
          role: schema.maybe(schema.string()),
          timeRange: schema.string({ defaultValue: 'now-30m' }),
          index: schema.string({ defaultValue: DEFAULT_SNMP_INDEX }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { site, building, role, timeRange, index } = request.query;
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const graph = await buildTopologyFromArpMac(esClient, {
          index,
          timeRange,
          site,
          building,
          role,
          logger,
        });

        return response.ok({
          body: {
            graph,
            timestamp: new Date().toISOString(),
            scope: { site, building, role },
          },
        });
      } catch (err) {
        logger.error(`Topology route error: ${err}`);
        return response.customError({
          statusCode: 500,
          body: { message: `Failed to build topology: ${err}` },
        });
      }
    }
  );
}
