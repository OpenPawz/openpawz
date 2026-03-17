// Memory Atlas — WebGL Embedding Scatter Plot
// 2D/3D visualization of memory embeddings with clustering, selection,
// query distance heatmap, and point inspection.
//
// Uses Three.js for GPU-accelerated rendering of thousands of points.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pawEngine } from '../../engine';
import { getCategoryColor } from './atoms';
import type { ProjectedPoint, ProjectedEdge, EmbeddingCluster } from '../../engine/atoms/types';

// ── Types ──────────────────────────────────────────────────────────────
interface AtlasState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  points: ProjectedPoint[];
  clusters: EmbeddingCluster[];
  pointCloud: THREE.Points | null;
  edgeLines: THREE.LineSegments | null;
  dbEdges: ProjectedEdge[];
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;
  hoveredIndex: number;
  selectedIndices: Set<number>;
  is3D: boolean;
  colorMode: 'category' | 'importance' | 'distance';
  queryPoint: THREE.Vector3 | null;
  animId: number;
  container: HTMLElement | null;
  tooltip: HTMLDivElement | null;
  selectionPanel: HTMLDivElement | null;
  disposed: boolean;
}

let _state: AtlasState | null = null;

// ── Constants ──────────────────────────────────────────────────────────
const POINT_SIZE_BASE = 0.035;
const POINT_SIZE_HOVER = 0.06;
const BG_COLOR = 0x0a0a0c;
const GRID_COLOR = 0x1a1a1e;
const SPREAD_FACTOR = 4.0;

// ── Public API ─────────────────────────────────────────────────────────

export function destroyAtlas(): void {
  if (!_state) return;
  _state.disposed = true;
  if (_state.animId) cancelAnimationFrame(_state.animId);
  _state.controls.dispose();
  _state.renderer.dispose();
  _state.scene.clear();
  _state.tooltip?.remove();
  _state.selectionPanel?.remove();
  _state.renderer.domElement.remove();
  _state = null;
}

