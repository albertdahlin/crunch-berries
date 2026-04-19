// @ts-check
/** @typedef {import('./types.js').Renderer}    Renderer */
/** @typedef {import('./types.js').MapRuntime}  MapRuntime */
/** @typedef {import('./types.js').GameState}   GameState */
/** @typedef {import('./types.js').Campaign}    Campaign */
/** @typedef {import('./types.js').Cursor}      Cursor */
/** @typedef {import('./types.js').EditorOverlay} EditorOverlay */

// @ts-ignore -- 'three' is resolved at runtime via importmap, not bundled.
import * as THREE from 'three';
import { GROUND_TYPES, DX, DY } from './constants.js';
import { getTowerNode, getTowerSize } from './campaigns.js';
import { createCameraControl } from './camera-control.js';

/**
 * Three.js isometric renderer. Implements the same `Renderer` interface as
 * `render-canvas.js`, so game.js / edit-map.js / home.js don't know which
 * renderer is live.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Renderer}
 */
export function createWebGLRenderer(canvas) {
  // Throw early so main.js can fall back to canvas cleanly.
  if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
    throw new Error('WebGL not supported');
  }

  const three = new THREE.WebGLRenderer({ canvas, antialias: true });
  three.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  three.toneMapping = THREE.ACESFilmicToneMapping;
  three.toneMappingExposure = 1.35;
  three.shadowMap.enabled = true;
  three.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const FOG_COLOR = '#161628';
  scene.background = new THREE.Color(FOG_COLOR);
  // Subtle exp² fog to hint depth and soften the scene's far edges.
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.008);

  // True isometric: camera offset direction (1,1,1)/√3 gives yaw = 45° and
  // elevation = arcsin(1/√3) ≈ 35.264°. Orthographic projection is what makes
  // the result look "flat"; distance is arbitrary (just far enough to clear
  // near-plane clipping).
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  camera.up.set(0, 1, 0);
  const cameraOffset = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(60);

  // Lighting: bright ambient so mid-tones read; hemisphere for soft fill;
  // directional for shape definition + shadow casting.
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x3a2a1a, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.copy(cameraOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left   = -30;
  sun.shadow.camera.right  =  30;
  sun.shadow.camera.top    =  30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near   =  1;
  sun.shadow.camera.far    =  160;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  // A tracked target lets the shadow frustum follow camera panning without
  // moving the sun's world direction (shadows stay at the same angle).
  const sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sun.target = sunTarget;

  const tileRoot   = new THREE.Group(); scene.add(tileRoot);
  const entityRoot = new THREE.Group(); scene.add(entityRoot);

  /** @type {THREE.InstancedMesh[]} one per distinct ground type present in the map */
  const tileMeshes = [];
  const mapCache = { cols: 0, rows: 0, /** @type {?Uint8Array} */ ground: null };

  // --- Caches ---
  /** @type {Map<string, THREE.MeshLambertMaterial>} */
  const lambertCache = new Map();
  function lambertMat(color) {
    const key = String(color);
    let m = lambertCache.get(key);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: new THREE.Color(key) }); lambertCache.set(key, m); }
    return m;
  }
  // The ground-tile palette is tuned for a dark 2D canvas at tiny pixel sizes.
  // Lit 3D tiles go nearly black with those hex values, so bias each tile's
  // colour upward in HSL before handing it to Lambert shading. Entities use
  // the campaign palette directly — already bright enough.
  /** @type {Map<string, THREE.Color>} */
  const brightTileCache = new Map();
  function brightTileColor(hex) {
    let c = brightTileCache.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      hsl.l = Math.min(0.55, hsl.l * 2.4 + 0.15);
      hsl.s = Math.min(1, hsl.s * 1.1);
      c.setHSL(hsl.h, hsl.s, hsl.l);
      brightTileCache.set(hex, c);
    }
    return c;
  }
  /** @type {Map<string, THREE.MeshBasicMaterial>} */
  const basicCache = new Map();
  function basicMat(color, opts = {}) {
    const key = String(color) + '|' + JSON.stringify(opts);
    let m = basicCache.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), ...opts }); basicCache.set(key, m); }
    return m;
  }
  /** @type {Map<string, THREE.LineBasicMaterial>} */
  const lineCache = new Map();
  function lineMat(color, opts = {}) {
    const key = String(color) + '|' + JSON.stringify(opts);
    let m = lineCache.get(key);
    if (!m) { m = new THREE.LineBasicMaterial({ color: new THREE.Color(color), ...opts }); lineCache.set(key, m); }
    return m;
  }

  // Shared geometries — never disposed. Per-frame mesh geometries (edges, lines)
  // are cleaned up when the mesh leaves the scene.
  const boxGeom         = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeom    = new THREE.CylinderGeometry(0.28, 0.28, 0.6, 12);
  const headGeom        = new THREE.SphereGeometry(0.22, 12, 8);
  const coneGeom        = new THREE.ConeGeometry(0.35, 0.7, 8);
  const sphereGeom      = new THREE.SphereGeometry(1, 12, 8);
  const circleLineGeom  = makeCircleLineGeom(1, 48);
  const boxEdgesGeom    = new THREE.EdgesGeometry(boxGeom);

  const SHARED_GEOM = new WeakSet();
  [boxGeom, cylinderGeom, headGeom, coneGeom, sphereGeom, circleLineGeom, boxEdgesGeom]
    .forEach(g => SHARED_GEOM.add(g));

  // Edges for shared geometries, built lazily and cached. Threshold=30° hides
  // smooth sphere/cylinder radial edges while keeping silhouette / sharp
  // angles visible.
  const OUTLINE_COLOR = '#0a0a14';
  /** @type {WeakMap<any, any>} */
  const edgesCache = new WeakMap();
  function getEdges(geom) {
    let eg = edgesCache.get(geom);
    if (!eg) {
      eg = new THREE.EdgesGeometry(geom, 30);
      edgesCache.set(geom, eg);
      SHARED_GEOM.add(eg);  // never dispose — shared across frames
    }
    return eg;
  }
  /**
   * Make a mesh and parent a matching edge-outline to it. Outline scales /
   * rotates with the parent, giving a consistent "deliberate low-poly" look.
   */
  function outlinedMesh(geom, material) {
    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const outline = new THREE.LineSegments(getEdges(geom), lineMat(OUTLINE_COLOR));
    mesh.add(outline);
    return mesh;
  }

  function makeCircleLineGeom(radius, segments) {
    const g = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      pts.push(Math.cos(t) * radius, 0, Math.sin(t) * radius);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }

  // --- Camera & input ---
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();

  const cameraControl = createCameraControl({
    domElement: canvas,
    onChange: () => { updateCamera(); resize(); },
  });

  function updateCamera() {
    const t = cameraControl.target;
    camera.position.set(t.x + cameraOffset.x, cameraOffset.y, t.z + cameraOffset.z);
    camera.lookAt(t.x, 0, t.z);
    camera.updateMatrixWorld();
    // Keep sun offset constant relative to the camera target so shadows stay
    // aligned while the player pans.
    sun.position.set(t.x + cameraOffset.x, cameraOffset.y, t.z + cameraOffset.z);
    sunTarget.position.set(t.x, 0, t.z);
    sunTarget.updateMatrixWorld();
    sun.shadow.camera.updateProjectionMatrix();
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    three.setSize(w, h, false);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const aspect = w / h;
    const viewHalf = Math.max(8, Math.max(mapCache.cols, mapCache.rows) * 0.55);
    const z = cameraControl.zoom;
    camera.left   = -viewHalf * aspect / z;
    camera.right  =  viewHalf * aspect / z;
    camera.top    =  viewHalf / z;
    camera.bottom = -viewHalf / z;
    camera.near = 0.1;
    camera.far = 1000;
    camera.updateProjectionMatrix();
    // pixels-per-world-unit for the camera control's drag math.
    cameraControl.setPixelsPerUnit((h / (viewHalf * 2)) * z);
    updateCamera();
  }

  function setGridSize(cols, rows) {
    const isFirst = mapCache.cols === 0 && mapCache.rows === 0;
    mapCache.cols = cols;
    mapCache.rows = rows;
    cameraControl.setMapBounds(cols, rows);
    if (isFirst) cameraControl.centerOnMap();
    resize();
  }

  // --- Procedural tile textures ---
  // One small canvas-generated texture per ground type. The base colour is
  // pre-baked into the texture (via brightTileColor), so tile materials no
  // longer need per-instance colouring.
  /** @type {Map<number, THREE.MeshLambertMaterial>} */
  const tileMatCache = new Map();
  function getTileMaterial(typeId) {
    let m = tileMatCache.get(typeId);
    if (!m) {
      const gt = GROUND_TYPES[typeId] || GROUND_TYPES[0];
      const tex = makeTileTexture(gt);
      m = new THREE.MeshLambertMaterial({ map: tex });
      tileMatCache.set(typeId, m);
    }
    return m;
  }

  function makeTileTexture(gt) {
    const size = 64;
    const canvas2d = document.createElement('canvas');
    canvas2d.width = canvas2d.height = size;
    const ctx = canvas2d.getContext('2d');
    const base = brightTileColor(gt.bg);
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, size, size);
    // Per-type overlay pattern.
    switch (gt.name) {
      case 'Grass':    drawGrass(ctx, size, base); break;
      case 'Road':     drawRoad(ctx, size, base); break;
      case 'Water':    drawWater(ctx, size, base); break;
      case 'Swamp':    drawSwamp(ctx, size, base); break;
      case 'Forest':   drawForest(ctx, size, base); break;
      case 'Mountain': drawMountain(ctx, size, base); break;
    }
    const tex = new THREE.CanvasTexture(canvas2d);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = three.capabilities.getMaxAnisotropy();
    return tex;
  }

  function rebuildTileMesh(map) {
    // Dispose old meshes + their materials (texture stays cached in tileMatCache).
    for (const m of tileMeshes) {
      tileRoot.remove(m);
      m.dispose();
    }
    tileMeshes.length = 0;

    // Count tiles per ground type so each InstancedMesh gets a tight size.
    /** @type {Map<number, number>} */
    const countByType = new Map();
    for (let i = 0; i < map.cols * map.rows; i++) {
      const t = map.ground[i];
      countByType.set(t, (countByType.get(t) || 0) + 1);
    }

    /** @type {Map<number, THREE.InstancedMesh>} */
    const meshByType = new Map();
    for (const [typeId, count] of countByType) {
      const mesh = new THREE.InstancedMesh(boxGeom, getTileMaterial(typeId), count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;  // we'll fill in via setMatrixAt and bump count per write
      meshByType.set(typeId, mesh);
      tileMeshes.push(mesh);
      tileRoot.add(mesh);
    }

    const _matrix = new THREE.Matrix4();
    const _pos    = new THREE.Vector3();
    const _quat   = new THREE.Quaternion();
    const _scl    = new THREE.Vector3();
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const i = row * map.cols + col;
        const typeId = map.ground[i];
        const gt = GROUND_TYPES[typeId] || GROUND_TYPES[0];
        const hgt =
          gt.blocksSight       ? 1.5  :        // mountain
          gt.name === 'Water'  ? 0.08 :        // water sits low
          gt.name === 'Forest' ? 0.35 :        // forest slightly raised
                                 0.2;          // grass / road / swamp
        _pos.set(col + 0.5, hgt / 2, row + 0.5);
        _scl.set(0.98, hgt, 0.98);
        _matrix.compose(_pos, _quat, _scl);
        const mesh = meshByType.get(typeId);
        if (!mesh) continue;
        mesh.setMatrixAt(mesh.count, _matrix);
        mesh.count++;
      }
    }
    for (const m of tileMeshes) m.instanceMatrix.needsUpdate = true;
  }

  function clearEntities() {
    entityRoot.traverse((obj) => {
      const geom = /** @type {any} */ (obj).geometry;
      if (geom && !SHARED_GEOM.has(geom)) geom.dispose();
    });
    entityRoot.clear();
  }

  // --- Entity builders (stateless per-frame) ---

  function towerGroup(t, state, campaign) {
    const node = getTowerNode(campaign, t);
    const size = getTowerSize(campaign, t.typeIdx, t.rotation);
    const g = new THREE.Group();
    g.position.set(t.x + size.w / 2, 0, t.y + size.h / 2);

    const base = outlinedMesh(boxGeom, lambertMat(node.bg || '#444'));
    base.scale.set(size.w * 0.9, 0.4, size.h * 0.9);
    base.position.y = 0.2;
    g.add(base);

    const top = outlinedMesh(coneGeom, lambertMat(node.color || '#fff'));
    top.position.y = 0.4 + 0.35;
    g.add(top);

    if (t.hp < t.maxHp) {
      const ratio = Math.max(0, Math.min(1, t.hp / t.maxHp));
      const barY = 0.4 + 0.7 + 0.25;
      const bg = new THREE.Mesh(boxGeom, basicMat('#333333'));
      bg.scale.set(size.w * 0.8, 0.04, 0.06);
      bg.position.set(0, barY, 0);
      g.add(bg);
      const col = ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#ff9800' : '#f44336';
      const fg = new THREE.Mesh(boxGeom, basicMat(col));
      fg.scale.set(size.w * 0.8 * ratio, 0.045, 0.065);
      fg.position.set(-size.w * 0.8 * (1 - ratio) / 2, barY, 0);
      g.add(fg);
    }

    if (node.attackDir === 'fixed') {
      // rotation: 0=up(-Z), 1=right(+X), 2=down(+Z), 3=left(-X).
      // Build a clearly-visible arrow hovering above the tower: a thin bar
      // sticking out from centre in the firing direction, capped with a
      // cone tip that points the same way. This is unambiguous from iso
      // view even on pierce towers where the firing line matters.
      const rot = t.rotation % 4;
      const dx = [0, 1, 0, -1][rot];
      const dz = [-1, 0, 1, 0][rot];
      const barLen = Math.min(size.w, size.h) * 0.3;
      const barY = 0.5;
      const mat = lambertMat(node.color || '#fff');

      const bar = outlinedMesh(boxGeom, mat);
      bar.scale.set(
        dx !== 0 ? barLen : 0.1,
        0.08,
        dz !== 0 ? barLen : 0.1,
      );
      bar.position.set(dx * barLen / 2, barY, dz * barLen / 2);
      g.add(bar);

      const tip = outlinedMesh(coneGeom, mat);
      tip.scale.set(0.55, 0.55, 0.55);
      tip.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(dx, 0, dz),
      );
      tip.position.set(dx * (barLen + 0.2), barY, dz * (barLen + 0.2));
      g.add(tip);
    }

    if (state.selectedPlacedTower === t) {
      const outline = new THREE.LineSegments(boxEdgesGeom, lineMat('#ffd700'));
      outline.scale.copy(base.scale).multiplyScalar(1.02);
      outline.position.copy(base.position);
      g.add(outline);

      const range = node.range || 0;
      if (range > 0) {
        const ring = new THREE.LineLoop(circleLineGeom, lineMat('#ffd700', { transparent: true, opacity: 0.7 }));
        const r = range + Math.min(size.w, size.h) / 2;
        ring.scale.set(r, 1, r);
        ring.position.y = 0.3;  // above all walkable tiles (0.2) + forest (0.25)
        g.add(ring);
      }
    }

    return g;
  }

  function monsterGroup(m) {
    const g = new THREE.Group();
    g.position.set(m.x, 0, m.y);
    const scale = m.renderScale || 1;

    const body = outlinedMesh(cylinderGeom, lambertMat(m.color));
    body.scale.set(scale, scale, scale);
    body.position.y = 0.3 * scale;
    g.add(body);

    const head = new THREE.Mesh(headGeom, lambertMat(m.color));
    head.castShadow = true;
    head.scale.set(scale, scale, scale);
    head.position.y = 0.65 * scale;
    g.add(head);

    if (m.hp < m.maxHp) {
      const ratio = Math.max(0, Math.min(1, m.hp / m.maxHp));
      const barY = 1.1 * scale;
      const bg = new THREE.Mesh(boxGeom, basicMat('#333333'));
      bg.scale.set(0.8, 0.03, 0.05);
      bg.position.set(0, barY, 0);
      g.add(bg);
      const fg = new THREE.Mesh(boxGeom, basicMat('#ef5350'));
      fg.scale.set(0.8 * ratio, 0.035, 0.055);
      fg.position.set(-0.8 * (1 - ratio) / 2, barY, 0);
      g.add(fg);
    }

    if (m.dot) {
      const ring = new THREE.Mesh(boxGeom, basicMat('#81c784', { transparent: true, opacity: 0.35 }));
      ring.scale.set(0.9, 0.02, 0.9);
      ring.position.y = 0.01;
      g.add(ring);
    }
    if (m.speedMod) {
      const col = m.speedMod.factor < 1 ? '#64b5f6' : '#ffeb3b';
      const ring = new THREE.Mesh(boxGeom, basicMat(col, { transparent: true, opacity: 0.3 }));
      ring.scale.set(1.0, 0.02, 1.0);
      ring.position.y = 0.005;
      g.add(ring);
    }

    return g;
  }

  function projectileMesh(p) {
    const mesh = new THREE.Mesh(sphereGeom, lambertMat(p.color));
    mesh.castShadow = true;
    mesh.scale.set(0.16, 0.16, 0.16);
    mesh.position.set(p.x, 0.7, p.y);
    return mesh;
  }

  function effectMesh(e) {
    if (e.type === 'circle') {
      // Splash ring: filled annulus so it's visible at WebGL's 1-pixel line cap.
      const r = e.radius || 1;
      const t = Math.max(0, Math.min(1, e.ttl / 8));
      const progress = Math.max(0.01, 1 - t);
      const outer = r * progress;
      const inner = Math.max(0.01, outer - Math.max(0.12, r * 0.18));
      const geom = new THREE.RingGeometry(inner, outer, 48);
      const mat = basicMat(e.color, { transparent: true, opacity: t, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(e.x, 0.4, e.y);
      return mesh;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([
      e.x, 0.5, e.y,
      e.tx || 0, 0.5, e.ty || 0,
    ], 3));
    return new THREE.Line(geom, lineMat(e.color, { transparent: true, opacity: Math.max(0, e.ttl / 4) }));
  }

  function cursorPreview(state, map, campaign) {
    const type = campaign.towers[state.selectedTower];
    if (!type) return null;
    const size = getTowerSize(campaign, state.selectedTower, state.placeRotation);
    const { x, y } = state.cursor;
    const placeable = canPlaceAt(x, y, state.selectedTower, state.placeRotation, campaign, map);

    const g = new THREE.Group();
    g.position.set(x + size.w / 2, 0, y + size.h / 2);

    const col = placeable ? '#ffffff' : '#ff5050';
    const outline = new THREE.LineSegments(boxEdgesGeom, lineMat(col, { transparent: true, opacity: 0.7 }));
    outline.scale.set(size.w, 1, size.h);
    outline.position.y = 0.5;
    g.add(outline);

    if (placeable && type.range) {
      if (type.pierce) {
        const dir = state.placeRotation * 2;
        const dx = DX[dir], dy = DY[dir];
        const ox = dx === 0 ? 0 : (dx > 0 ? size.w / 2 : -size.w / 2);
        const oz = dy === 0 ? 0 : (dy > 0 ? size.h / 2 : -size.h / 2);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute([
          ox, 0.5, oz,
          dx * type.range, 0.5, dy * type.range,
        ], 3));
        g.add(new THREE.Line(geom, lineMat(col, { transparent: true, opacity: 0.5 })));
      } else {
        const ring = new THREE.LineLoop(circleLineGeom, lineMat(col, { transparent: true, opacity: 0.45 }));
        const r = type.range + 1;
        ring.scale.set(r, 1, r);
        ring.position.y = 0.3;  // above walkable tiles + forest
        g.add(ring);
      }
    }

    return g;
  }

  function editorCursorGroup(cursor, overlay) {
    const sz = overlay.brushSize;
    const gt = GROUND_TYPES[overlay.brush];
    const g = new THREE.Group();
    g.position.set(cursor.x + sz / 2, 0, cursor.y + sz / 2);
    const mesh = new THREE.Mesh(boxGeom, basicMat(gt.bg, { transparent: true, opacity: 0.55 }));
    mesh.scale.set(sz, 0.4, sz);
    mesh.position.y = 0.2;
    g.add(mesh);
    const outline = new THREE.LineSegments(boxEdgesGeom, lineMat('#ffffff'));
    outline.scale.set(sz, 0.4, sz);
    outline.position.y = 0.2;
    g.add(outline);
    return g;
  }

  function canPlaceAt(tx, ty, typeIdx, rotation, campaign, map) {
    const size = getTowerSize(campaign, typeIdx, rotation);
    const { cols, rows, grid, ground } = map;
    if (tx < 0 || tx + size.w > cols || ty < 0 || ty + size.h > rows) return false;
    if (ty < 1 || ty + size.h > rows - 1) return false;
    for (let dy = 0; dy < size.h; dy++) {
      for (let dx = 0; dx < size.w; dx++) {
        const idx = (ty + dy) * cols + (tx + dx);
        if (grid[idx] !== 0) return false;
        if (!GROUND_TYPES[ground[idx]].buildable) return false;
      }
    }
    return true;
  }

  // --- Renderer interface ---

  function renderGame(state, map, campaign) {
    if (map.cols !== mapCache.cols || map.rows !== mapCache.rows || tileMeshes.length === 0) {
      setGridSize(map.cols, map.rows);
      mapCache.ground = map.ground;
      rebuildTileMesh(map);
    } else if (mapCache.ground !== map.ground) {
      mapCache.ground = map.ground;
      rebuildTileMesh(map);
    }

    clearEntities();
    for (const t of state.towers) entityRoot.add(towerGroup(t, state, campaign));
    for (const m of state.monsters) {
      if (m.hp > 0) entityRoot.add(monsterGroup(m));
    }
    for (const p of state.projectiles) entityRoot.add(projectileMesh(p));

    for (let i = state.effects.length - 1; i >= 0; i--) {
      const e = state.effects[i];
      entityRoot.add(effectMesh(e));
      e.ttl--;
      if (e.ttl <= 0) state.effects.splice(i, 1);
    }

    if (state.cursor.visible) {
      const preview = cursorPreview(state, map, campaign);
      if (preview) entityRoot.add(preview);
    }

    three.render(scene, camera);

    // Tick the canvas-style message timer (no DOM display for WebGL yet).
    if (state.messageTimer > 0) state.messageTimer--;
    updateGameOverOverlay(state);
  }

  function renderEditor(map, cursor, overlay) {
    if (map.cols !== mapCache.cols || map.rows !== mapCache.rows) {
      setGridSize(map.cols, map.rows);
    }
    // The editor paints tiles — always rebuild so changes show immediately.
    mapCache.ground = map.ground;
    rebuildTileMesh(map);

    clearEntities();
    if (cursor.visible) entityRoot.add(editorCursorGroup(cursor, overlay));

    three.render(scene, camera);
    hideGameOverOverlay();
  }

  function clientToTile(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) {
      return { px: 0, py: 0, x: 0, y: 0 };
    }
    return { px: hit.x, py: hit.z, x: Math.floor(hit.x), y: Math.floor(hit.z) };
  }

  function getDimensions() {
    return { tile: 40, canvasW: canvas.width, canvasH: canvas.height };
  }

  function clear() { /* three.render handles clear */ }

  resize();
  window.addEventListener('resize', resize);

  return {
    renderGame, renderEditor, resize, clientToTile, getDimensions, clear, setGridSize,
  };
}

