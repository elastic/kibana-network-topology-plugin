import React, { useRef, useEffect } from 'react';
import { zoom, zoomIdentity, ZoomTransform } from 'd3-zoom';
import { quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import type { TopologyGraph, TopologyNode, TopologyLink } from '../../common';
import { DEVICE_TYPE_CONFIG, STATUS_COLORS } from '../../common';

interface Props {
  graph: TopologyGraph; width: number; height: number;
  onNodeClick: (nodeId: string) => void; selectedNodeId: string | null;
  /** Set of type keys whose nodes should be hidden. Use 'discovered' for unmanaged ARP nodes. */
  hiddenTypes?: Set<string>;
}

interface PlacedNode extends TopologyNode { x: number; y: number; }
interface PlacedLink extends Omit<TopologyLink, 'source' | 'target'> {
  source: PlacedNode; target: PlacedNode;
}

const R = 20;
// Minimum spacing between node centres in the virtual coordinate space.
// The canvas viewport is smaller; a zoom-to-fit transform brings everything into view.
const MIN_H_SPACING = 100; // horizontal
const MIN_V_SPACING = 120; // vertical (row-to-row)
const MAX_ROW_WIDTH  = 12; // max nodes per row before wrapping within the same tier

// Pyramid layout: device types are arranged in tiers top→bottom.
// Each tier fills up to MAX_ROW_WIDTH nodes per row before wrapping within the tier.
// Within a tier, nodes are sorted by link-count desc then label asc for determinism.
// Unmanaged (ARP-discovered) nodes always occupy the bottom tier.
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

  const unmanaged = nodes.filter(n => n.managed === false);
  const managed   = nodes.filter(n => n.managed !== false);

  // Bucket managed nodes by type tier; unknown catches any unlisted types
  const byType = new Map<string, TopologyNode[]>(TYPE_TIERS.map(t => [t, []]));
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
  unmanaged.sort((a, b) => a.label.localeCompare(b.label));

  // Build rows: each tier fills up to MAX_ROW_WIDTH before wrapping
  const rows: TopologyNode[][] = [];
  for (const t of TYPE_TIERS) {
    const group = byType.get(t)!;
    if (group.length === 0) continue;
    for (let i = 0; i < group.length; i += MAX_ROW_WIDTH) rows.push(group.slice(i, i + MAX_ROW_WIDTH));
  }
  // Unmanaged at the bottom
  for (let i = 0; i < unmanaged.length; i += MAX_ROW_WIDTH) rows.push(unmanaged.slice(i, i + MAX_ROW_WIDTH));

  if (rows.length === 0) return new Map();

  // Virtual space: expand beyond the canvas if needed to honour minimum spacing
  const maxPerRow = Math.max(...rows.map(r => r.length));
  const vW = Math.max(width,  maxPerRow  * MIN_H_SPACING + 80);
  const vH = Math.max(height, rows.length * MIN_V_SPACING + 80);

  const padX = 60, padY = 60;
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

export const TopologyCanvas: React.FC<Props> = ({ graph, width, height, onNodeClick, selectedNodeId, hiddenTypes }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stores positions the operator has manually dragged — survive data refreshes
  const dragOverridesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const selectedNodeRef = useRef<string | null>(selectedNodeId);
  const drawRef = useRef<(() => void) | null>(null);
  // Persists zoom/pan across data refreshes so the canvas doesn't reset on each poll
  const transformRef = useRef<ZoomTransform | null>(null);
  // Stable string key for effect deps — changing hidden types triggers re-layout + re-fit
  const hiddenTypesKey = hiddenTypes ? [...hiddenTypes].sort().join(',') : '';

  // Lightweight selection effect — just repaint, don't redo layout
  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
    drawRef.current?.();
  }, [selectedNodeId]);

  useEffect(() => {
    if (!canvasRef.current || !graph.nodes.length) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Filter nodes and links by current visibility toggles
    // Step 1: remove nodes whose type is toggled off
    const typeFiltered = graph.nodes.filter(n => {
      const key = n.managed === false ? 'discovered' : n.type;
      return !(hiddenTypes?.has(key));
    });
    // Step 2: prune orphaned discovered nodes — a discovered node is only
    // kept if it has at least one link to a visible managed node. This
    // cascades: hiding APs also hides phones/clients that only appeared
    // in AP ARP tables.
    const managedVisibleIds = new Set(
      typeFiltered.filter(n => n.managed !== false).map(n => n.id)
    );
    const visibleNodes = typeFiltered.filter(n => {
      if (n.managed !== false) return true;
      return graph.links.some(l => {
        const src = l.source as string, tgt = l.target as string;
        return (src === n.id && managedVisibleIds.has(tgt))
            || (tgt === n.id && managedVisibleIds.has(src));
      });
    });
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleLinks = graph.links.filter(
      l => visibleNodeIds.has(l.source as string) && visibleNodeIds.has(l.target as string)
    );

    // Compute stable grid positions, overlay any operator-dragged overrides
    const gridPos = computeLayout(visibleNodes, visibleLinks, width, height);
    const nodes: PlacedNode[] = visibleNodes.map(n => {
      const override = dragOverridesRef.current.get(n.id);
      const grid = gridPos.get(n.id) ?? { x: width / 2, y: height / 2 };
      return { ...n, x: override?.x ?? grid.x, y: override?.y ?? grid.y };
    });

    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const links: PlacedLink[] = visibleLinks
      .map(l => {
        const source = nodeById.get(l.source as string);
        const target = nodeById.get(l.target as string);
        if (!source || !target) return null;
        return { ...l, source, target };
      })
      .filter((l): l is PlacedLink => l !== null);

    // Recompute zoom-to-fit when canvas dimensions change (e.g. window resize);
    // reuse saved transform only when the same dimensions re-render (data refresh).
    const dimKey = `${width}x${height}:${hiddenTypesKey}`;
    if (transformRef.current && (transformRef.current as any).__dimKey !== dimKey) {
      transformRef.current = null;
    }
    if (!transformRef.current && nodes.length > 0) {
      const allX = nodes.map(n => n.x);
      const allY = nodes.map(n => n.y);
      const minX = Math.min(...allX) - R - 16, maxX = Math.max(...allX) + R + 16;
      const minY = Math.min(...allY) - R - 16, maxY = Math.max(...allY) + R + 48;
      const bW = maxX - minX || 1, bH = maxY - minY || 1;
      const fitScale = Math.min(1, width / bW, height / bH) * 0.88;
      const t = zoomIdentity
        .translate((width - bW * fitScale) / 2 - minX * fitScale,
                   (height - bH * fitScale) / 2 - minY * fitScale)
        .scale(fitScale);
      (t as any).__dimKey = dimKey;
      transformRef.current = t;
    }
    let transform = transformRef.current ?? zoomIdentity;
    let hovered: PlacedNode | null = null;
    let dragged: PlacedNode | null = null;
    let dragMoved = false;
    let dragStartX = 0, dragStartY = 0;
    const DRAG_THRESHOLD = 25; // px² — 5px movement before a click becomes a drag

    function nodeAt(px: number, py: number): PlacedNode | null {
      const x = (px - transform.x) / transform.k;
      const y = (py - transform.y) / transform.k;
      return quadtree<PlacedNode>().x(d => d.x).y(d => d.y).addAll(nodes).find(x, y, R + 5) ?? null;
    }

    function draw() {
      ctx!.save(); ctx!.clearRect(0, 0, width, height);
      ctx!.translate(transform.x, transform.y); ctx!.scale(transform.k, transform.k);

      for (const link of links) {
        const { source: s, target: t } = link;
        ctx!.beginPath(); ctx!.moveTo(s.x, s.y); ctx!.lineTo(t.x, t.y);
        ctx!.strokeStyle = STATUS_COLORS[link.status] || '#98A2B3';
        ctx!.globalAlpha = link.status === 'down' ? 0.4 : 0.6;
        ctx!.lineWidth = link.status === 'down' ? 1 : 1.5;
        ctx!.setLineDash(link.status === 'down' ? [4, 4] : []);
        ctx!.stroke(); ctx!.globalAlpha = 1; ctx!.setLineDash([]);
      }

      for (const node of nodes) {
        const cfg = DEVICE_TYPE_CONFIG[node.type] || DEVICE_TYPE_CONFIG.unknown;
        const sel = node.id === selectedNodeRef.current, hov = node === hovered;
        const unmanaged = node.managed === false;

        ctx!.beginPath(); ctx!.arc(node.x, node.y, R, 0, 2 * Math.PI);
        ctx!.fillStyle = unmanaged ? '#4A4B52' : cfg.color;
        ctx!.globalAlpha = unmanaged ? 0.4 : (hov || sel ? 1 : 0.85);
        ctx!.fill();
        if (unmanaged) ctx!.setLineDash([4, 3]);
        ctx!.strokeStyle = sel ? '#FFF' : (STATUS_COLORS[node.status] || '#98A2B3');
        ctx!.lineWidth = sel ? 3 : 2; ctx!.stroke();
        ctx!.setLineDash([]); ctx!.globalAlpha = 1;

        if (sel) {
          ctx!.beginPath(); ctx!.arc(node.x, node.y, R + 5, 0, 2 * Math.PI);
          ctx!.strokeStyle = cfg.color; ctx!.lineWidth = 2; ctx!.globalAlpha = 0.5;
          ctx!.stroke(); ctx!.globalAlpha = 1;
        }

        ctx!.fillStyle = '#FFF'; ctx!.font = 'bold 14px sans-serif';
        ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle';
        ctx!.fillText(unmanaged ? '?' : node.type.charAt(0).toUpperCase(), node.x, node.y);

        if (transform.k > 0.5) {
          ctx!.fillStyle = hov || sel ? '#FFF' : '#B0B0B0';
          ctx!.font = '11px sans-serif'; ctx!.textBaseline = 'top';
          ctx!.fillText(node.label, node.x, node.y + 28);
          if (transform.k > 0.8 && node.ip) {
            ctx!.fillStyle = '#808080'; ctx!.font = '9px sans-serif';
            ctx!.fillText(node.ip, node.x, node.y + 42);
          }
        }
      }

      if (hovered) {
        const tx = hovered.x + R + 10, ty = hovered.y - 30;
        const lines = [hovered.label, `IP: ${hovered.ip}`, `Type: ${hovered.type}`, `Status: ${hovered.status}`];
        if (hovered.managed === false) lines.push('Unmanaged (ARP-discovered)');
        ctx!.fillStyle = 'rgba(30,30,30,0.92)'; ctx!.strokeStyle = 'rgba(255,255,255,0.15)'; ctx!.lineWidth = 1;
        roundRect(ctx!, tx, ty, 160, lines.length * 16 + 16, 6); ctx!.fill(); ctx!.stroke();
        ctx!.fillStyle = '#FFF'; ctx!.textAlign = 'left'; ctx!.textBaseline = 'top';
        lines.forEach((l, i) => {
          ctx!.font = i === 0 ? 'bold 12px sans-serif' : '11px sans-serif';
          ctx!.fillText(l, tx + 8, ty + 8 + i * 16);
        });
      }
      ctx!.restore();
    }

    drawRef.current = draw;
    draw();

    // Zoom: disable pan when pressing down on a node so drag and pan don't compete
    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .filter((event: Event) => {
        if (event.type === 'wheel') return true;
        if (event.type === 'mousedown') {
          const me = event as MouseEvent;
          const r = canvas.getBoundingClientRect();
          return !nodeAt(me.clientX - r.left, me.clientY - r.top);
        }
        return true;
      })
      .on('zoom', (e: { transform: ZoomTransform }) => { transform = e.transform; transformRef.current = e.transform; draw(); });
    select(canvas).call(zoomBehavior);
    select(canvas).call(zoomBehavior.transform, transform);

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      if (dragged) {
        const dx = px - dragStartX, dy = py - dragStartY;
        if (!dragMoved && (dx * dx + dy * dy) < DRAG_THRESHOLD) {
          // Below threshold — treat as a pending click, not a drag yet
          hovered = dragged;
          canvas.style.cursor = 'pointer';
          draw();
          return;
        }
        dragged.x = (px - transform.x) / transform.k;
        dragged.y = (py - transform.y) / transform.k;
        dragMoved = true;
      }
      hovered = dragged ?? nodeAt(px, py);
      canvas.style.cursor = dragged ? 'grabbing' : (hovered ? 'pointer' : 'grab');
      draw();
    });

    canvas.addEventListener('mousedown', e => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const n = nodeAt(px, py);
      if (n) { dragged = n; dragMoved = false; dragStartX = px; dragStartY = py; }
    });

    canvas.addEventListener('mouseup', () => {
      if (dragged) {
        if (dragMoved) dragOverridesRef.current.set(dragged.id, { x: dragged.x, y: dragged.y });
        dragged = null;
      }
    });

    canvas.addEventListener('click', e => {
      if (dragMoved) { dragMoved = false; return; } // suppress click after drag
      const r = canvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (n) onNodeClick(n.id);
    });

    return () => { drawRef.current = null; };
  }, [graph, width, height, onNodeClick, hiddenTypesKey]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: `${height}px`, background: '#1D1E24' }} />;
};

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
