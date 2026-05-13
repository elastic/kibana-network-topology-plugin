/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Shared paths and header strings for license header check / fix scripts.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of `scripts/`). */
export const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');

/** Canonical Elastic License 2.0 header text (block comment), same as Kibana. */
export const HEADER_PATH = path.join(REPO_ROOT, 'licenses', 'ELASTIC-LICENSE-2.0-HEADER.txt');

export const EXPECTED_BLOCK_HEADER = fs.readFileSync(HEADER_PATH, 'utf8').trimEnd();

function blockHeaderToHashLines(block) {
  const m = block.match(/\/\*([\s\S]*?)\*\//);
  if (!m) {
    throw new Error(
      `Invalid license header template at ${HEADER_PATH}: expected a /* ... */ block`
    );
  }
  return m[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => `# ${line}`);
}

/**
 * Same license text as {@link EXPECTED_BLOCK_HEADER}, expressed as consecutive
 * `#` line comments for YAML and shell.
 */
export const HASH_HEADER = blockHeaderToHashLines(EXPECTED_BLOCK_HEADER).join('\n');

export const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export const HASH_STYLE_EXTENSIONS = new Set(['.yml', '.yaml', '.sh']);

export const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build']);
