// ─────────────────────────────────────────────────────────────────────────────
// Flow Visualization Engine — Canvas Molecules (Hub)
// Mount/unmount lifecycle, render orchestration, and canvas helpers.
// Sub-modules: canvas-state, canvas-render, canvas-interaction.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type FlowGraph,
  type FlowNode,
  type TesseractCell,
  type EventHorizon,
  GRID_SIZE,
  detectMeshGroups,
  detectTesseract,
} from './atoms';
import { getMoleculesState } from './molecule-state';
import { cs, svgEl, applyTransform } from './canvas-state';
import { renderNode, renderPorts, renderEdge } from './canvas-render';
import {
  setCanvasCallbacks,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onDoubleClick,
  onContextMenu,
  dismissEdgeContextMenu,
} from './canvas-interaction';

/** Schedule a single renderGraph() call on the next animation frame. */
export function scheduleRender(): void {
  if (cs.renderScheduled) return;
  cs.renderScheduled = true;
  requestAnimationFrame(() => {
    cs.renderScheduled = false;
    renderGraph();
  });
}

// ── Index Maps ──────────────────────────────────────────────────────────────

function rebuildIndexes(graph: FlowGraph): void {
  cs.nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  cs.outEdges = new Map();
  cs.inEdges = new Map();
  for (const n of graph.nodes) {
    cs.outEdges.set(n.id, []);
    cs.inEdges.set(n.id, []);
  }
  for (const e of graph.edges) {
    cs.outEdges.get(e.from)?.push(e);
    cs.inEdges.get(e.to)?.push(e);
  }
}

/** Mark a node ID as new so it gets the materialise entrance animation */
export function markNodeNew(id: string) {
  cs.newNodeIds.add(id);
}

/** Add a node ID to the new-node animation set (for toolbar use). */
export function addNewNodeId(id: string) {
  cs.newNodeIds.add(id);
}

// ── Canvas Placement Helpers (for toolbar node creation) ───────────────────

/** Get the center of the visible canvas area in graph coordinates. */
export function getCanvasCenter(): { x: number; y: number } {
  return { x: (-cs.panX + 400) / cs.zoom, y: (-cs.panY + 200) / cs.zoom };
}

/** Return current viewport state for minimap synchronisation. */
export function getCanvasViewport(): {
  panX: number;
  panY: number;
  zoom: number;
  width: number;
  height: number;
} {
  return {
    panX: cs.panX,
    panY: cs.panY,
    zoom: cs.zoom,
    width: cs.svg?.clientWidth ?? 800,
    height: cs.svg?.clientHeight ?? 600,
  };
}

/** Programmatically set pan / zoom (used by minimap drag). */
export function setPanZoom(panX: number, panY: number, zoom: number): void {
  cs.panX = panX;
  cs.panY = panY;
  cs.zoom = Math.max(cs.MIN_ZOOM, Math.min(cs.MAX_ZOOM, zoom));
  applyTransform();
}

/** Zoom in one step. */
export function zoomIn(): void {
  cs.zoom = Math.min(cs.MAX_ZOOM, cs.zoom * 1.2);
  applyTransform();
}

/** Zoom out one step. */
export function zoomOut(): void {
  cs.zoom = Math.max(cs.MIN_ZOOM, cs.zoom * 0.8);
  applyTransform();
}

// ── Mount / Unmount ────────────────────────────────────────────────────────

