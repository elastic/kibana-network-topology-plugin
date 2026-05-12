#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
/**
 * Adds the Elastic License 2.0 header to source files, matching Kibana's header text.
 *
 * Intended for one-time normalization before making the repo public.
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

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      // still allow .github etc if needed, but we don't add headers there today
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!EXTENSIONS.has(ext) && !HASH_STYLE_EXTENSIONS.has(ext)) continue;
    addHeader(full, ext);
  }
}

function hasBlockHeader(text) {
  return text.includes('Copyright Elasticsearch B.V.') && text.includes('Elastic License');
}

function hasHashHeaderAtStart(text) {
  const lines = text.split('\n');
  let i = 0;
  if (lines[0]?.startsWith('#!')) i = 1;
  const slice = lines.slice(i, i + 4).join('\n');
  return slice === HASH_HEADER;
}

function addHeader(filePath, ext) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (HASH_STYLE_EXTENSIONS.has(ext)) {
    if (hasHashHeaderAtStart(original)) return;
    const lines = original.split('\n');
    const hasShebang = lines[0]?.startsWith('#!');
    const hashBlock = `${HASH_HEADER}\n\n`;
    const updated = hasShebang
      ? `${lines[0]}\n${hashBlock}${lines.slice(1).join('\n')}`
      : `${hashBlock}${original}`;
    fs.writeFileSync(filePath, updated, 'utf8');
    process.stdout.write(`added header: ${path.relative(REPO_ROOT, filePath)}\n`);
    return;
  }

  if (hasBlockHeader(original)) return;

  const lines = original.split('\n');
  const hasShebang = lines[0].startsWith('#!');

  const headerBlock = `${EXPECTED_BLOCK_HEADER}\n\n`;

  const updated = hasShebang
    ? `${lines[0]}\n${headerBlock}${lines.slice(1).join('\n')}`
    : `${headerBlock}${original}`;

  fs.writeFileSync(filePath, updated, 'utf8');
  process.stdout.write(`added header: ${path.relative(REPO_ROOT, filePath)}\n`);
}

walk(REPO_ROOT);
