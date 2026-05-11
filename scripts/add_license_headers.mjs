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

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const HEADER_PATH = path.join(REPO_ROOT, 'licenses', 'ELASTIC-LICENSE-2.0-HEADER.txt');
const HEADER = fs.readFileSync(HEADER_PATH, 'utf8').trimEnd();

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build']);

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
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    addHeader(full);
  }
}

function hasHeader(text) {
  return text.includes('Copyright Elasticsearch B.V.') && text.includes('Elastic License');
}

function addHeader(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (hasHeader(original)) return;

  const lines = original.split('\n');
  const hasShebang = lines[0].startsWith('#!');

  const headerBlock = `${HEADER}\n\n`;

  const updated = hasShebang
    ? `${lines[0]}\n${headerBlock}${lines.slice(1).join('\n')}`
    : `${headerBlock}${original}`;

  fs.writeFileSync(filePath, updated, 'utf8');
  process.stdout.write(`added header: ${path.relative(REPO_ROOT, filePath)}\n`);
}

walk(REPO_ROOT);
