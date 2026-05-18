/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AuthzDisabled } from '@kbn/core-security-server';

/** Routes use `asCurrentUser`; index access is enforced by Elasticsearch. */
export const delegateAuthzToElasticsearch = {
  security: {
    authz: AuthzDisabled.delegateToESClient,
  },
} as const;
