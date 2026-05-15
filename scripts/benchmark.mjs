#!/usr/bin/env node
/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * One-off Playwright benchmark for the Network Topology plugin.
 * Drives tab loads repeatedly and prints wall-clock timing plus an APM correlation window.
 *
 * Usage: node scripts/benchmark.mjs [KIBANA_URL] [USER] [PASSWORD] [--iterations=N] [--tabs=overview,topology,devices,setup] [--headless]
 *   KIBANA_URL   default: http://localhost:5601
 *   USER         default: elastic
 *   PASSWORD     default: changeme
 *   --iterations Times to load each tab (default: 5)
 *   --tabs       Comma-separated subset (default: all four)
 *   --headless   Run headless (default: false — visible window is easier to debug)
 *
 * Seed data before running:
 *   node scripts/generate_scale_test_data.mjs --devices=1000 --density=medium
 */

import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

// ─── Arg parsing ────────────────────────────────────────────────────────────────

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    iterations: { type: 'string', default: '5' },
    tabs: { type: 'string', default: 'overview,topology,devices,setup' },
    headless: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const KIBANA_URL = (positionals[0] || 'http://localhost:5601').replace(/\/$/, '');
const USER = positionals[1] || 'elastic';
const PASSWORD = positionals[2] || 'changeme';
const HEADLESS = flags.headless;

const ITERATIONS = (() => {
  const n = Number(flags.iterations);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`Error: --iterations must be a positive integer (got "${flags.iterations}")`);
    process.exit(1);
  }
  return n;
})();

const ALL_TABS = ['overview', 'topology', 'devices', 'setup'];
const TABS = flags.tabs
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const t of TABS) {
  if (!ALL_TABS.includes(t)) {
    console.error(`Error: unknown tab "${t}". Valid tabs: ${ALL_TABS.join(', ')}`);
    process.exit(1);
  }
}

// ─── Per-tab ready conditions ────────────────────────────────────────────────────
//
// 200ms settle after the click gives React one render cycle to mount the loading
// state before we start checking content selectors. Content-specific waits (rather
// than spinner-detach) avoid the race where the spinner hasn't appeared yet.

const TAB_CONFIG = {
  overview: {
    label: 'Overview',
    async waitReady(page) {
      await page.waitForTimeout(200);
      await page.locator('.euiStat').first().waitFor({ state: 'visible', timeout: 60_000 });
    },
  },
  topology: {
    label: 'Topology Map',
    async waitReady(page) {
      await page.waitForTimeout(200);
      // First wait for the "Building topology…" spinner to disappear
      await page
        .locator('.euiLoadingSpinner')
        .waitFor({ state: 'detached', timeout: 90_000 })
        .catch(() => {});
      // Then confirm the canvas is interactive
      await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
    },
  },
  devices: {
    label: 'Devices',
    async waitReady(page) {
      await page.waitForTimeout(200);
      // EuiBasicTable renders .euiTableRow for both data rows and the empty-state row
      await page.locator('.euiTableRow').first().waitFor({ state: 'visible', timeout: 60_000 });
    },
  },
  setup: {
    label: 'Setup',
    async waitReady(page) {
      await page.waitForTimeout(200);
      // Step accordions render unconditionally; health-check spinner is a separate section
      await page.locator('.euiAccordion').first().waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
};

// ─── Stats helpers ───────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ─── Main ────────────────────────────────────────────────────────────────────────

const runId = `networkTopology-bench-${Date.now()}`;
console.log(`\nRun ID     : ${runId}`);
console.log(`Target     : ${KIBANA_URL}/app/networkTopology`);
console.log(`Tabs       : ${TABS.join(', ')}`);
console.log(`Iterations : ${ITERATIONS}\n`);

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext();
const page = await context.newPage();

// Login
console.log('Logging in…');
await page.goto(`${KIBANA_URL}/login`);
await page.locator('[data-test-subj="loginUsername"]').fill(USER);
await page.locator('[data-test-subj="loginPassword"]').fill(PASSWORD);
await page.locator('[data-test-subj="loginSubmit"]').click();
await page
  .locator('[data-test-subj="userMenuButton"]')
  .waitFor({ state: 'visible', timeout: 30_000 });
console.log('Logged in.\n');

// Navigate to plugin
await page.goto(`${KIBANA_URL}/app/networkTopology`);
await page
  .locator('[data-test-subj="userMenuButton"]')
  .waitFor({ state: 'visible', timeout: 15_000 });
// Wait for the default tab (overview) to finish its initial load before the loop starts
await TAB_CONFIG.overview.waitReady(page);

const startedAt = new Date();
const samples = Object.fromEntries(TABS.map((t) => [t, []]));
let prevTab = null;

console.log('Starting iterations…');
for (let i = 1; i <= ITERATIONS; i++) {
  for (const tab of TABS) {
    // If only one tab is selected (or we somehow land on the same tab twice), pivot
    // away first so clicking back triggers a fresh data load.
    if (TABS.length === 1 || prevTab === tab) {
      const pivot = ALL_TABS.find((t) => t !== tab);
      await page.getByRole('tab', { name: TAB_CONFIG[pivot].label }).click();
      await page.waitForTimeout(300);
    }

    const t0 = Date.now();
    await page.getByRole('tab', { name: TAB_CONFIG[tab].label }).click();
    await TAB_CONFIG[tab].waitReady(page);
    const elapsed = Date.now() - t0;

    samples[tab].push(elapsed);
    console.log(`  [${tab}] iter ${i}: ${elapsed} ms`);

    await page.waitForTimeout(1000); // brief settle before next click
    prevTab = tab;
  }
}

const endedAt = new Date();
await browser.close();

// ─── Print results ───────────────────────────────────────────────────────────────

const C = { tab: 14, n: 7, ms: 11 };

console.log('\n=== Results ===\n');
const header =
  'Tab'.padEnd(C.tab) +
  'N warm'.padStart(C.n) +
  'Cold (ms)'.padStart(C.ms) +
  'p50 (ms)'.padStart(C.ms) +
  'p95 (ms)'.padStart(C.ms) +
  'Max (ms)'.padStart(C.ms);
console.log(header);
console.log('-'.repeat(header.length));

for (const tab of TABS) {
  const all = samples[tab];
  const cold = all[0] ?? '-';
  const warm = all.slice(1).sort((a, b) => a - b);
  const p50 = warm.length ? percentile(warm, 50) : '-';
  const p95 = warm.length ? percentile(warm, 95) : '-';
  const max = all.length ? Math.max(...all) : '-';
  console.log(
    tab.padEnd(C.tab) +
      String(warm.length).padStart(C.n) +
      String(cold).padStart(C.ms) +
      String(p50).padStart(C.ms) +
      String(p95).padStart(C.ms) +
      String(max).padStart(C.ms)
  );
}

console.log('\n=== APM correlation window ===\n');
console.log(`  run_id : ${runId}`);
console.log(`  start  : ${startedAt.toISOString()}`);
console.log(`  end    : ${endedAt.toISOString()}`);
console.log('\nAPM UI: Services → kibana → Transactions');
console.log('  Filter : transaction.type: custom');
console.log('  Names  : networkTopology overview|topology|devices|setup');
console.log('  Label  : labels.tab_load_complete: true\n');
