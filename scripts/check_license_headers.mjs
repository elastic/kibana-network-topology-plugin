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
import {
  EXPECTED_BLOCK_HEADER,
  EXTENSIONS,
  HASH_HEADER,
  HASH_STYLE_EXTENSIONS,
  REPO_ROOT,
  SKIP_DIRS,
} from './license_header_shared.mjs';

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
    const ext = path.extname(entry.name);
    if (!EXTENSIONS.has(ext) && !HASH_STYLE_EXTENSIONS.has(ext)) continue;
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
  return withoutShebang.startsWith(EXPECTED_BLOCK_HEADER + '\n');
}

function startsWithHashHeader(text) {
  const withoutShebang = stripShebang(text).replace(/^\uFEFF/, '');
  const t = withoutShebang.replace(/^\s+/, '');
  if (!t.startsWith(HASH_HEADER)) return false;
  const next = t.charAt(HASH_HEADER.length);
  return next === '' || next === '\n' || next === '\r';
}

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath);
  const ok = HASH_STYLE_EXTENSIONS.has(ext)
    ? startsWithHashHeader(text)
    : startsWithExpectedHeader(text);
  if (!ok) {
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