export function mountCanvas(container: HTMLElement) {
  container.innerHTML = '';

  cs.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cs.svg.setAttribute('class', 'flow-canvas');
  cs.svg.setAttribute('width', '100%');
  cs.svg.setAttribute('height', '100%');

  // Defs: arrow markers, glow filters
  const defs = svgEl('defs');
  defs.innerHTML = `
    <marker id="flow-arrow-fwd" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M 0 0 L 10 4 L 0 8 Z" fill="var(--text-muted)"/>
    </marker>
    <marker id="flow-arrow-rev" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto">
      <path d="M 10 0 L 0 4 L 10 8 Z" fill="var(--status-info)"/>
    </marker>
    <marker id="flow-arrow-bi-end" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M 0 0 L 10 4 L 0 8 Z" fill="var(--kinetic-gold)"/>
    </marker>
    <marker id="flow-arrow-bi-start" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto">
      <path d="M 10 0 L 0 4 L 10 8 Z" fill="var(--kinetic-gold)"/>
    </marker>
    <filter id="flow-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="flow-selected-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="flow-grid" width="${GRID_SIZE}" height="${GRID_SIZE}" patternUnits="userSpaceOnUse">
      <circle cx="${GRID_SIZE / 2}" cy="${GRID_SIZE / 2}" r="0.5" fill="var(--border-subtle)"/>
    </pattern>
    <pattern id="flow-halftone" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="0.5" fill="var(--kinetic-red, #FF4D4D)"/>
    </pattern>
    <filter id="flow-kinetic-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feFlood flood-color="var(--kinetic-red, #FF4D4D)" flood-opacity="0.15" result="color"/>
      <feComposite in="color" in2="blur" operator="in" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  `;
  cs.svg.appendChild(defs);

  // Background grid
  const bg = svgEl('rect');
  bg.setAttribute('class', 'flow-bg');
  bg.setAttribute('width', '10000');
  bg.setAttribute('height', '10000');
  bg.setAttribute('x', '-5000');
  bg.setAttribute('y', '-5000');
  bg.setAttribute('fill', 'url(#flow-grid)');
  cs.svg.appendChild(bg);

  // Groups in z-order
  cs.edgesGroup = svgEl('g') as SVGGElement;
  cs.edgesGroup.setAttribute('class', 'flow-edges');
  cs.svg.appendChild(cs.edgesGroup);

  cs.portsGroup = svgEl('g') as SVGGElement;
  cs.portsGroup.setAttribute('class', 'flow-ports');
  cs.svg.appendChild(cs.portsGroup);

  cs.nodesGroup = svgEl('g') as SVGGElement;
  cs.nodesGroup.setAttribute('class', 'flow-nodes');
  cs.svg.appendChild(cs.nodesGroup);

  cs.dragPreviewGroup = svgEl('g') as SVGGElement;
  cs.dragPreviewGroup.setAttribute('class', 'flow-drag-preview');
  cs.svg.appendChild(cs.dragPreviewGroup);

  container.appendChild(cs.svg);

  // Wire interaction callbacks before adding event listeners
  setCanvasCallbacks(renderGraph, updateDraggedNodePosition);

  // Wire events
  cs.svg.addEventListener('mousedown', onMouseDown);
  cs.svg.addEventListener('mousemove', onMouseMove);
  cs.svg.addEventListener('mouseup', onMouseUp);
  cs.svg.addEventListener('wheel', onWheel, { passive: false });
  cs.svg.addEventListener('dblclick', onDoubleClick);
  cs.svg.addEventListener('contextmenu', onContextMenu);

  applyTransform();
}

export function unmountCanvas() {
  if (cs.svg) {
    cs.svg.removeEventListener('mousedown', onMouseDown);
    cs.svg.removeEventListener('mousemove', onMouseMove);
    cs.svg.removeEventListener('mouseup', onMouseUp);
    cs.svg.removeEventListener('wheel', onWheel);
    cs.svg.removeEventListener('dblclick', onDoubleClick);
    cs.svg.removeEventListener('contextmenu', onContextMenu);
    cs.svg.remove();
    cs.svg = null;
  }
  dismissEdgeContextMenu();
  cs.nodesGroup = null;
  cs.edgesGroup = null;
  cs.portsGroup = null;
  cs.dragPreviewGroup = null;
}

// ── Phase 0.2b: Dirty-region rendering during drag ─────────────────────────

