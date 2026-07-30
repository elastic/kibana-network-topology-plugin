/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IRouter, Logger } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import {
  API_ROUTES,
  CONNECTIONS_DEFAULTS,
  CONNECTIONS_LIMITS,
  DEFAULT_CONNECTIONS_INDEX,
} from '../../common';
import { buildConnectionsGraph } from '../services/connections_builder';
import { delegateAuthzToElasticsearch } from './route_security';

const clamp = (value: number, max: number) => Math.min(Math.max(1, Math.floor(value)), max);

/**
 * A bad field name, an unaggregatable field, or malformed KQL are all user
 * input errors — surface them as a 400 with the underlying message instead of
 * an opaque 500, since both field selectors are free-form.
 */
function isBadRequest(err: any): boolean {
  return err?.name === 'KQLSyntaxError' || err?.statusCode === 400 || err?.meta?.statusCode === 400;
}

export function registerConnectionsRoutes(router: IRouter, logger: Logger) {
  router.get(
    {
      path: API_ROUTES.CONNECTIONS,
      ...delegateAuthzToElasticsearch,
      validate: {
        query: schema.object({
          index: schema.string({ defaultValue: DEFAULT_CONNECTIONS_INDEX }),
          srcField: schema.string({ defaultValue: CONNECTIONS_DEFAULTS.srcField, maxLength: 256 }),
          dstField: schema.string({ defaultValue: CONNECTIONS_DEFAULTS.dstField, maxLength: 256 }),
          from: schema.string({ defaultValue: 'now-1h' }),
          to: schema.string({ defaultValue: 'now' }),
          kql: schema.maybe(schema.string()),
          filters: schema.maybe(schema.string()),
          maxSources: schema.number({ defaultValue: CONNECTIONS_DEFAULTS.maxSources, min: 1 }),
          maxDstPerSource: schema.number({
            defaultValue: CONNECTIONS_DEFAULTS.maxDstPerSource,
            min: 1,
          }),
          minSessions: schema.number({ defaultValue: CONNECTIONS_DEFAULTS.minSessions, min: 1 }),
        }),
      },
    },
    async (context, request, response) => {
      const { index, srcField, dstField, from, to, kql, filters } = request.query;
      try {
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;

        const graph = await buildConnectionsGraph(esClient, {
          index,
          srcField,
          dstField,
          from,
          to,
          kql,
          filters,
          // Clamped here, not in the schema: an over-large request is trimmed to
          // something safe rather than rejected.
          maxSources: clamp(request.query.maxSources, CONNECTIONS_LIMITS.maxSources),
          maxDstPerSource: clamp(
            request.query.maxDstPerSource,
            CONNECTIONS_LIMITS.maxDstPerSource
          ),
          minSessions: Math.max(1, Math.floor(request.query.minSessions)),
          logger,
        });

        return response.ok({ body: graph });
      } catch (err) {
        if (isBadRequest(err)) {
          logger.debug(`Connections route rejected request (${srcField} → ${dstField}): ${err}`);
          return response.badRequest({
            body: {
              message:
                `Could not aggregate ${srcField} → ${dstField} on "${index}". ` +
                `Both fields must exist and be aggregatable. (${err.message ?? err})`,
            },
          });
        }
        logger.error(`Connections route error: ${err}`);
        return response.customError({
          statusCode: 500,
          body: { message: `Failed to build connections graph: ${err}` },
        });
      }
    }
  );
}
