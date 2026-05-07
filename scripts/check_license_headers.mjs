#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Verifies the repo uses the same license header text Kibana enforces.
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const HEADER_PATH = path.join(REPO_ROOT, 'licenses', 'ELASTIC-LICENSE-2.0-HEADER.txt');
const EXPECTED = fs.readFileSync(HEADER_PATH, 'utf8').trimEnd();

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build']);

const failures = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    checkFile(full);
  }
}

function stripShebang(text) {
  if (!text.startsWith('#!')) return text;
  const nl = text.indexOf('\n');
  return nl === -1 ? '' : text.slice(nl + 1);
}

function startsWithExpectedHeader(text) {
  const withoutShebang = stripShebang(text).replace(/^\uFEFF/, ''); // BOM
  return withoutShebang.startsWith(EXPECTED + '\n');
}

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!startsWithExpectedHeader(text)) {
    failures.push(path.relative(REPO_ROOT, filePath));
  }
}

walk(REPO_ROOT);

if (failures.length) {
  process.stderr.write(
    `Missing/incorrect Elastic License 2.0 header in ${failures.length} files:\n` +
      failures.map((f) => `- ${f}`).join('\n') +
      '\n\nRun: node scripts/add_license_headers.mjs\n'
  );
  process.exit(1);
}

process.stdout.write('All checked files have the correct license header.\n');