function updateDraggedNodePosition(nodeId: string): void {
  if (!cs.nodesGroup || !cs.edgesGroup || !cs.portsGroup) return;
  const node = cs.nodeMap.get(nodeId);
  if (!node) return;

  const nodeG = cs.nodesGroup.querySelector(`[data-node-id="${nodeId}"]`) as SVGGElement | null;
  if (nodeG) {
    nodeG.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    (nodeG as unknown as HTMLElement).style.setProperty('--node-tx', `${node.x}px`);
    (nodeG as unknown as HTMLElement).style.setProperty('--node-ty', `${node.y}px`);
  }

  const oldPorts = cs.portsGroup.querySelectorAll(`[data-node-id="${nodeId}"]`);
  oldPorts.forEach((p) => p.remove());
  renderPorts(node);

  const connectedEdges = [...(cs.outEdges.get(nodeId) ?? []), ...(cs.inEdges.get(nodeId) ?? [])];
  for (const edge of connectedEdges) {
    const oldEdgeEl = cs.edgesGroup.querySelector(`[data-edge-id="${edge.id}"]`);
    if (oldEdgeEl) oldEdgeEl.remove();
    const fromNode = cs.nodeMap.get(edge.from);
    const toNode = cs.nodeMap.get(edge.to);
    if (fromNode && toNode) {
      cs.edgesGroup.appendChild(renderEdge(edge, fromNode, toNode));
    }
  }
}

// ── Full Render ────────────────────────────────────────────────────────────

export function renderGraph() {
  const _state = getMoleculesState();
  const graph = _state?.getGraph();
  if (!graph || !cs.nodesGroup || !cs.edgesGroup || !cs.portsGroup) return;

  rebuildIndexes(graph);

  cs.edgesGroup.innerHTML = '';
  cs.nodesGroup.innerHTML = '';
  cs.portsGroup.innerHTML = '';

  // Render mesh group enclosures (behind everything)
  const meshGroups = detectMeshGroups(graph);
  for (const group of meshGroups) {
    const meshNodes = group
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter(Boolean) as FlowNode[];
    if (meshNodes.length < 2) continue;

    const pad = 20;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of meshNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }

    const enclosure = svgEl('rect');
    enclosure.setAttribute('class', 'flow-mesh-group');
    enclosure.setAttribute('x', String(minX - pad));
    enclosure.setAttribute('y', String(minY - pad - 14));
    enclosure.setAttribute('width', String(maxX - minX + pad * 2));
    enclosure.setAttribute('height', String(maxY - minY + pad * 2 + 14));
    cs.edgesGroup.appendChild(enclosure);

    const label = svgEl('text');
    label.setAttribute('class', 'flow-mesh-group-label');
    label.setAttribute('x', String(minX - pad + 8));
    label.setAttribute('y', String(minY - pad - 2));
    label.textContent = 'Convergent Mesh';
    cs.edgesGroup.appendChild(label);
  }

  // ── Tesseract Schlegel projection (cube-in-cube) ──────────────────────
  const tess = detectTesseract(graph);
  if (tess && tess.cells.length > 0) {
    renderTesseractOverlay(graph, tess);
  }

  for (const edge of graph.edges) {
    const fromNode = cs.nodeMap.get(edge.from);
    const toNode = cs.nodeMap.get(edge.to);
    if (fromNode && toNode) {
      cs.edgesGroup.appendChild(renderEdge(edge, fromNode, toNode));
    }
  }

  const selectedId = _state.getSelectedNodeId();
  const selectedIds = _state.getSelectedNodeIds();
  for (const node of graph.nodes) {
    const isSelected = selectedIds.size > 0 ? selectedIds.has(node.id) : node.id === selectedId;
    cs.nodesGroup.appendChild(renderNode(node, isSelected));
    renderPorts(node);
  }
}

// ── Tesseract Schlegel Overlay ──────────────────────────────────────────────

/**
 * Render the tesseract cube-in-cube (Schlegel diagram) overlay.
 * Each cell gets a bounding rectangle. The largest cell is the outer cube,
 * smaller cells are rendered inset. Event horizons get a radial connector
 * linking the cell boundaries.
 */
