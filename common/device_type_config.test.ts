/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { DEVICE_TYPE_CONFIG } from './constants';

// Icon *names* are validated at compile time — DEVICE_TYPE_CONFIG types `icon` as the
// literal union of icons EUI ships, so a name like 'wifi' (which EUI has never had)
// fails `yarn type-check` rather than silently rendering a broken image on the map.
// What is left to check here is the shape the node component depends on at runtime.
describe('DEVICE_TYPE_CONFIG', () => {
  const entries = Object.entries(DEVICE_TYPE_CONFIG);

  it('covers every device type the topology builder can emit', () => {
    // Mirrors DeviceType in ./types. Kept as an explicit list so adding a device type
    // without giving it a colour and icon fails here instead of falling back silently.
    expect(Object.keys(DEVICE_TYPE_CONFIG).sort()).toEqual(
      ['ap', 'firewall', 'router', 'server', 'switch', 'unknown'].sort()
    );
  });

  // The node component falls back to this entry for any type not listed above.
  it('always has an unknown entry to fall back to', () => {
    expect(DEVICE_TYPE_CONFIG.unknown).toBeDefined();
  });

  it.each(entries)('%s has a 6-digit hex colour', (_type, cfg) => {
    expect(cfg.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it.each(entries)('%s has a non-empty icon name', (_type, cfg) => {
    expect(cfg.icon).toBeTruthy();
  });
});
