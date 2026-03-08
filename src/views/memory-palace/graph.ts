// Memory Palace — Interactive Force-Directed Knowledge Graph
// Pan, zoom, hover tooltips, click-to-recall, real edges

import { pawEngine } from '../../engine';
import { $, escHtml } from '../../components/helpers';
import { CATEGORY_COLORS } from './atoms';
import type { MemoryEdge } from '../../engine/atoms/types';

// ── Types ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  category: string;
  importance: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned: boolean;
}

interface GraphEdge {
  source: GraphNode;
  target: GraphNode;
  type: string;
  weight: number;
}

// ── State ──────────────────────────────────────────────────────────────────

let _nodes: GraphNode[] = [];
let _edges: GraphEdge[] = [];
let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _animId = 0;
let _hoveredNode: GraphNode | null = null;
let _dragNode: GraphNode | null = null;
let _isPanning = false;

// Camera transform
let _camX = 0;
let _camY = 0;
let _zoom = 1;

// Simulation
let _simRunning = false;
let _alpha = 1; // simulation temperature

// Tooltip element
let _tooltip: HTMLDivElement | null = null;

// ── Public API ─────────────────────────────────────────────────────────────

export function initPalaceGraph(): void {
  // rendering triggered by tab switch
}

export async function renderPalaceGraph(): Promise<void> {
  const canvas = $('palace-graph-render') as HTMLCanvasElement | null;
  const emptyEl = $('palace-graph-empty');
  if (!canvas) return;

  if (emptyEl) {
    emptyEl.style.display = 'flex';
    (emptyEl as HTMLElement).innerHTML = `
      <div class="empty-icon"><span class="ms" style="font-size:48px">hub</span></div>
      <div class="empty-title">Loading memory map\u2026</div>
    `;
  }

  try {
    const [engineMems, engineEdges] = await Promise.all([
      pawEngine.memoryList(200),
      pawEngine.memoryEdges(500).catch(() => [] as MemoryEdge[]),
    ]);

    if (!engineMems.length) {
      if (emptyEl) {
        (emptyEl as HTMLElement).innerHTML = `
          <div class="empty-icon"><span class="ms" style="font-size:48px">hub</span></div>
          <div class="empty-title">No memories yet</div>
          <div class="empty-subtitle">Memories will appear here as your agents learn</div>
        `;
        emptyEl.style.display = 'flex';
      }
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    canvas.style.display = '';

    _buildGraph(engineMems, engineEdges, canvas);
  } catch (e) {
    console.warn('Graph load failed:', e);
    if (emptyEl) {
      (emptyEl as HTMLElement).innerHTML = `
        <div class="empty-icon"><span class="ms" style="font-size:48px">error</span></div>
        <div class="empty-title">Failed to load memory map</div>
        <div class="empty-subtitle">${escHtml(String(e))}</div>
      `;
      emptyEl.style.display = 'flex';
    }
  }
}

// ── Graph construction ─────────────────────────────────────────────────────

interface RawMem {
  id: string;
  content: string;
  category: string;
  importance: number;
}

function _buildGraph(mems: RawMem[], rawEdges: MemoryEdge[], canvas: HTMLCanvasElement): void {
  // Stop any existing simulation
  if (_animId) cancelAnimationFrame(_animId);
  _simRunning = false;

  // Size canvas to container
  const rect = canvas.parentElement?.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect?.width ?? 800;
  const h = rect?.height ?? 600;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  _ctx = canvas.getContext('2d');
  if (!_ctx) return;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _canvas = canvas;

  // Build node map
  const nodeMap = new Map<string, GraphNode>();
  // Group by category for initial placement
  const catGroups = new Map<string, RawMem[]>();
  for (const m of mems) {
    const cat = m.category || 'other';
    if (!catGroups.has(cat)) catGroups.set(cat, []);
    catGroups.get(cat)!.push(m);
  }

  const cats = Array.from(catGroups.keys());
  const cx = w / 2,
    cy = h / 2;
  const clusterRadius = Math.min(cx, cy) * 0.4;

  cats.forEach((cat, ci) => {
    const angle = (ci / cats.length) * Math.PI * 2 - Math.PI / 2;
    const gx = cx + Math.cos(angle) * clusterRadius;
    const gy = cy + Math.sin(angle) * clusterRadius;
    const group = catGroups.get(cat)!;

    group.forEach((m, mi) => {
      const innerAngle = (mi / group.length) * Math.PI * 2;
      const spread = Math.min(30 + group.length * 5, 80);
      const node: GraphNode = {
        id: m.id,
        label: m.content.length > 60 ? `${m.content.slice(0, 57)}...` : m.content,
        category: cat,
        importance: m.importance,
        x: gx + Math.cos(innerAngle) * spread * (0.4 + Math.random() * 0.6),
        y: gy + Math.sin(innerAngle) * spread * (0.4 + Math.random() * 0.6),
        vx: 0,
        vy: 0,
        radius: 5 + m.importance * 0.8,
        pinned: false,
      };
      nodeMap.set(m.id, node);
    });
  });

  _nodes = Array.from(nodeMap.values());

  // Build edges
  _edges = [];
  for (const e of rawEdges) {
    const src = nodeMap.get(e.source_id);
    const tgt = nodeMap.get(e.target_id);
    if (src && tgt) {
      _edges.push({ source: src, target: tgt, type: e.edge_type, weight: e.weight });
    }
  }

  // Reset camera
  _camX = 0;
  _camY = 0;
  _zoom = 1;
  _hoveredNode = null;
  _dragNode = null;

  // Create tooltip
  if (!_tooltip) {
    _tooltip = document.createElement('div');
    _tooltip.className = 'palace-graph-tooltip';
    canvas.parentElement?.appendChild(_tooltip);
  }
  _tooltip.style.display = 'none';

  // Bind events (idempotent via stored handler refs)
  _bindEvents(canvas);

  // Start simulation
  _alpha = 1;
  _simRunning = true;
  _tick();
}

// ── Force simulation ───────────────────────────────────────────────────────

function _tick(): void {
  if (!_simRunning || !_ctx || !_canvas) return;

  const w = _canvas.width / (window.devicePixelRatio || 1);
  const h = _canvas.height / (window.devicePixelRatio || 1);

  // Apply forces
  if (_alpha > 0.001) {
    _applyForces(w, h);
    _alpha *= 0.995; // cooling
  }

  // Update positions
  for (const n of _nodes) {
    if (n.pinned) continue;
    n.x += n.vx;
    n.y += n.vy;
    n.vx *= 0.85; // damping
    n.vy *= 0.85;
  }

  _draw(w, h);
  _animId = requestAnimationFrame(_tick);
}

function _applyForces(w: number, h: number): void {
  const strength = _alpha;

  // 1. Center gravity
  const gravityStrength = 0.01 * strength;
  const cx = w / 2,
    cy = h / 2;
  for (const n of _nodes) {
    n.vx += (cx - n.x) * gravityStrength;
    n.vy += (cy - n.y) * gravityStrength;
  }

  // 2. Node repulsion (Barnes-Hut simplified: all-pairs for reasonable N)
  const repulsionStrength = 300 * strength;
  for (let i = 0; i < _nodes.length; i++) {
    for (let j = i + 1; j < _nodes.length; j++) {
      const a = _nodes[i],
        b = _nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy || 1;
      const dist = Math.sqrt(dist2);
      const force = repulsionStrength / dist2;
      // Same category = less repulsion (cluster together)
      const catFactor = a.category === b.category ? 0.5 : 1;
      const fx = (dx / dist) * force * catFactor;
      const fy = (dy / dist) * force * catFactor;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // 3. Edge attraction (spring)
  const springStrength = 0.06 * strength;
  const idealLength = 80;
  for (const e of _edges) {
    const dx = e.target.x - e.source.x;
    const dy = e.target.y - e.source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const displacement = dist - idealLength;
    const force = displacement * springStrength * e.weight;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    e.source.vx += fx;
    e.source.vy += fy;
    e.target.vx -= fx;
    e.target.vy -= fy;
  }

  // 4. Same-category soft attraction
  const catAttract = 0.005 * strength;
  const catCenters = new Map<string, { x: number; y: number; count: number }>();
  for (const n of _nodes) {
    const c = catCenters.get(n.category);
    if (c) {
      c.x += n.x;
      c.y += n.y;
      c.count++;
    } else {
      catCenters.set(n.category, { x: n.x, y: n.y, count: 1 });
    }
  }
  for (const c of catCenters.values()) {
    c.x /= c.count;
    c.y /= c.count;
  }
  for (const n of _nodes) {
    const c = catCenters.get(n.category)!;
    n.vx += (c.x - n.x) * catAttract;
    n.vy += (c.y - n.y) * catAttract;
  }
}

// ── Canvas rendering ───────────────────────────────────────────────────────

function _draw(w: number, h: number): void {
  const ctx = _ctx!;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Apply camera
  ctx.translate(w / 2, h / 2);
  ctx.scale(_zoom, _zoom);
  ctx.translate(-w / 2 + _camX, -h / 2 + _camY);

  // Draw edges
  ctx.lineWidth = 1;
  for (const e of _edges) {
    ctx.beginPath();
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
    ctx.strokeStyle = `rgba(120, 120, 140, ${0.15 + e.weight * 0.35})`;
    ctx.lineWidth = 0.5 + e.weight * 1.5;
    ctx.stroke();
  }

  // Draw category labels (behind nodes)
  const catCenters = new Map<string, { x: number; y: number; count: number }>();
  for (const n of _nodes) {
    const c = catCenters.get(n.category);
    if (c) {
      c.x += n.x;
      c.y += n.y;
      c.count++;
    } else catCenters.set(n.category, { x: n.x, y: n.y, count: 1 });
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [cat, c] of catCenters) {
    const cx = c.x / c.count;
    const cy = c.y / c.count;
    ctx.font = 'bold 11px Figtree, system-ui, sans-serif';
    ctx.fillStyle = CATEGORY_COLORS[cat] ?? '#676879';
    ctx.globalAlpha = 0.25;
    ctx.fillText(cat.toUpperCase(), cx, cy - 25);
    ctx.globalAlpha = 1;
  }

  // Draw nodes
  for (const n of _nodes) {
    const color = CATEGORY_COLORS[n.category] ?? '#676879';
    const isHovered = n === _hoveredNode;
    const isDragged = n === _dragNode;
    const r = isHovered ? n.radius + 3 : n.radius;

    // Glow for hovered
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = isDragged ? 1 : 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Border
    ctx.strokeStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = isHovered ? 2.5 : 1;
    ctx.stroke();

    // Label for hovered node
    if (isHovered) {
      const label = n.label.length > 40 ? `${n.label.slice(0, 37)}...` : n.label;
      ctx.font = '11px Figtree, system-ui, sans-serif';
      ctx.fillStyle = 'var(--text-primary, #e0e0e0)';
      const metrics = ctx.measureText(label);
      const pad = 6;
      const lx = n.x - metrics.width / 2 - pad;
      const ly = n.y - r - 22;

      // Label background
      ctx.fillStyle = 'rgba(30, 30, 35, 0.9)';
      ctx.beginPath();
      const rx = lx,
        ry = ly - 7,
        rw = metrics.width + pad * 2,
        rh = 18,
        rr = 4;
      ctx.moveTo(rx + rr, ry);
      ctx.lineTo(rx + rw - rr, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rr, rr);
      ctx.lineTo(rx + rw, ry + rh - rr);
      ctx.arcTo(rx + rw, ry + rh, rx + rw - rr, ry + rh, rr);
      ctx.lineTo(rx + rr, ry + rh);
      ctx.arcTo(rx, ry + rh, rx, ry + rh - rr, rr);
      ctx.lineTo(rx, ry + rr);
      ctx.arcTo(rx, ry, rx + rr, ry, rr);
      ctx.closePath();
      ctx.fill();

      // Label text
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(label, n.x, ly + 2);
    }
  }

  ctx.restore();

  // Draw zoom/count HUD
  ctx.font = '10px Figtree, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(120, 120, 130, 0.7)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    `${_nodes.length} memories \u00B7 ${_edges.length} links \u00B7 ${Math.round(_zoom * 100)}%`,
    8,
    h - 8,
  );
}

// ── Event handling ─────────────────────────────────────────────────────────

let _eventsBound = false;

function _bindEvents(canvas: HTMLCanvasElement): void {
  if (_eventsBound) return;
  _eventsBound = true;

  canvas.addEventListener('mousemove', _onMouseMove);
  canvas.addEventListener('mousedown', _onMouseDown);
  canvas.addEventListener('mouseup', _onMouseUp);
  canvas.addEventListener('mouseleave', _onMouseLeave);
  canvas.addEventListener('wheel', _onWheel, { passive: false });
  canvas.addEventListener('dblclick', _onDoubleClick);
  canvas.style.cursor = 'grab';
}

function _screenToWorld(sx: number, sy: number): { x: number; y: number } {
  if (!_canvas) return { x: sx, y: sy };
  const w = _canvas.width / (window.devicePixelRatio || 1);
  const h = _canvas.height / (window.devicePixelRatio || 1);
  return {
    x: (sx - w / 2) / _zoom + w / 2 - _camX,
    y: (sy - h / 2) / _zoom + h / 2 - _camY,
  };
}

function _nodeAt(sx: number, sy: number): GraphNode | null {
  const { x, y } = _screenToWorld(sx, sy);
  // Check in reverse order (top-drawn nodes first)
  for (let i = _nodes.length - 1; i >= 0; i--) {
    const n = _nodes[i];
    const dx = x - n.x,
      dy = y - n.y;
    if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) return n;
  }
  return null;
}

function _canvasPos(e: MouseEvent): { x: number; y: number } {
  const rect = _canvas!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function _onMouseMove(e: MouseEvent): void {
  const pos = _canvasPos(e);

  if (_dragNode) {
    const world = _screenToWorld(pos.x, pos.y);
    _dragNode.x = world.x;
    _dragNode.y = world.y;
    _dragNode.vx = 0;
    _dragNode.vy = 0;
    // Reheat slightly for dragging
    _alpha = Math.max(_alpha, 0.05);
    return;
  }

  if (_isPanning) {
    const dx = e.movementX / _zoom;
    const dy = e.movementY / _zoom;
    _camX += dx;
    _camY += dy;
    return;
  }

  // Hover detection
  const node = _nodeAt(pos.x, pos.y);
  _hoveredNode = node;
  _canvas!.style.cursor = node ? 'pointer' : 'grab';

  // Tooltip
  if (node && _tooltip) {
    _tooltip.innerHTML = `
      <div class="palace-graph-tooltip-cat" style="color:${CATEGORY_COLORS[node.category] ?? '#676879'}">${escHtml(node.category.toUpperCase())}</div>
      <div class="palace-graph-tooltip-text">${escHtml(node.label)}</div>
      <div class="palace-graph-tooltip-meta">importance: ${node.importance} &middot; click to view &middot; double-click to recall</div>
    `;
    _tooltip.style.display = 'block';
    _tooltip.style.left = `${e.clientX - (_canvas!.parentElement?.getBoundingClientRect().left ?? 0) + 12}px`;
    _tooltip.style.top = `${e.clientY - (_canvas!.parentElement?.getBoundingClientRect().top ?? 0) - 10}px`;
  } else if (_tooltip) {
    _tooltip.style.display = 'none';
  }
}

function _onMouseDown(e: MouseEvent): void {
  const pos = _canvasPos(e);
  const node = _nodeAt(pos.x, pos.y);

  if (node) {
    _dragNode = node;
    node.pinned = true;
    _canvas!.style.cursor = 'grabbing';
  } else {
    _isPanning = true;
    _canvas!.style.cursor = 'grabbing';
  }
}

function _onMouseUp(_e: MouseEvent): void {
  if (_dragNode) {
    _dragNode.pinned = false;
    _dragNode = null;
  }
  _isPanning = false;
  _canvas!.style.cursor = _hoveredNode ? 'pointer' : 'grab';
}

function _onMouseLeave(): void {
  _dragNode = null;
  _isPanning = false;
  _hoveredNode = null;
  if (_tooltip) _tooltip.style.display = 'none';
}

function _onWheel(e: WheelEvent): void {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.92 : 1.08;
  _zoom = Math.max(0.2, Math.min(5, _zoom * factor));
}

function _onDoubleClick(e: MouseEvent): void {
  const pos = _canvasPos(e);
  const node = _nodeAt(pos.x, pos.y);
  if (node?.id) {
    // Lazy import to avoid circular dependency with molecules.ts
    import('./molecules').then((m) => m.palaceRecallById(node.id));
  }
}