function renderTesseractOverlay(
  graph: FlowGraph,
  tess: { cells: TesseractCell[]; horizons: EventHorizon[] },
): void {
  if (!cs.edgesGroup) return;

  const PAD = 30;
  const INSET = 12;

  // Compute bounding rect for each cell
  const cellBounds: Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number; phase: number }
  > = new Map();

  for (const cell of tess.cells) {
    const nodes = cell.nodeIds
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter(Boolean) as FlowNode[];
    if (nodes.length === 0) continue;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    cellBounds.set(cell.id, { minX, minY, maxX, maxY, phase: cell.phase });
  }

  if (cellBounds.size === 0) return;

  // Sort cells by area (largest = outer cube, smaller = inner cubes)
  const sorted = [...cellBounds.entries()].sort((a, b) => {
    const areaA = (a[1].maxX - a[1].minX) * (a[1].maxY - a[1].minY);
    const areaB = (b[1].maxX - b[1].minX) * (b[1].maxY - b[1].minY);
    return areaB - areaA;
  });

  // Phase color palette
  const phaseColors = [
    'var(--kinetic-sage, #8FB0A0)',
    'var(--kinetic-gold, #D4A853)',
    'var(--kinetic-purple, #A855F7)',
    'var(--kinetic-red, #FF4D4D)',
  ];

  // Render cell enclosures (largest first = behind)
  for (let i = 0; i < sorted.length; i++) {
    const [cellId, bounds] = sorted[i];
    const cell = tess.cells.find((c) => c.id === cellId);
    if (!cell) continue;

    const inset = i * INSET;
    const color = phaseColors[cell.phase % phaseColors.length];

    // Cell rectangle
    const rect = svgEl('rect');
    rect.setAttribute('class', `flow-tesseract-cell flow-tesseract-cell-w${cell.phase}`);
    rect.setAttribute('x', String(bounds.minX - PAD + inset));
    rect.setAttribute('y', String(bounds.minY - PAD - 18 + inset));
    rect.setAttribute('width', String(bounds.maxX - bounds.minX + PAD * 2 - inset * 2));
    rect.setAttribute('height', String(bounds.maxY - bounds.minY + PAD * 2 + 18 - inset * 2));
    rect.setAttribute('rx', String(16 - i * 2));
    rect.setAttribute('ry', String(16 - i * 2));
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', color);
    rect.setAttribute('stroke-width', i === 0 ? '1.5' : '1');
    rect.setAttribute('stroke-dasharray', i === 0 ? '8 4' : '4 3');
    rect.setAttribute('opacity', String(0.4 + i * 0.1));
    cs.edgesGroup.appendChild(rect);

    // Phase label
    const lbl = svgEl('text');
    lbl.setAttribute('class', 'flow-tesseract-label');
    lbl.setAttribute('x', String(bounds.minX - PAD + inset + 10));
    lbl.setAttribute('y', String(bounds.minY - PAD - 4 + inset));
    lbl.setAttribute('fill', color);
    lbl.setAttribute('font-size', '9');
    lbl.setAttribute('font-weight', '600');
    lbl.setAttribute('opacity', '0.7');
    const depthStr =
      cell.depthRange[0] === cell.depthRange[1]
        ? `Z${cell.depthRange[0]}`
        : `Z${cell.depthRange[0]}–${cell.depthRange[1]}`;
    lbl.textContent = `W${cell.phase} ${cell.label} · ${depthStr}`;
    cs.edgesGroup.appendChild(lbl);

    // Corner connectors (Schlegel projection lines from outer to inner)
    if (i > 0 && sorted.length > 1) {
      const outer = sorted[0][1];
      const outerPad = PAD;
      const corners: [number, number][] = [
        [bounds.minX - PAD + inset, bounds.minY - PAD - 18 + inset],
        [bounds.maxX + PAD - inset, bounds.minY - PAD - 18 + inset],
        [bounds.maxX + PAD - inset, bounds.maxY + PAD - inset],
        [bounds.minX - PAD + inset, bounds.maxY + PAD - inset],
      ];
      const outerCorners: [number, number][] = [
        [outer.minX - outerPad, outer.minY - outerPad - 18],
        [outer.maxX + outerPad, outer.minY - outerPad - 18],
        [outer.maxX + outerPad, outer.maxY + outerPad],
        [outer.minX - outerPad, outer.maxY + outerPad],
      ];

      for (let c = 0; c < 4; c++) {
        const line = svgEl('line');
        line.setAttribute('class', 'flow-tesseract-connector');
        line.setAttribute('x1', String(outerCorners[c][0]));
        line.setAttribute('y1', String(outerCorners[c][1]));
        line.setAttribute('x2', String(corners[c][0]));
        line.setAttribute('y2', String(corners[c][1]));
        line.setAttribute('stroke', 'var(--kinetic-purple, #A855F7)');
        line.setAttribute('stroke-width', '0.5');
        line.setAttribute('stroke-dasharray', '2 3');
        line.setAttribute('opacity', '0.3');
        cs.edgesGroup.appendChild(line);
      }
    }
  }

  // Render event horizon sync markers
  for (const horizon of tess.horizons) {
    const hNode = graph.nodes.find((n) => n.id === horizon.nodeId);
    if (!hNode) continue;

    // Radial pulse ring behind the node
    const ring = svgEl('circle');
    ring.setAttribute('class', 'flow-horizon-pulse');
    ring.setAttribute('cx', String(hNode.x + hNode.width / 2));
    ring.setAttribute('cy', String(hNode.y + hNode.height / 2));
    ring.setAttribute('r', String(Math.max(hNode.width, hNode.height) / 2 + 18));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'var(--kinetic-purple, #A855F7)');
    ring.setAttribute('stroke-width', '1');
    ring.setAttribute('opacity', '0.3');
    ring.setAttribute('stroke-dasharray', '3 2');
    cs.edgesGroup.appendChild(ring);

    // Phase transition label
    const phLabel = svgEl('text');
    phLabel.setAttribute('class', 'flow-horizon-label');
    phLabel.setAttribute('x', String(hNode.x + hNode.width / 2));
    phLabel.setAttribute(
      'y',
      String(hNode.y + hNode.height / 2 + Math.max(hNode.width, hNode.height) / 2 + 28),
    );
    phLabel.setAttribute('text-anchor', 'middle');
    phLabel.setAttribute('fill', 'var(--kinetic-purple, #A855F7)');
    phLabel.setAttribute('font-size', '8');
    phLabel.setAttribute('opacity', '0.6');
    phLabel.textContent = `→ W${horizon.phaseAfter} · ${horizon.mergePolicy}`;
    cs.edgesGroup.appendChild(phLabel);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