export async function renderAtlas(container: HTMLElement): Promise<void> {
  destroyAtlas();

  container.innerHTML = `
    <div class="atlas-loading">
      <span class="ms" style="font-size:32px;color:var(--text-muted)">scatter_plot</span>
      <div style="color:var(--text-secondary);font-size:13px;margin-top:8px">
        Projecting embeddings\u2026
      </div>
    </div>
  `;

  try {
    const projection = await pawEngine.memoryEmbeddingProjection(2000);

    if (projection.points.length === 0) {
      container.innerHTML = `
        <div class="atlas-empty">
          <span class="ms" style="font-size:48px;color:var(--text-muted)">scatter_plot</span>
          <div class="atlas-empty-title">No memories yet</div>
          <div class="atlas-empty-subtitle">
            Memories will appear here as your agents learn
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    _initScene(
      container,
      projection.points,
      projection.clusters,
      projection.edges || [],
      projection.has_embeddings,
    );
  } catch (e) {
    console.warn('[atlas] Failed to load embeddings:', e);
    container.innerHTML = `
      <div class="atlas-empty">
        <span class="ms" style="font-size:48px;color:var(--text-muted)">error</span>
        <div class="atlas-empty-title">Failed to load embeddings</div>
        <div class="atlas-empty-subtitle">${String(e)}</div>
      </div>
    `;
  }
}

export function toggleAtlasDimension(): void {
  if (!_state) return;
  _state.is3D = !_state.is3D;
  _updateCamera();
}

export function setAtlasColorMode(mode: 'category' | 'importance' | 'distance'): void {
  if (!_state) return;
  _state.colorMode = mode;
  _updateColors();
}

export function atlasSearchQuery(query: string): void {
  if (!_state) return;
  // Find the query point as centroid of matching points
  const q = query.toLowerCase();
  const matching = _state.points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.content.toLowerCase().includes(q));

  if (matching.length === 0) {
    _state.queryPoint = null;
  } else {
    const cx = matching.reduce((s, { p }) => s + p.x, 0) / matching.length;
    const cy = matching.reduce((s, { p }) => s + p.y, 0) / matching.length;
    const cz = matching.reduce((s, { p }) => s + p.z, 0) / matching.length;
    _state.queryPoint = new THREE.Vector3(
      cx * SPREAD_FACTOR,
      cy * SPREAD_FACTOR,
      cz * SPREAD_FACTOR,
    );
  }
  _state.colorMode = 'distance';
  _updateColors();
}

// ── Scene setup ────────────────────────────────────────────────────────

function _initScene(
  container: HTMLElement,
  points: ProjectedPoint[],
  clusters: EmbeddingCluster[],
  edges: ProjectedEdge[],
  hasEmbeddings = true,
): void {
  const rect = container.getBoundingClientRect();
  const w = rect.width || 800;
  const h = rect.height || 600;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  // Camera (perspective for 3D, will switch for 2D)
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
  camera.position.set(6, 4, 6);
  camera.lookAt(0, 0, 0);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 1.2;
  controls.minDistance = 1;
  controls.maxDistance = 30;

  // Tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'atlas-tooltip';
  container.appendChild(tooltip);

  // Selection panel
  const selectionPanel = document.createElement('div');
  selectionPanel.className = 'atlas-selection-panel';
  container.appendChild(selectionPanel);

  _state = {
    scene,
    camera,
    renderer,
    controls,
    points,
    clusters,
    pointCloud: null,
    edgeLines: null,
    dbEdges: edges,
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(-999, -999),
    hoveredIndex: -1,
    selectedIndices: new Set(),
    is3D: true,
    colorMode: 'category',
    queryPoint: null,
    animId: 0,
    container,
    tooltip,
    selectionPanel,
    disposed: false,
  };
  _state.raycaster.params.Points = { threshold: 0.08 };

  // Build visuals
  _buildGrid(scene);
  _buildPointCloud(scene, points);
  _buildEdges(scene, points, edges);
  _buildClusterSidebar(container, clusters);
  _buildToolbar(container, hasEmbeddings);

  // Events
  renderer.domElement.addEventListener('mousemove', _onMouseMove);
  renderer.domElement.addEventListener('click', _onClick);
  window.addEventListener('resize', _onResize);

  // Animate
  _animate();
}

// ── Grid ───────────────────────────────────────────────────────────────

function _buildGrid(scene: THREE.Scene): void {
  const grid = new THREE.GridHelper(12, 24, GRID_COLOR, GRID_COLOR);
  grid.material.opacity = 0.3;
  grid.material.transparent = true;
  scene.add(grid);

  // Subtle ambient light
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
}

// ── Point Cloud ────────────────────────────────────────────────────────

function _buildPointCloud(scene: THREE.Scene, points: ProjectedPoint[]): void {
  if (!_state) return;

  const n = points.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const p = points[i];
    positions[i * 3] = p.x * SPREAD_FACTOR;
    positions[i * 3 + 1] = p.y * SPREAD_FACTOR;
    positions[i * 3 + 2] = p.z * SPREAD_FACTOR;

    const color = _getCategoryColorThree(p.category);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = POINT_SIZE_BASE + p.importance * 0.02;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * 300.0 * uPixelRatio / (-mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 2.0, 40.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        // Soft glow falloff
        float alpha = 1.0 - smoothstep(0.0, 0.5, d);
        // Core bright, edge glow
        float core = 1.0 - smoothstep(0.0, 0.25, d);
        vec3 color = mix(vColor * 0.7, vColor, core);
        gl_FragColor = vec4(color, alpha * 0.9);
      }
    `,
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const cloud = new THREE.Points(geometry, material);
  scene.add(cloud);
  _state.pointCloud = cloud;
}

// ── Edges (DB + k-NN proximity) ────────────────────────────────────────

function _buildEdges(scene: THREE.Scene, points: ProjectedPoint[], dbEdges: ProjectedEdge[]): void {
  if (!_state || points.length < 2) return;

  // Build position lookup by ID
  const idxMap = new Map<string, number>();
  points.forEach((p, i) => idxMap.set(p.id, i));

  // Collect all edge pairs: (sourceIdx, targetIdx, weight, type)
  const edgePairs: { a: number; b: number; w: number; kind: 'db' | 'proximity' }[] = [];
  const edgeKeys = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  // 1. DB edges from the graph
  for (const e of dbEdges) {
    const ai = idxMap.get(e.source);
    const bi = idxMap.get(e.target);
    if (ai !== undefined && bi !== undefined && ai !== bi) {
      const key = edgeKey(ai, bi);
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edgePairs.push({ a: ai, b: bi, w: e.weight, kind: 'db' });
      }
    }
  }

  // 2. Infer proximity edges (k-nearest neighbors) for visual connectivity
  // Connect each point to its 2-3 nearest neighbors in the projected space
  const K = Math.min(3, points.length - 1);
  const maxProximityEdges = Math.min(points.length * 2, 200);
  let proximityCount = 0;

  for (let i = 0; i < points.length && proximityCount < maxProximityEdges; i++) {
    const pi = points[i];
    const px = pi.x * SPREAD_FACTOR;
    const py = pi.y * SPREAD_FACTOR;
    const pz = pi.z * SPREAD_FACTOR;

    // Find K nearest
    const dists: { idx: number; dist: number }[] = [];
    for (let j = 0; j < points.length; j++) {
      if (j === i) continue;
      const pj = points[j];
      const dx = pj.x * SPREAD_FACTOR - px;
      const dy = pj.y * SPREAD_FACTOR - py;
      const dz = pj.z * SPREAD_FACTOR - pz;
      dists.push({ idx: j, dist: Math.sqrt(dx * dx + dy * dy + dz * dz) });
    }
    dists.sort((a, b) => a.dist - b.dist);

    for (let k = 0; k < K && k < dists.length; k++) {
      const neighbor = dists[k];
      // Only connect if close enough (distance threshold)
      if (neighbor.dist > SPREAD_FACTOR * 1.2) break;

      const key = edgeKey(i, neighbor.idx);
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        // Weight inversely proportional to distance
        const w = Math.max(0.1, 1.0 - neighbor.dist / (SPREAD_FACTOR * 1.2));
        edgePairs.push({ a: i, b: neighbor.idx, w, kind: 'proximity' });
        proximityCount++;
      }
    }
  }

  if (edgePairs.length === 0) return;

  // Build line geometry
  const linePositions = new Float32Array(edgePairs.length * 6); // 2 vertices * 3 coords
  const lineColors = new Float32Array(edgePairs.length * 6);

  for (let i = 0; i < edgePairs.length; i++) {
    const { a, b, w, kind } = edgePairs[i];
    const pa = points[a];
    const pb = points[b];

    // Positions
    linePositions[i * 6] = pa.x * SPREAD_FACTOR;
    linePositions[i * 6 + 1] = pa.y * SPREAD_FACTOR;
    linePositions[i * 6 + 2] = pa.z * SPREAD_FACTOR;
    linePositions[i * 6 + 3] = pb.x * SPREAD_FACTOR;
    linePositions[i * 6 + 4] = pb.y * SPREAD_FACTOR;
    linePositions[i * 6 + 5] = pb.z * SPREAD_FACTOR;

    // Colors — DB edges use category color, proximity edges are subtle grey
    let r: number, g: number, b2: number;
    if (kind === 'db') {
      const catColor = _getCategoryColorThree(pa.category);
      r = catColor.r;
      g = catColor.g;
      b2 = catColor.b;
    } else {
      // Subtle blue-grey for proximity edges
      r = 0.15;
      g = 0.18;
      b2 = 0.25;
    }

    const alpha = kind === 'db' ? 0.3 + w * 0.4 : 0.08 + w * 0.12;
    lineColors[i * 6] = r * alpha;
    lineColors[i * 6 + 1] = g * alpha;
    lineColors[i * 6 + 2] = b2 * alpha;
    lineColors[i * 6 + 3] = r * alpha;
    lineColors[i * 6 + 4] = g * alpha;
    lineColors[i * 6 + 5] = b2 * alpha;
  }

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    linewidth: 1,
  });

  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  scene.add(lines);
  _state.edgeLines = lines;

  console.debug(
    `[atlas] ${edgePairs.length} edges (${dbEdges.length} DB, ${proximityCount} proximity)`,
  );
}

