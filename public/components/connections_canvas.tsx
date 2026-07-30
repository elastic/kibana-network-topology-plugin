/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useRef, useEffect } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { zoom, zoomIdentity, ZoomTransform } from 'd3-zoom';
import { quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import type { ConnectionsGraph } from '../../common';
import { CONNECTION_ROLE_COLORS } from '../../common';
import { formatBytes, formatCount } from '../utils/format';

interface Props {
  graph: ConnectionsGraph;
  width: number;
  height: number;
  onNodeClick: (nodeId: string) => void;
  /** Double-click on empty canvas — used by the page to clear selection and focus. */
  onBackgroundReset?: () => void;
  selectedNodeId: string | null;
  /** Increment to drop every manually dragged pin and re-run the layout. */
  releasePinsKey?: number;
  /** When true the layout is solved synchronously and painted once, with no per-frame work. */
  animationsDisabled: boolean;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  role: string;
  sessions: number;
  bytes?: number;
  packets?: number;
  degree: number;
  /** Radius in graph space, derived from `sessions`. */
  r: number;
}

/** Every node is seeded with a position before the simulation starts. */
type PlacedNode = SimNode & { x: number; y: number };

interface SimLink extends SimulationLinkDatum<PlacedNode> {
  id: string;
  sessions: number;
  bytes?: number;
  packets?: number;
  /** Stroke width in graph space, derived from `sessions`. */
  w: number;
}

const MIN_R = 4;
const MAX_R = 26;
const MIN_LINK_W = 1;
const MAX_LINK_W = 6;
const LINK_DISTANCE = 60;
const CHARGE_STRENGTH = -80;
// Bounds the many-body approximation: without it, charge is computed across the
// whole graph every tick even between nodes nowhere near each other.
const CHARGE_DISTANCE_MAX = 400;
// Weak x/y centring instead of forceCenter: flow data always has disconnected
// islands, and forceCenter only pins the centre of mass — islands drift off-screen.
const CENTER_STRENGTH = 0.06;
// Labels are the dominant per-frame text cost. Only paint them once nodes are
// legible on screen, and never more than MAX_LABELS of them (biggest first).
const LABEL_MIN_SCALE = 0.75;
const LABEL_MIN_SCREEN_RADIUS = 13;
const MAX_LABELS = 200;
// d3's default alphaDecay (0.0228) reaches alphaMin in ~300 ticks.
const STATIC_TICKS = 300;
// Resuming a mostly-unchanged layout: enough alpha to relax into the new links,
// not enough to throw the whole graph across the viewport on every refresh.
const WARM_START_ALPHA = 0.35;
const WARM_START_RATIO = 0.8;
const QUADTREE_REBUILD_TICKS = 5;
const HIT_SLOP = 4;
const DRAG_THRESHOLD = 25; // px² — 5px of movement before a click becomes a drag
const FIT_PADDING = 0.9;

const LINK_COLOR = 'rgba(152, 162, 179, 0.45)';
const HIGHLIGHT_COLOR = '#F5A623';
const SELECTED_COLOR = '#FFFFFF';
const LABEL_COLOR = '#D3DAE6';
const LABEL_HALO = 'rgba(29, 30, 36, 0.85)';
const BACKGROUND = '#1D1E24';
const LABEL_FONT = '11px sans-serif';
const TOOLTIP_TITLE_FONT = 'bold 12px sans-serif';
const TOOLTIP_FONT = '11px sans-serif';

/**
 * `clamp(min + sqrt(value) * k, min, max)` with k derived from the graph's
 * busiest element, so sizing stays meaningful whether sessions peak at 10 or 10M.
 */
function sqrtScale(maxValue: number, min: number, max: number) {
  const k = maxValue > 1 ? (max - min) / Math.sqrt(maxValue) : 0;
  return (value: number) => Math.max(min, Math.min(max, min + Math.sqrt(Math.max(0, value)) * k));
}

/** Configures DPR scaling for a canvas. */
function setupCanvas(c: HTMLCanvasElement, w: number, h: number, dpr: number) {
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return ctx;
}

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

export const ConnectionsCanvas: React.FC<Props> = ({
  graph,
  width,
  height,
  onNodeClick,
  onBackgroundReset,
  selectedNodeId,
  releasePinsKey = 0,
  animationsDisabled,
}) => {
  // Two stacked canvases, same contract as topology_canvas: the base holds the
  // graph itself (repainted per simulation tick), the overlay holds selection,
  // hover highlight and tooltip so a pointer move over a settled graph never
  // repaints 1,000 links. The overlay is pointer-events: none so events fall through.
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Last known layout, so a data refresh (or a hide/focus change) does not
  // scramble the graph — surviving nodes resume where they were.
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Nodes the operator has dragged stay pinned until pins are released.
  const pinsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const appliedReleaseKeyRef = useRef(releasePinsKey);
  const selectedNodeRef = useRef<string | null>(selectedNodeId);
  const redrawOverlayRef = useRef<(() => void) | null>(null);
  // Persists zoom/pan across data refreshes; dropped when the canvas is resized.
  const transformRef = useRef<ZoomTransform | null>(null);
  const savedDimKeyRef = useRef<string | null>(null);

  // Selection only affects the overlay — no relayout, no base repaint.
  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
    redrawOverlayRef.current?.();
  }, [selectedNodeId]);

  useEffect(() => {
    const baseCanvas = baseRef.current;
    const overlayCanvas = overlayRef.current;
    if (!baseCanvas || !overlayCanvas) return;

    // Single dpr literal, same w/h, same helper → both backing stores identically
    // sized and scaled.
    const dpr = window.devicePixelRatio || 1;
    const baseCtx = setupCanvas(baseCanvas, width, height, dpr);
    const overlayCtx = setupCanvas(overlayCanvas, width, height, dpr);

    // Handled here rather than in its own effect: this effect's cleanup
    // re-captures positions on the way out, so a separate effect would be
    // overwritten by it and the pins would survive a release.
    if (appliedReleaseKeyRef.current !== releasePinsKey) {
      appliedReleaseKeyRef.current = releasePinsKey;
      pinsRef.current.clear();
      positionsRef.current.clear();
      transformRef.current = null;
    }

    if (!graph.nodes.length) {
      baseCtx.clearRect(0, 0, width, height);
      overlayCtx.clearRect(0, 0, width, height);
      return;
    }

    const maxNodeSessions = Math.max(...graph.nodes.map((n) => n.sessions));
    const maxLinkSessions = Math.max(...graph.links.map((l) => l.sessions), 1);
    const radiusOf = sqrtScale(maxNodeSessions, MIN_R, MAX_R);
    const widthOf = sqrtScale(maxLinkSessions, MIN_LINK_W, MAX_LINK_W);

    let carriedOver = 0;
    const nodes: PlacedNode[] = graph.nodes.map((n, i) => {
      const node: SimNode = { ...n, r: radiusOf(n.sessions) };
      const saved = positionsRef.current.get(n.id);
      if (saved) {
        node.x = saved.x;
        node.y = saved.y;
        carriedOver++;
      } else {
        // d3's own phyllotaxis seeding, recentred on the viewport so the layout
        // expands outward from the middle rather than from the origin.
        const angle = i * 2.39996323;
        const spread = 12 * Math.sqrt(i);
        node.x = width / 2 + spread * Math.cos(angle);
        node.y = height / 2 + spread * Math.sin(angle);
      }
      const pin = pinsRef.current.get(n.id);
      if (pin) {
        node.fx = pin.x;
        node.fy = pin.y;
      }
      return node as PlacedNode;
    });

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    // forceLink resolves string endpoints against the node list and throws on a
    // miss, so drop any link whose endpoints were filtered out upstream.
    const links: SimLink[] = graph.links
      .filter((l) => nodeById.has(l.source) && nodeById.has(l.target))
      .map((l) => ({ ...l, w: widthOf(l.sessions) }));

    // Batch the draw calls: links by rounded stroke width, nodes by role colour.
    // 1,000 links become ~6 strokes and 500 nodes become 3 fills.
    const linksByWidth = new Map<number, SimLink[]>();
    for (const link of links) {
      const bucket = Math.max(1, Math.round(link.w));
      const list = linksByWidth.get(bucket);
      if (list) list.push(link);
      else linksByWidth.set(bucket, [link]);
    }
    const nodesByColor = new Map<string, PlacedNode[]>();
    for (const node of nodes) {
      const color = CONNECTION_ROLE_COLORS[node.role] ?? CONNECTION_ROLE_COLORS.both;
      const list = nodesByColor.get(color);
      if (list) list.push(node);
      else nodesByColor.set(color, [node]);
    }
    // Biggest first, so capping the label count keeps the ones that matter.
    const labelCandidates = [...nodes].sort((a, b) => b.r - a.r);

    // Built while endpoints are still string ids — forceLink replaces them with
    // node references when the force is installed on the simulation below.
    const linksByNode = new Map<string, SimLink[]>();
    for (const link of links) {
      for (const id of [link.source as string, link.target as string]) {
        const list = linksByNode.get(id);
        if (list) list.push(link);
        else linksByNode.set(id, [link]);
      }
    }

    let tree = quadtree<PlacedNode>()
      .x((d) => d.x)
      .y((d) => d.y)
      .addAll(nodes);
    const rebuildTree = () => {
      tree = quadtree<PlacedNode>()
        .x((d) => d.x)
        .y((d) => d.y)
        .addAll(nodes);
    };

    const dimKey = `${width}x${height}`;
    if (transformRef.current && savedDimKeyRef.current !== dimKey) {
      transformRef.current = null;
    }
    let transform = transformRef.current ?? zoomIdentity;
    // True once there is a view worth keeping: a transform carried over from a
    // previous render, a pan/zoom gesture, or a completed auto-fit. Tracked
    // separately from transformRef because the programmatic transform below
    // populates transformRef before any of that has happened — and because the
    // simulation settles again after every drag, which must not re-fit.
    let viewEstablished = transformRef.current !== null;
    let hovered: PlacedNode | null = null;
    let dragged: PlacedNode | null = null;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let tickCount = 0;

    const toGraphX = (px: number) => (px - transform.x) / transform.k;
    const toGraphY = (py: number) => (py - transform.y) / transform.k;
    const toScreenX = (x: number) => x * transform.k + transform.x;
    const toScreenY = (y: number) => y * transform.k + transform.y;

    function nodeAt(px: number, py: number): PlacedNode | null {
      const x = toGraphX(px);
      const y = toGraphY(py);
      const found = tree.find(x, y, MAX_R + HIT_SLOP);
      if (!found) return null;
      // find() returns the nearest node within the search radius; radii vary, so
      // confirm the pointer is actually within this node's own disc.
      const dx = found.x - x;
      const dy = found.y - y;
      const reach = Math.max(found.r, MIN_R) + HIT_SLOP;
      return dx * dx + dy * dy <= reach * reach ? found : null;
    }

    function drawBase() {
      baseCtx.save();
      baseCtx.clearRect(0, 0, width, height);
      baseCtx.translate(transform.x, transform.y);
      baseCtx.scale(transform.k, transform.k);

      baseCtx.strokeStyle = LINK_COLOR;
      for (const [strokeWidth, bucket] of linksByWidth) {
        baseCtx.beginPath();
        for (const link of bucket) {
          const s = link.source as PlacedNode;
          const t = link.target as PlacedNode;
          baseCtx.moveTo(s.x, s.y);
          baseCtx.lineTo(t.x, t.y);
        }
        baseCtx.lineWidth = strokeWidth;
        baseCtx.stroke();
      }

      for (const [color, bucket] of nodesByColor) {
        baseCtx.beginPath();
        for (const node of bucket) {
          // moveTo before arc: without it the subpaths are joined by a line.
          baseCtx.moveTo(node.x + node.r, node.y);
          baseCtx.arc(node.x, node.y, node.r, 0, 2 * Math.PI);
        }
        baseCtx.fillStyle = color;
        baseCtx.fill();
      }
      baseCtx.restore();

      // Labels are drawn in screen space at a fixed size — a world-space label
      // is either unreadable when zoomed out or enormous when zoomed in.
      drawLabels();
    }

    function drawLabels() {
      const zoomedIn = transform.k > LABEL_MIN_SCALE;
      if (!zoomedIn && labelCandidates[0].r * transform.k < LABEL_MIN_SCREEN_RADIUS) return;

      baseCtx.save();
      baseCtx.font = LABEL_FONT;
      baseCtx.textAlign = 'center';
      baseCtx.textBaseline = 'top';
      // A stroked halo rather than a filled box behind each label: legible over
      // links and nodes at a fraction of the per-label cost.
      baseCtx.lineWidth = 3;
      baseCtx.strokeStyle = LABEL_HALO;
      baseCtx.fillStyle = LABEL_COLOR;

      let drawn = 0;
      for (const node of labelCandidates) {
        if (drawn >= MAX_LABELS) break;
        const screenR = node.r * transform.k;
        // Sorted by radius desc, so once one node is too small the rest are too.
        if (!zoomedIn && screenR < LABEL_MIN_SCREEN_RADIUS) break;
        const sx = toScreenX(node.x);
        const sy = toScreenY(node.y) + screenR + 3;
        if (sx < -60 || sx > width + 60 || sy < -10 || sy > height + 10) continue;
        baseCtx.strokeText(node.id, sx, sy);
        baseCtx.fillText(node.id, sx, sy);
        drawn++;
      }
      baseCtx.restore();
    }

    // Drawn in screen space so rings and tooltip text stay legible at any zoom.
    function drawOverlay() {
      overlayCtx.clearRect(0, 0, width, height);

      if (hovered) {
        const incident = linksByNode.get(hovered.id) ?? [];
        overlayCtx.strokeStyle = HIGHLIGHT_COLOR;
        overlayCtx.globalAlpha = 0.85;
        overlayCtx.lineWidth = 1.5;
        overlayCtx.beginPath();
        for (const link of incident) {
          const s = link.source as PlacedNode;
          const t = link.target as PlacedNode;
          overlayCtx.moveTo(toScreenX(s.x), toScreenY(s.y));
          overlayCtx.lineTo(toScreenX(t.x), toScreenY(t.y));
        }
        overlayCtx.stroke();
        overlayCtx.globalAlpha = 1;
      }

      const drawRing = (node: PlacedNode | undefined | null, color: string) => {
        if (!node) return;
        overlayCtx.beginPath();
        overlayCtx.arc(
          toScreenX(node.x),
          toScreenY(node.y),
          node.r * transform.k + 3,
          0,
          2 * Math.PI
        );
        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = 2.5;
        overlayCtx.stroke();
      };
      const selectedId = selectedNodeRef.current;
      drawRing(selectedId ? nodeById.get(selectedId) : null, SELECTED_COLOR);
      drawRing(hovered, HIGHLIGHT_COLOR);

      if (hovered) {
        const lines = [
          hovered.id,
          `Role: ${hovered.role}`,
          `Sessions: ${formatCount(hovered.sessions)}`,
          `Peers: ${formatCount(hovered.degree)}`,
        ];
        if (hovered.bytes !== undefined) lines.push(`Bytes: ${formatBytes(hovered.bytes)}`);
        if (hovered.packets !== undefined) lines.push(`Packets: ${formatCount(hovered.packets)}`);

        const boxW =
          Math.max(
            ...lines.map((line, i) => {
              overlayCtx.font = i === 0 ? TOOLTIP_TITLE_FONT : TOOLTIP_FONT;
              return overlayCtx.measureText(line).width;
            })
          ) + 16;
        const boxH = lines.length * 16 + 14;
        // Keep the tooltip inside the canvas rather than letting it clip.
        const anchorX = toScreenX(hovered.x) + hovered.r * transform.k + 10;
        const anchorY = toScreenY(hovered.y) - 20;
        const boxX = Math.max(4, Math.min(anchorX, width - boxW - 4));
        const boxY = Math.max(4, Math.min(anchorY, height - boxH - 4));

        overlayCtx.fillStyle = 'rgba(30, 30, 30, 0.92)';
        overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        overlayCtx.lineWidth = 1;
        roundRect(overlayCtx, boxX, boxY, boxW, boxH, 6);
        overlayCtx.fill();
        overlayCtx.stroke();

        overlayCtx.fillStyle = '#FFF';
        overlayCtx.textAlign = 'left';
        overlayCtx.textBaseline = 'top';
        lines.forEach((line, i) => {
          overlayCtx.font = i === 0 ? TOOLTIP_TITLE_FONT : TOOLTIP_FONT;
          overlayCtx.fillText(line, boxX + 8, boxY + 7 + i * 16);
        });
      }
    }

    function captureLayout() {
      positionsRef.current = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    }

    redrawOverlayRef.current = drawOverlay;

    const simulation: Simulation<PlacedNode, SimLink> = forceSimulation<PlacedNode, SimLink>(nodes)
      .force(
        'link',
        // Link strength is left at d3's default (1 / min(degree(source), degree(target))),
        // which is already the "scale down for high-degree nodes" behaviour hubs need.
        forceLink<PlacedNode, SimLink>(links)
          .id((d) => d.id)
          .distance(LINK_DISTANCE)
      )
      .force(
        'charge',
        forceManyBody<PlacedNode>().strength(CHARGE_STRENGTH).distanceMax(CHARGE_DISTANCE_MAX)
      )
      .force(
        'collide',
        forceCollide<PlacedNode>().radius((d) => d.r + 2)
      )
      .force('x', forceX<PlacedNode>(width / 2).strength(CENTER_STRENGTH))
      .force('y', forceY<PlacedNode>(height / 2).strength(CENTER_STRENGTH));

    // Zoom: suppress panning when the gesture starts on a node so drag and pan
    // never compete for the same mousedown.
    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 8])
      .filter((event: Event) => {
        if (event.type === 'wheel') return true;
        if (event.type === 'mousedown') {
          const me = event as MouseEvent;
          const r = baseCanvas.getBoundingClientRect();
          return !nodeAt(me.clientX - r.left, me.clientY - r.top);
        }
        return true;
      })
      .on('zoom', (e: { transform: ZoomTransform; sourceEvent?: unknown }) => {
        transform = e.transform;
        transformRef.current = e.transform;
        savedDimKeyRef.current = dimKey;
        // sourceEvent is null for programmatic transforms (including the fit below).
        if (e.sourceEvent) viewEstablished = true;
        drawBase();
        drawOverlay();
      });
    select(baseCanvas).call(zoomBehavior);
    // Reclaim double-click: d3-zoom binds it to zoom-in, we use it to clear focus.
    select(baseCanvas).on('dblclick.zoom', null);
    select(baseCanvas).call(zoomBehavior.transform, transform);

    /** Zoom-to-fit once, when the first layout settles and nothing else owns the view. */
    function fitToView() {
      if (viewEstablished) return;
      viewEstablished = true;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const node of nodes) {
        minX = Math.min(minX, node.x - node.r);
        maxX = Math.max(maxX, node.x + node.r);
        minY = Math.min(minY, node.y - node.r);
        maxY = Math.max(maxY, node.y + node.r);
      }
      const bW = maxX - minX || 1;
      const bH = maxY - minY || 1;
      const scale = Math.min(1, width / bW, height / bH) * FIT_PADDING;
      const fitted = zoomIdentity
        .translate(
          (width - bW * scale) / 2 - minX * scale,
          (height - bH * scale) / 2 - minY * scale
        )
        .scale(scale);
      // Routed through d3-zoom so later gestures compose with this transform.
      select(baseCanvas).call(zoomBehavior.transform, fitted);
    }

    if (animationsDisabled) {
      // Same visual contract as topology_canvas's flag: solve the layout up front
      // and paint once, so there is no per-frame cost at all.
      simulation.stop();
      simulation.tick(STATIC_TICKS);
      rebuildTree();
      captureLayout();
      fitToView();
      drawBase();
      drawOverlay();
    } else {
      if (carriedOver > nodes.length * WARM_START_RATIO) simulation.alpha(WARM_START_ALPHA);
      simulation.on('tick', () => {
        tickCount++;
        if (tickCount % QUADTREE_REBUILD_TICKS === 0) rebuildTree();
        drawBase();
        drawOverlay();
      });
      simulation.on('end', () => {
        rebuildTree();
        captureLayout();
        fitToView();
        drawBase();
        drawOverlay();
      });
    }

    const endDrag = () => {
      if (!dragged) return;
      if (dragMoved) {
        // Dragged nodes stay pinned where they were dropped; the toolbar releases
        // them. Pins survive data refreshes.
        pinsRef.current.set(dragged.id, { x: dragged.fx!, y: dragged.fy! });
        if (!animationsDisabled) simulation.alphaTarget(0);
        rebuildTree();
        captureLayout();
      }
      dragged = null;
    };

    const onMouseMove = (e: MouseEvent) => {
      const r = baseCanvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;

      if (dragged) {
        const dx = px - dragStartX;
        const dy = py - dragStartY;
        if (!dragMoved && dx * dx + dy * dy < DRAG_THRESHOLD) return;
        dragMoved = true;
        const gx = toGraphX(px);
        const gy = toGraphY(py);
        dragged.fx = gx;
        dragged.fy = gy;
        baseCanvas.style.cursor = 'grabbing';
        if (animationsDisabled) {
          // No running timer to advance the layout — move the node and repaint.
          dragged.x = gx;
          dragged.y = gy;
          drawBase();
          drawOverlay();
        } else {
          simulation.alphaTarget(0.3).restart();
        }
        return;
      }

      // Memoize the hovered node so per-pixel moves that don't change identity
      // cost nothing.
      const next = nodeAt(px, py);
      baseCanvas.style.cursor = next ? 'pointer' : 'grab';
      if (next !== hovered) {
        hovered = next;
        drawOverlay();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const r = baseCanvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const node = nodeAt(px, py);
      if (node) {
        dragged = node;
        dragMoved = false;
        dragStartX = px;
        dragStartY = py;
      }
    };

    const onMouseUp = () => {
      endDrag();
      baseCanvas.style.cursor = 'pointer';
    };

    // Releasing the button outside the canvas would otherwise leave the node
    // stuck to the cursor.
    const onMouseLeave = () => {
      endDrag();
      if (hovered) {
        hovered = null;
        drawOverlay();
      }
    };

    const onClick = (e: MouseEvent) => {
      if (dragMoved) {
        dragMoved = false; // suppress the click that ends a drag
        return;
      }
      const r = baseCanvas.getBoundingClientRect();
      const node = nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (node) onNodeClick(node.id);
    };

    const onDoubleClick = (e: MouseEvent) => {
      const r = baseCanvas.getBoundingClientRect();
      if (!nodeAt(e.clientX - r.left, e.clientY - r.top)) onBackgroundReset?.();
    };

    baseCanvas.addEventListener('mousemove', onMouseMove);
    baseCanvas.addEventListener('mousedown', onMouseDown);
    baseCanvas.addEventListener('mouseup', onMouseUp);
    baseCanvas.addEventListener('mouseleave', onMouseLeave);
    baseCanvas.addEventListener('click', onClick);
    baseCanvas.addEventListener('dblclick', onDoubleClick);

    return () => {
      // Capture on the way out so a refresh mid-simulation still resumes from
      // the layout the operator was looking at.
      captureLayout();
      redrawOverlayRef.current = null;
      simulation.stop();
      baseCanvas.removeEventListener('mousemove', onMouseMove);
      baseCanvas.removeEventListener('mousedown', onMouseDown);
      baseCanvas.removeEventListener('mouseup', onMouseUp);
      baseCanvas.removeEventListener('mouseleave', onMouseLeave);
      baseCanvas.removeEventListener('click', onClick);
      baseCanvas.removeEventListener('dblclick', onDoubleClick);
      // Without this, each re-render layers another zoom behavior on the canvas.
      select(baseCanvas).on('.zoom', null);
    };
  }, [graph, width, height, onNodeClick, onBackgroundReset, animationsDisabled, releasePinsKey]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        background: BACKGROUND,
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
