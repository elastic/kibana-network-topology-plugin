/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

const path = require('path');

// `@kbn/test`'s preset expects rootDir to be the Kibana repo root (two levels up
// from `kibana/plugins/<this plugin>`). Derived from __dirname rather than
// hardcoded so it keeps working whichever directory name the plugin is linked
// into — see the symlink/worktree options in the README.
module.exports = {
  preset: '@kbn/test',
  rootDir: path.resolve(__dirname, '../..'),
  roots: [__dirname],
};
