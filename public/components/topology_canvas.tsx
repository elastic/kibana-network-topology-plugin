/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useRef, useEffect } from 'react';
import { zoom, zoomIdentity, ZoomTransform } from 'd3-zoom';
import { quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import type { TopologyGraph, TopologyNode, TopologyLink } from '../../common';
import { DEVICE_TYPE_CONFIG, STATUS_COLORS } from '../../common';

interface Props {
  graph: TopologyGraph;
  width: number;
  height: number;
  onNodeClick: (nodeId: string) => void;
  selectedNodeId: string | null;
  /** Set of type keys whose nodes should be hidden. Use 'discovered' for unmanaged ARP nodes. */
  hiddenTypes?: Set<string>;
}

interface PlacedNode extends TopologyNode {
  x: number;
  y: number;
}
interface PlacedLink extends Omit<TopologyLink, 'source' | 'target'> {
  source: PlacedNode;
  target: PlacedNode;
}

const R = 20;
// Minimum spacing between node centres in the virtual coordinate space.
// The canvas viewport is smaller; a zoom-to-fit transform brings everything into view.
const MIN_H_SPACING = 100; // horizontal
const MIN_V_SPACING = 120; // vertical (row-to-row)
const MAX_ROW_WIDTH = 12; // max nodes per row before wrapping within the same tier
// Overlay animation (pulsing unhealthy elements) is throttled to 15 fps.
// Almost visually indistinguishable from native rate while providing significant CPU savings vs uncapped 60+ fps.
const OVERLAY_FPS = 15;
const FRAME_INTERVAL_MS = 1000 / OVERLAY_FPS;
const LABEL_FONT = '11px sans-serif';
const IP_FONT = '9px sans-serif';

// Logical topology layout arranged top→bottom:
//   Top:    External BGP peers (unmanaged nodes with BGP links — transit providers, upstream ASes)
//   Middle: Managed device tiers (router → firewall → switch → server → ap → unknown)
//   Bottom: ARP-discovered clients/endpoints (unmanaged nodes without BGP links)
// Each tier fills up to MAX_ROW_WIDTH nodes per row before wrapping.
// Within a tier, nodes are sorted by link-count desc then label asc for determinism.
const TYPE_TIERS = ['router', 'firewall', 'switch', 'server', 'ap', 'unknown'];

function computeLayout(
  nodes: TopologyNode[],
  links: TopologyLink[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const l of links) {
    const src = l.source as string;
    const tgt = l.target as string;
    degree.set(src, (degree.get(src) ?? 0) + 1);
    degree.set(tgt, (degree.get(tgt) ?? 0) + 1);
  }

  // Separate unmanaged nodes into BGP external peers (top) vs ARP-discovered (bottom)
  const bgpNodeIds = new Set<string>();
  for (const l of links) {
    if (l.method === 'bgp') {
      bgpNodeIds.add(l.source as string);
      bgpNodeIds.add(l.target as string);
    }
  }
  const unmanagedBgp = nodes.filter((n) => n.managed === false && bgpNodeIds.has(n.id));
  const unmanagedArp = nodes.filter((n) => n.managed === false && !bgpNodeIds.has(n.id));
  const managed = nodes.filter((n) => n.managed !== false);

  // Bucket managed nodes by type tier; unknown catches any unlisted types
  const byType = new Map<string, TopologyNode[]>(TYPE_TIERS.map((t) => [t, []]));
  for (const n of managed) {
    const bucket = byType.has(n.type) ? n.type : 'unknown';
    byType.get(bucket)!.push(n);
  }

  // Sort within each tier: degree desc, then label asc
  const sortByDegree = (a: TopologyNode, b: TopologyNode) => {
    const d = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    return d !== 0 ? d : a.label.localeCompare(b.label);
  };
  for (const group of byType.values()) group.sort(sortByDegree);
  unmanagedBgp.sort(sortByDegree);
  unmanagedArp.sort((a, b) => a.label.localeCompare(b.label));

  // Build rows: BGP external peers at top, managed tiers in the middle, ARP-discovered at bottom
  const rows: TopologyNode[][] = [];
  // Top: external BGP peers (transit providers, upstream ASes)
  for (let i = 0; i < unmanagedBgp.length; i += MAX_ROW_WIDTH)
    rows.push(unmanagedBgp.slice(i, i + MAX_ROW_WIDTH));
  // Middle: managed device tiers
  for (const t of TYPE_TIERS) {
    const group = byType.get(t)!;
    if (group.length === 0) continue;
    for (let i = 0; i < group.length; i += MAX_ROW_WIDTH)
      rows.push(group.slice(i, i + MAX_ROW_WIDTH));
  }
  // Bottom: ARP-discovered clients/endpoints
  for (let i = 0; i < unmanagedArp.length; i += MAX_ROW_WIDTH)
    rows.push(unmanagedArp.slice(i, i + MAX_ROW_WIDTH));

  if (rows.length === 0) return new Map();

  // Virtual space: expand beyond the canvas if needed to honour minimum spacing
  const maxPerRow = Math.max(...rows.map((r) => r.length));
  const vW = Math.max(width, maxPerRow * MIN_H_SPACING + 80);
  const vH = Math.max(height, rows.length * MIN_V_SPACING + 80);

  const padX = 60;
  const padY = 60;
  const usableW = vW - 2 * padX;
  const usableH = vH - 2 * padY;
  const rowCount = rows.length;

  const positions = new Map<string, { x: number; y: number }>();
  rows.forEach((row, ri) => {
    const y = padY + (rowCount <= 1 ? usableH / 2 : (ri / (rowCount - 1)) * usableH);
    row.forEach((node, i) => {
      const x = row.length === 1 ? vW / 2 : padX + (i / (row.length - 1)) * usableW;
      positions.set(node.id, { x, y });
    });
  });
  return positions;
}

// Configures DPR scaling for a canvas.
function setupCanvas(c: HTMLCanvasElement, w: number, h: number, dpr: number) {
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return ctx;
}

export const TopologyCanvas: React.FC<Props> = ({
  graph,
  width,
  height,
  onNodeClick,
  selectedNodeId,
  hiddenTypes,
}) => {
  // Two stacked canvases. Base holds static content (healthy strokes, fills, glyphs, labels);
  // overlay holds pulsing/selected strokes + tooltip. Mouse events live on the base canvas;
  // the overlay is pointer-events: none so events fall through.
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Stores positions the operator has manually dragged — survive data refreshes
  const dragOverridesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const selectedNodeRef = useRef<string | null>(selectedNodeId);
  // Redraws both layers; used by the selection-only effect and as the "redraw everything" entry point.
  const drawRef = useRef<(() => void) | null>(null);
  // Persists zoom/pan across data refreshes so the canvas doesn't reset on each poll
  const transformRef = useRef<ZoomTransform | null>(null);
  // Tracks the dimKey the saved transform was fitted for; drop transform when this changes.
  const savedDimKeyRef = useRef<string | null>(null);
  // Stable string key for effect deps — changing hidden types triggers re-layout + re-fit
  const hiddenTypesKey = hiddenTypes ? [...hiddenTypes].sort().join(',') : '';

  // Lightweight selection effect — just repaint, don't redo layout
  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
    drawRef.current?.();
  }, [selectedNodeId]);

  useEffect(() => {
    const baseCanvas = baseRef.current;
    const overlayCanvas = overlayRef.current;
    if (!baseCanvas || !overlayCanvas || !graph.nodes.length) return;

    // Single dpr literal, same w/h, same helper → both backing stores identically sized + scaled.
    const dpr = window.devicePixelRatio || 1;
    const baseCtx = setupCanvas(baseCanvas, width, height, dpr);
    const overlayCtx = setupCanvas(overlayCanvas, width, height, dpr);

    // Filter nodes and links by current visibility toggles
    // Step 1: remove nodes whose type is toggled off
    const typeFiltered = graph.nodes.filter((n) => {
      const key = n.managed === false ? 'discovered' : n.type;
      return !hiddenTypes?.has(key);
    });
    // Step 2: prune orphaned discovered nodes — a discovered node is only
    // kept if it has at least one link to a visible managed node. This
    // cascades: hiding APs also hides phones/clients that only appeared
    // in AP ARP tables.
    const managedVisibleIds = new Set(
      typeFiltered.filter((n) => n.managed !== false).map((n) => n.id)
    );
    const visibleNodes = typeFiltered.filter((n) => {
      if (n.managed !== false) return true;
      return graph.links.some((l) => {
        const src = l.source as string;
        const tgt = l.target as string;
        return (
          (src === n.id && managedVisibleIds.has(tgt)) ||
          (tgt === n.id && managedVisibleIds.has(src))
        );
      });
    });
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleLinks = graph.links.filter(
      (l) => visibleNodeIds.has(l.source as string) && visibleNodeIds.has(l.target as string)
    );

    // Compute stable grid positions, overlay any operator-dragged overrides
    const gridPos = computeLayout(visibleNodes, visibleLinks, width, height);
    const nodes: PlacedNode[] = visibleNodes.map((n) => {
      const override = dragOverridesRef.current.get(n.id);
      const grid = gridPos.get(n.id) ?? { x: width / 2, y: height / 2 };
      return { ...n, x: override?.x ?? grid.x, y: override?.y ?? grid.y };
    });

    const buildTree = () =>
      quadtree<PlacedNode>()
        .x((d) => d.x)
        .y((d) => d.y)
        .addAll(nodes);
    let tree = buildTree();

    const labelWidthCache = new Map<string, number>();

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const links: PlacedLink[] = visibleLinks
      .map((l) => {
        const source = nodeById.get(l.source as string);
        const target = nodeById.get(l.target as string);
        if (!source || !target) return null;
        return { ...l, source, target };
      })
      .filter((l): l is PlacedLink => l !== null);

    // Drives whether the overlay rAF loop runs at all. Healthy graph → no per-frame cost.
    const anyUnhealthy =
      nodes.some((n) => n.status === 'down' || n.status === 'degraded') ||
      links.some((l) => l.status !== 'up');

    // Recompute zoom-to-fit when canvas dimensions change (e.g. window resize);
    // reuse saved transform only when the same dimensions re-render (data refresh).
    const dimKey = `${width}x${height}:${hiddenTypesKey}`;
    if (transformRef.current && savedDimKeyRef.current !== dimKey) {
      transformRef.current = null;
    }
    if (!transformRef.current && nodes.length > 0) {
      const allX = nodes.map((n) => n.x);
      const allY = nodes.map((n) => n.y);
      const minX = Math.min(...allX) - R - 16;
      const maxX = Math.max(...allX) + R + 16;
      const minY = Math.min(...allY) - R - 16;
      const maxY = Math.max(...allY) + R + 48;
      const bW = maxX - minX || 1;
      const bH = maxY - minY || 1;
      const fitScale = Math.min(1, width / bW, height / bH) * 0.88;
      const t = zoomIdentity
        .translate(
          (width - bW * fitScale) / 2 - minX * fitScale,
          (height - bH * fitScale) / 2 - minY * fitScale
        )
        .scale(fitScale);
      transformRef.current = t;
      savedDimKeyRef.current = dimKey;
    }
    let transform = transformRef.current ?? zoomIdentity;
    let hovered: PlacedNode | null = null;
    let dragged: PlacedNode | null = null;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartY = 0;
    const DRAG_THRESHOLD = 25; // px² — 5px movement before a click becomes a drag

    // Shared by both draws — guarantees identical CTM on both contexts since ZoomTransform is immutable.
    function applyTransform(ctx: CanvasRenderingContext2D) {
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);
    }

    function nodeAt(px: number, py: number): PlacedNode | null {
      const x = (px - transform.x) / transform.k;
      const y = (py - transform.y) / transform.k;
      return tree.find(x, y, R + 5) ?? null;
    }

    function measureLabel(ctx: CanvasRenderingContext2D, text: string, font: string): number {
      const key = `${font}|${text}`;
      const cached = labelWidthCache.get(key);
      if (cached !== undefined) return cached;
      ctx.font = font;
      const measured = ctx.measureText(text).width;
      labelWidthCache.set(key, measured);
      return measured;
    }

    // Static content: healthy links, all node fills + glyphs + labels, healthy node strokes.
    // Only repaints on layout / zoom / pan / hovered-node-change / selection-change.
    function drawBase() {
      baseCtx.save();
      baseCtx.clearRect(0, 0, width, height);
      applyTransform(baseCtx);

      for (const link of links) {
        if (link.status !== 'up') continue;
        const { source: s, target: t } = link;
        baseCtx.beginPath();
        baseCtx.moveTo(s.x, s.y);
        baseCtx.lineTo(t.x, t.y);
        if (link.method === 'bgp') {
          baseCtx.strokeStyle = '#0077CC';
          baseCtx.globalAlpha = 0.7;
          baseCtx.lineWidth = 3;
          baseCtx.setLineDash([8, 3, 2, 3]);
        } else if (link.method === 'ospf') {
          baseCtx.strokeStyle = '#54B399';
          baseCtx.globalAlpha = 0.7;
          baseCtx.lineWidth = 3;
          baseCtx.setLineDash([10, 4]);
        } else {
          baseCtx.strokeStyle = STATUS_COLORS[link.status] || '#98A2B3';
          baseCtx.globalAlpha = 0.6;
          baseCtx.lineWidth = 2.5;
          baseCtx.setLineDash([]);
        }
        baseCtx.stroke();
        baseCtx.globalAlpha = 1;
        baseCtx.setLineDash([]);
      }

      for (const node of nodes) {
        const cfg = DEVICE_TYPE_CONFIG[node.type] || DEVICE_TYPE_CONFIG.unknown;
        const sel = node.id === selectedNodeRef.current;
        const hov = node === hovered;
        const unmanaged = node.managed === false;
        const nodeBad = node.status === 'down' || node.status === 'degraded';

        baseCtx.beginPath();
        baseCtx.arc(node.x, node.y, R, 0, 2 * Math.PI);
        baseCtx.fillStyle = unmanaged ? '#4A4B52' : cfg.color;
        baseCtx.globalAlpha = unmanaged ? 0.4 : hov || sel ? 1 : 0.85;
        baseCtx.fill();
        baseCtx.globalAlpha = 1;

        // Healthy + non-selected strokes are static — go on base.
        // Pulsing (unhealthy) and selected strokes live on the overlay.
        if (!nodeBad && !sel) {
          if (unmanaged) baseCtx.setLineDash([4, 3]);
          baseCtx.strokeStyle = STATUS_COLORS[node.status] || '#98A2B3';
          baseCtx.lineWidth = 3;
          baseCtx.stroke();
          baseCtx.setLineDash([]);
        }

        baseCtx.fillStyle = '#FFF';
        baseCtx.font = 'bold 14px sans-serif';
        baseCtx.textAlign = 'center';
        baseCtx.textBaseline = 'middle';
        baseCtx.fillText(unmanaged ? '?' : node.type.charAt(0).toUpperCase(), node.x, node.y);

        if (transform.k > 0.5) {
          const showIp = transform.k > 0.8 && !!node.ip;
          const labelW = measureLabel(baseCtx, node.label, LABEL_FONT);
          const ipW = showIp ? measureLabel(baseCtx, node.ip!, IP_FONT) : 0;
          const boxW = Math.max(labelW, ipW) + 10;
          const boxH = showIp ? 30 : 16;
          const boxX = node.x - boxW / 2;
          const boxY = node.y + 24;

          baseCtx.fillStyle = 'rgba(29, 30, 36, 0.75)';
          roundRect(baseCtx, boxX, boxY, boxW, boxH, 4);
          baseCtx.fill();

          baseCtx.fillStyle = hov || sel ? '#FFF' : '#B0B0B0';
          baseCtx.font = LABEL_FONT;
          baseCtx.textAlign = 'center';
          baseCtx.textBaseline = 'top';
          baseCtx.fillText(node.label, node.x, boxY + 2);
          if (showIp) {
            baseCtx.fillStyle = '#808080';
            baseCtx.font = IP_FONT;
            baseCtx.fillText(node.ip!, node.x, boxY + 16);
          }
        }
      }
      baseCtx.restore();
    }

    // Dynamic content: unhealthy strokes (pulsing), selection ring, hover tooltip.
    // rAF-driven when anyUnhealthy; otherwise only repainted on event.
    function drawOverlay() {
      overlayCtx.save();
      overlayCtx.clearRect(0, 0, width, height);
      applyTransform(overlayCtx);

      // Pulse phase: 0→1 sinusoidal oscillation (~2s cycle) for unhealthy elements.
      // Provides a motion cue so status is perceivable without relying on color alone.
      const pulse = (Math.sin((performance.now() / 1000) * 3) + 1) / 2;

      for (const link of links) {
        if (link.status === 'up') continue;
        const { source: s, target: t } = link;
        overlayCtx.beginPath();
        overlayCtx.moveTo(s.x, s.y);
        overlayCtx.lineTo(t.x, t.y);
        if (link.method === 'bgp') {
          overlayCtx.strokeStyle = '#BD271E';
          overlayCtx.globalAlpha = 0.4 + pulse * 0.5;
          overlayCtx.lineWidth = 3 + pulse * 2;
          overlayCtx.setLineDash(link.status === 'down' ? [4, 4] : [8, 3, 2, 3]);
        } else if (link.method === 'ospf') {
          overlayCtx.strokeStyle = '#BD271E';
          overlayCtx.globalAlpha = 0.4 + pulse * 0.5;
          overlayCtx.lineWidth = 3 + pulse * 2;
          overlayCtx.setLineDash(link.status === 'down' ? [4, 4] : [10, 4]);
        } else {
          overlayCtx.strokeStyle = STATUS_COLORS[link.status] || '#98A2B3';
          overlayCtx.globalAlpha = 0.3 + pulse * 0.4;
          overlayCtx.lineWidth = 2 + pulse * 1.5;
          overlayCtx.setLineDash(link.status === 'down' ? [4, 4] : []);
        }
        overlayCtx.stroke();
        overlayCtx.globalAlpha = 1;
        overlayCtx.setLineDash([]);
      }

      for (const node of nodes) {
        const sel = node.id === selectedNodeRef.current;
        const nodeBad = node.status === 'down' || node.status === 'degraded';
        if (!nodeBad && !sel) continue;

        const cfg = DEVICE_TYPE_CONFIG[node.type] || DEVICE_TYPE_CONFIG.unknown;
        const unmanaged = node.managed === false;

        overlayCtx.beginPath();
        overlayCtx.arc(node.x, node.y, R, 0, 2 * Math.PI);
        if (unmanaged) overlayCtx.setLineDash([4, 3]);
        overlayCtx.strokeStyle = sel ? '#FFF' : STATUS_COLORS[node.status] || '#98A2B3';
        overlayCtx.lineWidth = sel ? 4 : 3 + pulse * 2;
        if (nodeBad && !sel) overlayCtx.globalAlpha = 0.6 + pulse * 0.4;
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);
        overlayCtx.globalAlpha = 1;

        if (sel) {
          overlayCtx.beginPath();
          overlayCtx.arc(node.x, node.y, R + 5, 0, 2 * Math.PI);
          overlayCtx.strokeStyle = cfg.color;
          overlayCtx.lineWidth = 2;
          overlayCtx.globalAlpha = 0.5;
          overlayCtx.stroke();
          overlayCtx.globalAlpha = 1;
        }
      }

      if (hovered) {
        const tx = hovered.x + R + 10;
        const ty = hovered.y - 30;
        const lines = [
          hovered.label,
          `IP: ${hovered.ip}`,
          `Type: ${hovered.type}`,
          `Status: ${hovered.status}`,
        ];
        if (hovered.managed === false) {
          const hasBgp = links.some(
            (l) => l.method === 'bgp' && (l.source === hovered || l.target === hovered)
          );
          const hasOspf = links.some(
            (l) => l.method === 'ospf' && (l.source === hovered || l.target === hovered)
          );
          lines.push(
            hasBgp
              ? 'Unmanaged (BGP-discovered)'
              : hasOspf
              ? 'Unmanaged (OSPF-discovered)'
              : 'Unmanaged (ARP-discovered)'
          );
        }
        overlayCtx.fillStyle = 'rgba(30,30,30,0.92)';
        overlayCtx.strokeStyle = 'rgba(255,255,255,0.15)';
        overlayCtx.lineWidth = 1;
        roundRect(overlayCtx, tx, ty, 160, lines.length * 16 + 16, 6);
        overlayCtx.fill();
        overlayCtx.stroke();
        overlayCtx.fillStyle = '#FFF';
        overlayCtx.textAlign = 'left';
        overlayCtx.textBaseline = 'top';
        lines.forEach((l, i) => {
          overlayCtx.font = i === 0 ? 'bold 12px sans-serif' : '11px sans-serif';
          overlayCtx.fillText(l, tx + 8, ty + 8 + i * 16);
        });
      }
      overlayCtx.restore();
    }

    drawRef.current = () => {
      drawBase();
      drawOverlay();
    };
    drawRef.current();

    // rAF gating + 24 fps throttle. rAF keeps firing at the display's native rate (60/120 Hz),
    // but drawOverlay only runs when FRAME_INTERVAL_MS has elapsed. Skipped entirely when nothing pulses.
    let animFrame: number | null = null;
    let lastOverlayDraw = 0;
    if (anyUnhealthy) {
      const animate = (now: number) => {
        if (now - lastOverlayDraw >= FRAME_INTERVAL_MS) {
          drawOverlay();
          lastOverlayDraw = now;
        }
        animFrame = requestAnimationFrame(animate);
      };
      animFrame = requestAnimationFrame(animate);
    }

    // Zoom: disable pan when pressing down on a node so drag and pan don't compete
    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .filter((event: Event) => {
        if (event.type === 'wheel') return true;
        if (event.type === 'mousedown') {
          const me = event as MouseEvent;
          const r = baseCanvas.getBoundingClientRect();
          return !nodeAt(me.clientX - r.left, me.clientY - r.top);
        }
        return true;
      })
      .on('zoom', (e: { transform: ZoomTransform }) => {
        transform = e.transform;
        transformRef.current = e.transform;
        drawBase();
        drawOverlay();
      });
    select(baseCanvas).call(zoomBehavior);
    select(baseCanvas).call(zoomBehavior.transform, transform);

    const onMouseMove = (e: MouseEvent) => {
      const r = baseCanvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      if (dragged) {
        const dx = px - dragStartX;
        const dy = py - dragStartY;
        if (!dragMoved && dx * dx + dy * dy < DRAG_THRESHOLD) {
          // Below threshold — treat as a pending click, not a drag yet
          baseCanvas.style.cursor = 'pointer';
          if (hovered !== dragged) {
            hovered = dragged;
            drawBase();
            drawOverlay();
          }
          return;
        }
        dragged.x = (px - transform.x) / transform.k;
        dragged.y = (py - transform.y) / transform.k;
        dragMoved = true;
        hovered = dragged;
        baseCanvas.style.cursor = 'grabbing';
        drawBase();
        drawOverlay();
        return;
      }
      // Memoize the hovered node — avoid full redraw on per-pixel mouse moves that don't change identity.
      const newHovered = nodeAt(px, py);
      baseCanvas.style.cursor = newHovered ? 'pointer' : 'grab';
      if (newHovered !== hovered) {
        hovered = newHovered;
        drawBase();
        drawOverlay();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const r = baseCanvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const n = nodeAt(px, py);
      if (n) {
        dragged = n;
        dragMoved = false;
        dragStartX = px;
        dragStartY = py;
      }
    };

    const onMouseUp = () => {
      if (dragged) {
        if (dragMoved) {
          dragOverridesRef.current.set(dragged.id, { x: dragged.x, y: dragged.y });
          tree = buildTree();
        }
        dragged = null;
      }
    };

    const onClick = (e: MouseEvent) => {
      if (dragMoved) {
        dragMoved = false;
        return;
      } // suppress click after drag
      const r = baseCanvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (n) onNodeClick(n.id);
    };

    baseCanvas.addEventListener('mousemove', onMouseMove);
    baseCanvas.addEventListener('mousedown', onMouseDown);
    baseCanvas.addEventListener('mouseup', onMouseUp);
    baseCanvas.addEventListener('click', onClick);

    return () => {
      drawRef.current = null;
      if (animFrame !== null) cancelAnimationFrame(animFrame);
      baseCanvas.removeEventListener('mousemove', onMouseMove);
      baseCanvas.removeEventListener('mousedown', onMouseDown);
      baseCanvas.removeEventListener('mouseup', onMouseUp);
      baseCanvas.removeEventListener('click', onClick);
      // Clear d3-zoom listeners (wheel/mousedown/touchstart) installed via select(baseCanvas).call(zoomBehavior).
      // Without this, each re-render layers another zoom behavior on the canvas.
      select(baseCanvas).on('.zoom', null);
    };
    // TODO: Revisit wether hiddenTypes should also be part of the deps array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, width, height, onNodeClick, hiddenTypesKey]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        background: '#1D1E24',
      }}
    >
      <canvas
        ref={baseRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'block',
          width: '100%',
          height: `${height}px`,
        }}
      />
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'block',
          width: '100%',
          height: `${height}px`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}
