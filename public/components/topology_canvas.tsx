import React, { useRef, useEffect } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from 'd3-force';
import { zoom, zoomIdentity, ZoomTransform } from 'd3-zoom';
import { quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import type { TopologyGraph, TopologyNode, TopologyLink } from '../../common';
import { DEVICE_TYPE_CONFIG, STATUS_COLORS } from '../../common';

interface Props {
  graph: TopologyGraph; width: number; height: number;
  onNodeClick: (nodeId: string) => void; selectedNodeId: string | null;
}

interface SimNode extends TopologyNode { x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null; }
interface SimLink extends Omit<TopologyLink, 'source' | 'target'> { source: SimNode | string; target: SimNode | string; }

const R = 20;
const ROLE_LAYER: Record<string, number> = { core: 0, distribution: 1, access: 2, server: 3 };
const LAYER_COUNT = 4;

type SavedPos = { x: number; y: number; fx: number | null; fy: number | null };

export const TopologyCanvas: React.FC<Props> = ({ graph, width, height, onNodeClick, selectedNodeId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<string, SavedPos>>(new Map());
  const selectedNodeRef = useRef<string | null>(selectedNodeId);
  const drawRef = useRef<(() => void) | null>(null);

  // Lightweight effect: update selection highlight without re-running the simulation
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

    const nodes: SimNode[] = graph.nodes.map(n => {
      const saved = nodesRef.current.get(n.id);
      return {
        ...n,
        x:  saved?.x  ?? (width / 2 + (Math.random() - 0.5) * 200),
        y:  saved?.y  ?? (height / 2 + (Math.random() - 0.5) * 200),
        vx: 0, vy: 0,
        fx: saved?.fx ?? null,
        fy: saved?.fy ?? null,
      };
    });
    const links: SimLink[] = graph.links.map(l => ({ ...l }));

    let transform = zoomIdentity;
    let hovered: SimNode | null = null;
    let dragged: SimNode | null = null;

    const layerY = (node: SimNode) =>
      height * (0.15 + ((ROLE_LAYER[node.role ?? ''] ?? 1) / (LAYER_COUNT - 1)) * 0.70);

    const sim = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d: SimNode) => d.id).distance(120).strength(0.5))
      .force('charge', forceManyBody().strength(-400).distanceMax(500))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collision', forceCollide<SimNode>().radius(R + 10))
      .force('y', forceY<SimNode>((d: SimNode) => layerY(d)).strength(0.4))
      .force('x', forceX<SimNode>(width / 2).strength(0.05))
      .alphaDecay(0.02)
      .on('tick', draw)
      .on('end', () => {
        for (const node of nodes) {
          node.fx = node.x;
          node.fy = node.y;
          nodesRef.current.set(node.id, { x: node.x, y: node.y, fx: node.x, fy: node.y });
        }
        draw();
      });

    function draw() {
      ctx!.save(); ctx!.clearRect(0, 0, width, height);
      ctx!.translate(transform.x, transform.y); ctx!.scale(transform.k, transform.k);

      for (const link of links) {
        const s = link.source as SimNode, t = link.target as SimNode;
        if (!s.x || !t.x) continue;
        ctx!.beginPath(); ctx!.moveTo(s.x, s.y); ctx!.lineTo(t.x, t.y);
        ctx!.strokeStyle = STATUS_COLORS[link.status] || '#98A2B3';
        ctx!.globalAlpha = link.status === 'down' ? 0.4 : 0.6;
        ctx!.lineWidth = link.status === 'down' ? 1 : 1.5;
        ctx!.setLineDash(link.status === 'down' ? [4, 4] : []);
        ctx!.stroke(); ctx!.globalAlpha = 1; ctx!.setLineDash([]);
      }

      for (const node of nodes) {
        if (!node.x || !node.y) continue;
        const cfg = DEVICE_TYPE_CONFIG[node.type] || DEVICE_TYPE_CONFIG.unknown;
        const sel = node.id === selectedNodeRef.current, hov = node === hovered;

        ctx!.beginPath(); ctx!.arc(node.x, node.y, R, 0, 2 * Math.PI);
        ctx!.fillStyle = cfg.color; ctx!.globalAlpha = hov || sel ? 1 : 0.85; ctx!.fill();
        ctx!.strokeStyle = sel ? '#FFF' : (STATUS_COLORS[node.status] || '#98A2B3');
        ctx!.lineWidth = sel ? 3 : 2; ctx!.stroke(); ctx!.globalAlpha = 1;

        if (sel) { ctx!.beginPath(); ctx!.arc(node.x, node.y, R + 5, 0, 2 * Math.PI); ctx!.strokeStyle = cfg.color; ctx!.lineWidth = 2; ctx!.globalAlpha = 0.5; ctx!.stroke(); ctx!.globalAlpha = 1; }

        ctx!.fillStyle = '#FFF'; ctx!.font = 'bold 14px sans-serif'; ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle';
        ctx!.fillText(node.type.charAt(0).toUpperCase(), node.x, node.y);

        if (transform.k > 0.5) {
          ctx!.fillStyle = hov || sel ? '#FFF' : '#B0B0B0'; ctx!.font = '11px sans-serif'; ctx!.textBaseline = 'top';
          ctx!.fillText(node.label, node.x, node.y + 28);
          if (transform.k > 0.8 && node.ip) { ctx!.fillStyle = '#808080'; ctx!.font = '9px sans-serif'; ctx!.fillText(node.ip, node.x, node.y + 42); }
        }
      }

      if (hovered?.x && hovered?.y) {
        const tx = hovered.x + R + 10, ty = hovered.y - 30;
        const lines = [hovered.label, `IP: ${hovered.ip}`, `Type: ${hovered.type}`, `Status: ${hovered.status}`];
        ctx!.fillStyle = 'rgba(30,30,30,0.92)'; ctx!.strokeStyle = 'rgba(255,255,255,0.15)'; ctx!.lineWidth = 1;
        roundRect(ctx!, tx, ty, 160, lines.length * 16 + 16, 6); ctx!.fill(); ctx!.stroke();
        ctx!.fillStyle = '#FFF'; ctx!.textAlign = 'left'; ctx!.textBaseline = 'top';
        lines.forEach((l, i) => { ctx!.font = i === 0 ? 'bold 12px sans-serif' : '11px sans-serif'; ctx!.fillText(l, tx + 8, ty + 8 + i * 16); });
      }
      ctx!.restore();
    }

    drawRef.current = draw;

    const qt = () => quadtree<SimNode>().x((d: SimNode) => d.x).y((d: SimNode) => d.y).addAll(nodes);
    function nodeAt(px: number, py: number) {
      const x = (px - transform.x) / transform.k, y = (py - transform.y) / transform.k;
      return qt().find(x, y, R + 5) || null;
    }

    select(canvas).call(zoom<HTMLCanvasElement, unknown>().scaleExtent([0.1, 4]).on('zoom', (e: { transform: ZoomTransform }) => { transform = e.transform; draw(); }));

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      hovered = n; canvas.style.cursor = dragged ? 'grabbing' : (n ? 'pointer' : 'grab');
      if (dragged) { dragged.fx = (e.clientX - r.left - transform.x) / transform.k; dragged.fy = (e.clientY - r.top - transform.y) / transform.k; }
      draw();
    });
    canvas.addEventListener('click', e => { const r = canvas.getBoundingClientRect(); const n = nodeAt(e.clientX - r.left, e.clientY - r.top); if (n) onNodeClick(n.id); });
    canvas.addEventListener('mousedown', e => { const r = canvas.getBoundingClientRect(); const n = nodeAt(e.clientX - r.left, e.clientY - r.top); if (n) { dragged = n; n.fx = n.x; n.fy = n.y; sim.alphaTarget(0.1).restart(); } });
    canvas.addEventListener('mouseup', () => {
      if (dragged) {
        nodesRef.current.set(dragged.id, { x: dragged.fx!, y: dragged.fy!, fx: dragged.fx, fy: dragged.fy });
        dragged = null;
        sim.alphaTarget(0);
      }
    });

    return () => { sim.stop(); drawRef.current = null; };
  }, [graph, width, height, onNodeClick]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: `${height}px`, background: '#1D1E24' }} />;
};

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