// ── Toolbar ────────────────────────────────────────────────────────────

function _buildToolbar(container: HTMLElement, hasEmbeddings = true): void {
  const toolbar = document.createElement('div');
  toolbar.className = 'atlas-toolbar';
  const modeBadge = hasEmbeddings
    ? '<span class="atlas-mode-badge atlas-mode-real">PCA</span>'
    : '<span class="atlas-mode-badge atlas-mode-synth">Synthetic</span>';
  toolbar.innerHTML = `
    <div class="atlas-toolbar-group">
      <button class="atlas-btn atlas-btn-active" data-atlas-dim="3d" title="3D View">
        <span class="ms ms-sm">3d_rotation</span>
      </button>
      <button class="atlas-btn" data-atlas-dim="2d" title="2D View">
        <span class="ms ms-sm">view_in_ar</span>
      </button>
    </div>
    <div class="atlas-toolbar-sep"></div>
    <div class="atlas-toolbar-group">
      <button class="atlas-btn atlas-btn-active" data-atlas-color="category" title="Color by Category">
        <span class="ms ms-sm">palette</span>
      </button>
      <button class="atlas-btn" data-atlas-color="importance" title="Color by Importance">
        <span class="ms ms-sm">priority_high</span>
      </button>
      <button class="atlas-btn" data-atlas-color="distance" title="Color by Query Distance">
        <span class="ms ms-sm">radar</span>
      </button>
    </div>
    <div class="atlas-toolbar-sep"></div>
    <div class="atlas-toolbar-group atlas-search-wrap">
      <input class="atlas-search-input" type="text" placeholder="Search embeddings\u2026" />
    </div>
    <div class="atlas-toolbar-right">
      ${modeBadge}
      <span class="atlas-point-count">${_state?.points.length || 0} points \u00B7 ${_state?.dbEdges.length || 0} links</span>
    </div>
  `;
  container.appendChild(toolbar);

  // Dimension toggle
  toolbar.querySelectorAll('[data-atlas-dim]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toolbar
        .querySelectorAll('[data-atlas-dim]')
        .forEach((b) => b.classList.remove('atlas-btn-active'));
      btn.classList.add('atlas-btn-active');
      const dim = (btn as HTMLElement).dataset.atlasDim;
      if (_state) {
        _state.is3D = dim === '3d';
        _updateCamera();
      }
    });
  });

  // Color mode toggle
  toolbar.querySelectorAll('[data-atlas-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toolbar
        .querySelectorAll('[data-atlas-color]')
        .forEach((b) => b.classList.remove('atlas-btn-active'));
      btn.classList.add('atlas-btn-active');
      const mode = (btn as HTMLElement).dataset.atlasColor as
        | 'category'
        | 'importance'
        | 'distance';
      setAtlasColorMode(mode);
    });
  });

  // Search
  const searchInput = toolbar.querySelector('.atlas-search-input') as HTMLInputElement;
  let searchTimeout = 0;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(() => {
      const q = searchInput.value.trim();
      if (q.length >= 2) {
        atlasSearchQuery(q);
      } else if (q.length === 0 && _state) {
        _state.queryPoint = null;
        _state.colorMode = 'category';
        _updateColors();
        // Reset color buttons
        toolbar
          .querySelectorAll('[data-atlas-color]')
          .forEach((b) => b.classList.remove('atlas-btn-active'));
        toolbar.querySelector('[data-atlas-color="category"]')?.classList.add('atlas-btn-active');
      }
    }, 300);
  });
}

