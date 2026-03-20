import React, { useRef, useEffect } from 'react';
import { zoom, zoomIdentity, ZoomTransform } from 'd3-zoom';
import { quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import type { TopologyGraph, TopologyNode, TopologyLink } from '../../common';
import { DEVICE_TYPE_CONFIG, STATUS_COLORS } from '../../common';

interface Props {
  graph: TopologyGraph; width: number; height: number;
  onNodeClick: (nodeId: string) => void; selectedNodeId: string | null;
}

interface PlacedNode extends TopologyNode { x: number; y: number; }
interface PlacedLink extends Omit<TopologyLink, 'source' | 'target'> {
  source: PlacedNode; target: PlacedNode;
}

const R = 20;
const ROLE_ORDER = ['core', 'distribution', 'access', 'server'];

// Deterministic grid: group nodes by role, sort alphabetically within each row,
// then evenly space horizontally. No animation, no randomness.
function computeLayout(
  nodes: TopologyNode[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const byRole: Record<string, TopologyNode[]> = {};
  for (const r of [...ROLE_ORDER, 'unknown']) byRole[r] = [];
  for (const node of nodes) {
    const r = node.role ?? 'unknown';
    (byRole[r] ?? byRole['unknown']).push(node);
  }
  for (const arr of Object.values(byRole)) arr.sort((a, b) => a.label.localeCompare(b.label));

  const layers = ROLE_ORDER.filter(r => byRole[r].length > 0);
  if (byRole['unknown'].length > 0) layers.push('unknown');

  const padX = width * 0.08;
  const padYTop = height * 0.12;
  const padYBot = height * 0.12;
  const usableW = width - 2 * padX;
  const usableH = height - padYTop - padYBot;
  const layerCount = layers.length;

  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((role, li) => {
    const rowNodes = byRole[role];
    const y = padYTop + (layerCount <= 1 ? usableH / 2 : (li / (layerCount - 1)) * usableH);
    const count = rowNodes.length;
    rowNodes.forEach((node, i) => {
      const x = count === 1 ? width / 2 : padX + (i / (count - 1)) * usableW;
      positions.set(node.id, { x, y });
    });
  });
  return positions;
}

export const TopologyCanvas: React.FC<Props> = ({ graph, width, height, onNodeClick, selectedNodeId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stores positions the operator has manually dragged — survive data refreshes
  const dragOverridesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const selectedNodeRef = useRef<string | null>(selectedNodeId);
  const drawRef = useRef<(() => void) | null>(null);

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
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Compute stable grid positions, overlay any operator-dragged overrides
    const gridPos = computeLayout(graph.nodes, width, height);
    const nodes: PlacedNode[] = graph.nodes.map(n => {
      const override = dragOverridesRef.current.get(n.id);
      const grid = gridPos.get(n.id) ?? { x: width / 2, y: height / 2 };
      return { ...n, x: override?.x ?? grid.x, y: override?.y ?? grid.y };
    });

    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const links: PlacedLink[] = graph.links
      .map(l => {
        const source = nodeById.get(l.source as string);
        const target = nodeById.get(l.target as string);
        if (!source || !target) return null;
        return { ...l, source, target };
      })
      .filter((l): l is PlacedLink => l !== null);

    let transform = zoomIdentity;
    let hovered: PlacedNode | null = null;
    let dragged: PlacedNode | null = null;
    let dragMoved = false;

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

        ctx!.beginPath(); ctx!.arc(node.x, node.y, R, 0, 2 * Math.PI);
        ctx!.fillStyle = cfg.color; ctx!.globalAlpha = hov || sel ? 1 : 0.85; ctx!.fill();
        ctx!.strokeStyle = sel ? '#FFF' : (STATUS_COLORS[node.status] || '#98A2B3');
        ctx!.lineWidth = sel ? 3 : 2; ctx!.stroke(); ctx!.globalAlpha = 1;

        if (sel) {
          ctx!.beginPath(); ctx!.arc(node.x, node.y, R + 5, 0, 2 * Math.PI);
          ctx!.strokeStyle = cfg.color; ctx!.lineWidth = 2; ctx!.globalAlpha = 0.5;
          ctx!.stroke(); ctx!.globalAlpha = 1;
        }

        ctx!.fillStyle = '#FFF'; ctx!.font = 'bold 14px sans-serif';
        ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle';
        ctx!.fillText(node.type.charAt(0).toUpperCase(), node.x, node.y);

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
      .on('zoom', (e: { transform: ZoomTransform }) => { transform = e.transform; draw(); });
    select(canvas).call(zoomBehavior);

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      if (dragged) {
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
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (n) { dragged = n; dragMoved = false; }
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
  }, [graph, width, height, onNodeClick]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: `${height}px`, background: '#1D1E24' }} />;
};

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
