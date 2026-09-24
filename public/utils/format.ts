/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Human-readable byte count, e.g. 1536 → "1.5 KB". */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Thousands-separated integer, or an em dash when absent. */
export function formatCount(value: number | undefined): string {
  if (value === undefined) return '—';
  return value.toLocaleString();
}
