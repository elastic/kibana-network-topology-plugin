/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IRouter, Logger } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import { API_ROUTES, DEFAULT_SNMP_INDEX } from '../../common';
import { buildTopologyFromArpMac } from '../services/topology_builder';
import { delegateAuthzToElasticsearch } from './route_security';

export function registerTopologyRoutes(router: IRouter, logger: Logger) {
  router.get(
    {
      path: API_ROUTES.TOPOLOGY,
      ...delegateAuthzToElasticsearch,
      validate: {
        query: schema.object({
          site: schema.maybe(schema.string()),
          building: schema.maybe(schema.string()),
          role: schema.maybe(schema.string()),
          cidr: schema.maybe(schema.string()),
          from: schema.string({ defaultValue: 'now-30m' }),
          to: schema.string({ defaultValue: 'now' }),
          index: schema.string({ defaultValue: DEFAULT_SNMP_INDEX }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { site, building, role, cidr, from, to, index } = request.query;
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const graph = await buildTopologyFromArpMac(esClient, {
          index,
          from,
          to,
          site,
          building,
          role,
          cidr,
          logger,
        });

        return response.ok({
          body: {
            graph,
            timestamp: new Date().toISOString(),
            scope: { site, building, role, cidr },
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