// ── Cluster Sidebar ────────────────────────────────────────────────────

function _buildClusterSidebar(container: HTMLElement, clusters: EmbeddingCluster[]): void {
  if (clusters.length === 0) return;

  const sidebar = document.createElement('div');
  sidebar.className = 'atlas-cluster-sidebar';

  const header = document.createElement('div');
  header.className = 'atlas-cluster-header';
  header.innerHTML = `
    <span class="atlas-cluster-title">Clusters</span>
    <span class="atlas-cluster-badge">${clusters.length}</span>
  `;
  sidebar.appendChild(header);

  const list = document.createElement('div');
  list.className = 'atlas-cluster-list';

  for (const cluster of clusters.slice(0, 20)) {
    const item = document.createElement('div');
    item.className = 'atlas-cluster-item';
    const color = getCategoryColor(cluster.id);
    item.innerHTML = `
      <span class="atlas-cluster-dot" style="background:${color}"></span>
      <span class="atlas-cluster-name">${_escHtml(cluster.id)}</span>
      <span class="atlas-cluster-count">${cluster.count}</span>
    `;
    item.addEventListener('click', () => {
      _highlightCluster(cluster.id);
      // Toggle active state
      sidebar.querySelectorAll('.atlas-cluster-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
    });
    list.appendChild(item);
  }
  sidebar.appendChild(list);
  container.appendChild(sidebar);
}

function _highlightCluster(clusterId: string): void {
  if (!_state || !_state.pointCloud) return;

  const colors = _state.pointCloud.geometry.attributes.color as THREE.BufferAttribute;
  const sizes = _state.pointCloud.geometry.attributes.size as THREE.BufferAttribute;

  for (let i = 0; i < _state.points.length; i++) {
    const p = _state.points[i];
    const isMatch = p.category === clusterId;

    if (isMatch) {
      const c = _getCategoryColorThree(p.category);
      colors.setXYZ(i, c.r, c.g, c.b);
      sizes.setX(i, POINT_SIZE_BASE + p.importance * 0.02 + 0.01);
    } else {
      colors.setXYZ(i, 0.15, 0.15, 0.15);
      sizes.setX(i, POINT_SIZE_BASE * 0.6);
    }
  }

  colors.needsUpdate = true;
  sizes.needsUpdate = true;
}

// ── Color updating ─────────────────────────────────────────────────────

function _updateColors(): void {
  if (!_state || !_state.pointCloud) return;

  const colors = _state.pointCloud.geometry.attributes.color as THREE.BufferAttribute;
  const sizes = _state.pointCloud.geometry.attributes.size as THREE.BufferAttribute;

  for (let i = 0; i < _state.points.length; i++) {
    const p = _state.points[i];
    let color: THREE.Color;
    let size = POINT_SIZE_BASE + p.importance * 0.02;

    switch (_state.colorMode) {
      case 'category':
        color = _getCategoryColorThree(p.category);
        break;
      case 'importance':
        color = _importanceColor(p.importance);
        break;
      case 'distance': {
        if (_state.queryPoint) {
          const pos = new THREE.Vector3(
            p.x * SPREAD_FACTOR,
            p.y * SPREAD_FACTOR,
            p.z * SPREAD_FACTOR,
          );
          const dist = pos.distanceTo(_state.queryPoint);
          const maxDist = SPREAD_FACTOR * 2;
          const t = Math.min(dist / maxDist, 1);
          color = _distanceColor(1 - t);
          size = POINT_SIZE_BASE + (1 - t) * 0.04;
        } else {
          color = _getCategoryColorThree(p.category);
        }
        break;
      }
    }

    colors.setXYZ(i, color.r, color.g, color.b);
    sizes.setX(i, size);
  }

  colors.needsUpdate = true;
  sizes.needsUpdate = true;
}

// ── Camera mode ────────────────────────────────────────────────────────

function _updateCamera(): void {
  if (!_state) return;

  if (!_state.is3D) {
    // Switch to top-down 2D view
    _state.camera.position.set(0, 10, 0);
    _state.camera.lookAt(0, 0, 0);
    _state.controls.enableRotate = false;
    _state.controls.update();

    // Flatten Y axis on all points
    if (_state.pointCloud) {
      const positions = _state.pointCloud.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < _state.points.length; i++) {
        positions.setY(i, 0);
      }
      positions.needsUpdate = true;
    }
    // Flatten edge lines too
    if (_state.edgeLines) {
      const pos = _state.edgeLines.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, 0);
      }
      pos.needsUpdate = true;
    }
  } else {
    // Restore 3D
    _state.camera.position.set(6, 4, 6);
    _state.camera.lookAt(0, 0, 0);
    _state.controls.enableRotate = true;
    _state.controls.update();

    // Restore Y positions
    if (_state.pointCloud) {
      const positions = _state.pointCloud.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < _state.points.length; i++) {
        positions.setY(i, _state.points[i].y * SPREAD_FACTOR);
      }
      positions.needsUpdate = true;
    }
    // Restore edge Y positions — rebuild edges is easier than tracking
    if (_state.edgeLines) {
      _state.scene.remove(_state.edgeLines);
      _state.edgeLines.geometry.dispose();
      _buildEdges(_state.scene, _state.points, _state.dbEdges);
    }
  }
}