export function fitView() {
  if (!cs.svg) return;
  const _state = getMoleculesState();
  if (!_state) return;
  const graph = _state.getGraph();
  if (!graph || !graph.nodes.length) return;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of graph.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  const rect = cs.svg.getBoundingClientRect();
  const graphW = maxX - minX + 80;
  const graphH = maxY - minY + 80;
  cs.zoom = Math.min(rect.width / graphW, rect.height / graphH, 1.5);
  cs.panX = (rect.width - graphW * cs.zoom) / 2 - minX * cs.zoom + 40;
  cs.panY = (rect.height - graphH * cs.zoom) / 2 - minY * cs.zoom + 40;

  applyTransform();
}

export function deleteSelected() {
  const _state = getMoleculesState();
  if (!_state) return;
  const graph = _state.getGraph();
  if (!graph) return;

  const selectedIds = _state.getSelectedNodeIds();
  const selectedId = _state.getSelectedNodeId();
  const idsToDelete =
    selectedIds.size > 0 ? selectedIds : selectedId ? new Set([selectedId]) : new Set<string>();

  if (idsToDelete.size === 0) return;

  graph.nodes = graph.nodes.filter((n) => !idsToDelete.has(n.id));
  graph.edges = graph.edges.filter((e) => !idsToDelete.has(e.from) && !idsToDelete.has(e.to));
  _state.setSelectedNodeId(null);
  _state.setSelectedNodeIds(new Set());
  _state.onGraphChanged();
  renderGraph();
}

export function resetView() {
  cs.panX = 0;
  cs.panY = 0;
  cs.zoom = 1;
  applyTransform();
}
