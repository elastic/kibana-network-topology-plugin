/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

// Follows the standard Kibana plugin layout: the @kbn/test preset expects to run
// from the Kibana repo root, with `roots` scoping collection to this plugin.
module.exports = {
  preset: '@kbn/test',
  rootDir: '../..',
  roots: ['<rootDir>/plugins/kibana-network-topology-plugin'],
  coverageDirectory: '<rootDir>/target/kibana-coverage/jest/plugins/kibana-network-topology-plugin',
  coverageReporters: ['text', 'html'],
  collectCoverageFrom: [
    '<rootDir>/plugins/kibana-network-topology-plugin/{common,public,server}/**/*.{ts,tsx}',
  ],
};