// ── Animation loop ─────────────────────────────────────────────────────

function _animate(): void {
  if (!_state || _state.disposed) return;

  _state.controls.update();
  _raycast();
  _state.renderer.render(_state.scene, _state.camera);
  _state.animId = requestAnimationFrame(_animate);
}

// ── Raycasting ─────────────────────────────────────────────────────────

function _raycast(): void {
  if (!_state || !_state.pointCloud) return;

  _state.raycaster.setFromCamera(_state.mouse, _state.camera);
  const intersects = _state.raycaster.intersectObject(_state.pointCloud);

  const sizes = _state.pointCloud.geometry.attributes.size as THREE.BufferAttribute;

  // Reset previous hover
  if (_state.hoveredIndex >= 0) {
    const prev = _state.points[_state.hoveredIndex];
    sizes.setX(_state.hoveredIndex, POINT_SIZE_BASE + prev.importance * 0.02);
    sizes.needsUpdate = true;
  }

  if (intersects.length > 0 && intersects[0].index !== undefined) {
    const idx = intersects[0].index;
    _state.hoveredIndex = idx;
    sizes.setX(idx, POINT_SIZE_HOVER);
    sizes.needsUpdate = true;
    _showTooltip(idx);
  } else {
    _state.hoveredIndex = -1;
    if (_state.tooltip) _state.tooltip.style.display = 'none';
  }
}