// --- Tile texture drawing helpers ---
// Each function stamps a pattern on a canvas 2d context filled with the
// brightened base colour. Patterns are deterministic (Math.random is fine —
// textures are generated once per ground type, per session).

function hex(c) { return '#' + c.getHexString(); }

function shadeColor(c, amt) {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.l = Math.max(0, Math.min(1, hsl.l + amt));
  // Reuse the Color prototype via a temp.
  const o = c.clone();
  o.setHSL(hsl.h, hsl.s, hsl.l);
  return hex(o);
}

function drawGrass(ctx, size, base) {
  ctx.fillStyle = shadeColor(base, -0.1);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillRect(x, y, 1, 1 + Math.random() * 2);
  }
  ctx.fillStyle = shadeColor(base, 0.1);
  for (let i = 0; i < 40; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
}

function drawRoad(ctx, size, base) {
  // Tire-track style bands + gritty noise.
  ctx.strokeStyle = shadeColor(base, -0.15);
  ctx.lineWidth = 1;
  for (let y = 10; y < size; y += 14) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.random());
    ctx.lineTo(size, y + Math.random());
    ctx.stroke();
  }
  ctx.fillStyle = shadeColor(base, -0.08);
  for (let i = 0; i < 80; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
}

function drawWater(ctx, size, base) {
  // Scatter small ripple arcs.
  ctx.strokeStyle = shadeColor(base, 0.22);
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    ctx.beginPath();
    ctx.arc(cx, cy, 1 + Math.random() * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Faint highlight specks.
  ctx.fillStyle = shadeColor(base, 0.3);
  for (let i = 0; i < 20; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
}

function drawSwamp(ctx, size, base) {
  ctx.fillStyle = shadeColor(base, -0.12);
  for (let i = 0; i < 10; i++) {
    const r = 2 + Math.random() * 4;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = shadeColor(base, 0.08);
  for (let i = 0; i < 30; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
}

function drawForest(ctx, size, base) {
  // Dense clusters of canopy circles.
  for (let i = 0; i < 22; i++) {
    const r = 3 + Math.random() * 3;
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = shadeColor(base, -0.15);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shadeColor(base, 0.12);
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMountain(ctx, size, base) {
  // Jagged cracks.
  ctx.strokeStyle = shadeColor(base, -0.22);
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 3; j++) {
      x += (Math.random() - 0.5) * 14;
      y += (Math.random() - 0.5) * 14;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Highlight flecks (snow / glint).
  ctx.fillStyle = shadeColor(base, 0.25);
  for (let i = 0; i < 20; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
}

// --- Shared DOM overlays (both renderers use these) ---

function updateGameOverOverlay(state) {
  const el = document.getElementById('game-over');
  if (!el) return;
  if (state.phase === 'GAMEOVER') {
    el.style.display = 'flex';
    const scoreEl = document.getElementById('game-over-score');
    if (scoreEl) scoreEl.textContent = 'Score: ' + state.score;
  } else {
    el.style.display = 'none';
  }
}

function hideGameOverOverlay() {
  const el = document.getElementById('game-over');
  if (el) el.style.display = 'none';
}
