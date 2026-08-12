/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { DeviceType, TopologyGraph, TopologyLink, TopologyNode } from '../../common';
import { graphToReactFlow } from './graph_to_react_flow';

const node = (
  id: string,
  type: DeviceType,
  overrides: Partial<TopologyNode> = {}
): TopologyNode => ({
  id,
  label: id,
  ip: `10.0.0.${id.length}`,
  type,
  status: 'up',
  ...overrides,
});

const link = (
  id: string,
  source: string,
  target: string,
  overrides: Partial<TopologyLink> = {}
): TopologyLink => ({
  id,
  source,
  target,
  status: 'up',
  method: 'lldp',
  ...overrides,
});

const graph = (nodes: TopologyNode[], links: TopologyLink[]): TopologyGraph => ({
  nodes,
  links,
  discoveredAt: '2026-08-12T00:00:00.000Z',
  method: 'test',
});

describe('graphToReactFlow', () => {
  it('maps every node to a device node carrying its device data', () => {
    const result = graphToReactFlow(
      graph([node('r1', 'router', { site: 'ams', role: 'core' })], [])
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'r1',
      type: 'device',
      data: { label: 'r1', type: 'router', status: 'up', site: 'ams', role: 'core' },
    });
  });

  it('maps links to topology edges carrying port and traffic detail', () => {
    const result = graphToReactFlow(
      graph(
        [node('r1', 'router'), node('s1', 'switch')],
        [
          link('l1', 'r1', 's1', {
            sourcePort: 'Gi0/1',
            targetPort: 'Gi0/2',
            trafficVolume: 1234,
            status: 'degraded',
          }),
        ]
      )
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      id: 'l1',
      type: 'topology',
      source: 'r1',
      target: 's1',
      selectable: false,
      data: {
        status: 'degraded',
        method: 'lldp',
        sourcePort: 'Gi0/1',
        targetPort: 'Gi0/2',
        trafficVolume: 1234,
      },
    });
  });

  describe('tiered layout', () => {
    it('stacks managed device tiers router → firewall → switch → server → ap', () => {
      const result = graphToReactFlow(
        graph(
          [
            node('ap1', 'ap'),
            node('srv1', 'server'),
            node('sw1', 'switch'),
            node('fw1', 'firewall'),
            node('r1', 'router'),
          ],
          []
        )
      );

      const y = (id: string) => result.nodes.find((n) => n.id === id)!.position.y;

      expect(y('r1')).toBeLessThan(y('fw1'));
      expect(y('fw1')).toBeLessThan(y('sw1'));
      expect(y('sw1')).toBeLessThan(y('srv1'));
      expect(y('srv1')).toBeLessThan(y('ap1'));
    });

    it('puts external BGP peers above the managed tiers and ARP clients below', () => {
      const result = graphToReactFlow(
        graph(
          [
            node('peer', 'router', { managed: false }),
            node('r1', 'router'),
            node('client', 'unknown', { managed: false }),
          ],
          [
            link('l1', 'peer', 'r1', { method: 'bgp' }),
            link('l2', 'r1', 'client', { method: 'arp' }),
          ]
        )
      );

      const y = (id: string) => result.nodes.find((n) => n.id === id)!.position.y;

      expect(y('peer')).toBeLessThan(y('r1'));
      expect(y('r1')).toBeLessThan(y('client'));
    });

    it('buckets unrecognised device types into the unknown tier rather than dropping them', () => {
      const result = graphToReactFlow(graph([node('mystery', 'weird-box' as DeviceType)], []));

      expect(result.nodes.map((n) => n.id)).toEqual(['mystery']);
    });

    it('is deterministic — repeated calls place nodes identically', () => {
      const input = graph(
        [node('r1', 'router'), node('r2', 'router'), node('sw1', 'switch')],
        [link('l1', 'r1', 'sw1')]
      );

      expect(graphToReactFlow(input).nodes).toEqual(graphToReactFlow(input).nodes);
    });
  });

  describe('discovery method', () => {
    it('labels unmanaged nodes by how they were discovered, BGP over OSPF over ARP', () => {
      const result = graphToReactFlow(
        graph(
          [
            node('r1', 'router'),
            node('bgpPeer', 'router', { managed: false }),
            node('ospfPeer', 'router', { managed: false }),
            node('arpHost', 'unknown', { managed: false }),
          ],
          [
            link('l1', 'bgpPeer', 'r1', { method: 'bgp' }),
            link('l2', 'ospfPeer', 'r1', { method: 'ospf' }),
            link('l3', 'arpHost', 'r1', { method: 'arp' }),
          ]
        )
      );

      const discovery = (id: string) => result.nodes.find((n) => n.id === id)!.data.discovery;

      expect(discovery('bgpPeer')).toBe('bgp');
      expect(discovery('ospfPeer')).toBe('ospf');
      expect(discovery('arpHost')).toBe('arp');
    });

    it('prefers bgp when a node is reachable by both bgp and ospf', () => {
      const result = graphToReactFlow(
        graph(
          [node('r1', 'router'), node('peer', 'router', { managed: false })],
          [
            link('l1', 'peer', 'r1', { method: 'ospf' }),
            link('l2', 'peer', 'r1', { method: 'bgp' }),
          ]
        )
      );

      expect(result.nodes.find((n) => n.id === 'peer')!.data.discovery).toBe('bgp');
    });

    it('leaves discovery unset for managed devices', () => {
      const result = graphToReactFlow(graph([node('r1', 'router')], []));

      expect(result.nodes[0].data.discovery).toBeUndefined();
    });
  });

  describe('type visibility filtering', () => {
    const sample = graph(
      [node('r1', 'router'), node('sw1', 'switch'), node('ap1', 'ap')],
      [link('l1', 'r1', 'sw1'), link('l2', 'sw1', 'ap1')]
    );

    it('returns everything when nothing is hidden', () => {
      const result = graphToReactFlow(sample, 1000, 800, new Set());

      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
    });

    it('drops hidden types and any link that lost an endpoint', () => {
      const result = graphToReactFlow(sample, 1000, 800, new Set(['ap']));

      expect(result.nodes.map((n) => n.id).sort()).toEqual(['r1', 'sw1']);
      expect(result.edges.map((e) => e.id)).toEqual(['l1']);
    });

    it('hides unmanaged nodes under the "discovered" key rather than their device type', () => {
      const withClient = graph(
        [node('r1', 'router'), node('client', 'unknown', { managed: false })],
        [link('l1', 'r1', 'client', { method: 'arp' })]
      );

      // Hiding 'unknown' must not remove it — its visibility is governed by 'discovered'.
      expect(graphToReactFlow(withClient, 1000, 800, new Set(['unknown'])).nodes).toHaveLength(2);
      expect(graphToReactFlow(withClient, 1000, 800, new Set(['discovered'])).nodes).toHaveLength(
        1
      );
    });

    it('cascades: hiding APs also prunes the clients only reachable through them', () => {
      // phone was only ever seen in ap1's ARP table, so it is meaningless without it.
      const withPhone = graph(
        [node('r1', 'router'), node('ap1', 'ap'), node('phone', 'unknown', { managed: false })],
        [link('l1', 'r1', 'ap1'), link('l2', 'ap1', 'phone', { method: 'arp' })]
      );

      const result = graphToReactFlow(withPhone, 1000, 800, new Set(['ap']));

      expect(result.nodes.map((n) => n.id)).toEqual(['r1']);
      expect(result.edges).toHaveLength(0);
    });

    it('keeps an unmanaged node that still has another visible managed neighbour', () => {
      const dualHomed = graph(
        [node('r1', 'router'), node('ap1', 'ap'), node('phone', 'unknown', { managed: false })],
        [
          link('l1', 'ap1', 'phone', { method: 'arp' }),
          link('l2', 'r1', 'phone', { method: 'arp' }),
        ]
      );

      const result = graphToReactFlow(dualHomed, 1000, 800, new Set(['ap']));

      expect(result.nodes.map((n) => n.id).sort()).toEqual(['phone', 'r1']);
      expect(result.edges.map((e) => e.id)).toEqual(['l2']);
    });
  });

  describe('edge handles', () => {
    it('seeds vertical handles for a cross-tier link', () => {
      const result = graphToReactFlow(
        graph([node('r1', 'router'), node('sw1', 'switch')], [link('l1', 'r1', 'sw1')])
      );

      // router tier sits above switch tier, so the link leaves the bottom of r1.
      expect(result.edges[0].sourceHandle).toBe('bottom');
      expect(result.edges[0].targetHandle).toBe('top');
    });

    it('seeds horizontal handles for a same-tier mesh link', () => {
      const result = graphToReactFlow(
        graph([node('sw1', 'switch'), node('sw2', 'switch')], [link('l1', 'sw1', 'sw2')])
      );

      expect(result.edges[0].sourceHandle).toBe('right');
      expect(result.edges[0].targetHandle).toBe('left');
    });
  });

  it('handles an empty graph without throwing', () => {
    expect(graphToReactFlow(graph([], []))).toEqual({ nodes: [], edges: [] });
  });
});