// ── Tooltip ────────────────────────────────────────────────────────────

function _showTooltip(idx: number): void {
  if (!_state || !_state.tooltip || !_state.container) return;

  const p = _state.points[idx];
  const color = getCategoryColor(p.category);
  const content = p.content.length > 120 ? `${p.content.slice(0, 117)}\u2026` : p.content;
  const date = p.created_at ? new Date(p.created_at).toLocaleDateString() : '';

  _state.tooltip.innerHTML = `
    <div class="atlas-tooltip-header">
      <span class="atlas-tooltip-dot" style="background:${color}"></span>
      <span class="atlas-tooltip-category">${_escHtml(p.category)}</span>
      ${date ? `<span class="atlas-tooltip-date">${date}</span>` : ''}
    </div>
    <div class="atlas-tooltip-content">${_escHtml(content)}</div>
    <div class="atlas-tooltip-footer">
      <span>importance: ${(p.importance * 10).toFixed(0)}/10</span>
    </div>
  `;
  _state.tooltip.style.display = 'block';

  // Position near cursor
  const rect = _state.container.getBoundingClientRect();
  const pos = _state.renderer.domElement.getBoundingClientRect();
  const mx = (_state.mouse.x * 0.5 + 0.5) * pos.width + pos.left - rect.left;
  const my = (-_state.mouse.y * 0.5 + 0.5) * pos.height + pos.top - rect.top;

  const tw = _state.tooltip.offsetWidth;
  const th = _state.tooltip.offsetHeight;
  const tx = mx + 20 + tw > rect.width ? mx - tw - 10 : mx + 20;
  const ty = my + 10 + th > rect.height ? my - th - 10 : my + 10;

  _state.tooltip.style.left = `${tx}px`;
  _state.tooltip.style.top = `${ty}px`;
}

