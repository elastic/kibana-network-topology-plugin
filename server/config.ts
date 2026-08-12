/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema, type TypeOf } from '@kbn/config-schema';

export const configSchema = schema.object({
  // Falls back to the legacy D3 topology canvas instead of the React Flow one.
  // Default is false — React Flow is the canvas going forward.
  useLegacyTopologyMap: schema.boolean({ defaultValue: false }),
});

export type NetworkTopologyConfig = TypeOf<typeof configSchema>;