// ── Selection ──────────────────────────────────────────────────────────

function _onClick(): void {
  if (!_state || _state.hoveredIndex < 0) return;

  const idx = _state.hoveredIndex;
  if (_state.selectedIndices.has(idx)) {
    _state.selectedIndices.delete(idx);
  } else {
    _state.selectedIndices.add(idx);
  }
  _updateSelectionPanel();
}

function _updateSelectionPanel(): void {
  if (!_state || !_state.selectionPanel) return;

  if (_state.selectedIndices.size === 0) {
    _state.selectionPanel.style.display = 'none';
    return;
  }

  const selected = Array.from(_state.selectedIndices).map((i) => _state!.points[i]);
  _state.selectionPanel.style.display = 'flex';
  _state.selectionPanel.innerHTML = `
    <div class="atlas-selection-header">
      <span class="atlas-selection-title">Selection</span>
      <span class="atlas-selection-badge">${selected.length} point${selected.length > 1 ? 's' : ''} selected</span>
      <button class="atlas-selection-close" title="Clear selection">&times;</button>
    </div>
    <div class="atlas-selection-cards">
      ${selected
        .map((p) => {
          const color = getCategoryColor(p.category);
          const snippet = p.content.length > 100 ? `${p.content.slice(0, 97)}\u2026` : p.content;
          return `
            <div class="atlas-selection-card">
              <div class="atlas-selection-card-accent" style="background:${color}"></div>
              <div class="atlas-selection-card-body">
                <div class="atlas-selection-card-cat" style="color:${color}">${_escHtml(p.category)}</div>
                <div class="atlas-selection-card-text">${_escHtml(snippet)}</div>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;

  _state.selectionPanel.querySelector('.atlas-selection-close')?.addEventListener('click', () => {
    if (_state) {
      _state.selectedIndices.clear();
      _updateSelectionPanel();
    }
  });
}

// ── Events ─────────────────────────────────────────────────────────────

function _onMouseMove(e: MouseEvent): void {
  if (!_state) return;
  const rect = _state.renderer.domElement.getBoundingClientRect();
  _state.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _state.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function _onResize(): void {
  if (!_state || !_state.container) return;
  const rect = _state.container.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  if (_state.camera instanceof THREE.PerspectiveCamera) {
    _state.camera.aspect = w / h;
    _state.camera.updateProjectionMatrix();
  }
  _state.renderer.setSize(w, h);
}

// ── Color helpers ──────────────────────────────────────────────────────

function _getCategoryColorThree(category: string): THREE.Color {
  const hex = getCategoryColor(category);
  return new THREE.Color(hex);
}

function _importanceColor(importance: number): THREE.Color {
  // Cool (blue) → Warm (orange/red) gradient based on importance
  const t = Math.max(0, Math.min(1, importance));
  const r = 0.1 + t * 0.75;
  const g = 0.2 + t * 0.3 - t * t * 0.3;
  const b = 0.6 - t * 0.5;
  return new THREE.Color(r, g, b);
}

function _distanceColor(proximity: number): THREE.Color {
  // proximity: 1 = very close to query (hot), 0 = far (cold)
  const t = Math.max(0, Math.min(1, proximity));
  if (t > 0.5) {
    // Hot: yellow → cyan
    const s = (t - 0.5) * 2;
    return new THREE.Color(0.1 + s * 0.9, 0.9, 0.3);
  } else {
    // Cold: dark blue → medium
    const s = t * 2;
    return new THREE.Color(0.05, 0.05 + s * 0.3, 0.2 + s * 0.3);
  }
}

function _escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
