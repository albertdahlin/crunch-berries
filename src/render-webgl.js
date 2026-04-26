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
  three.toneMappingExposure = 1.15;
  three.shadowMap.enabled = true;
  three.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // Warm-tinted dusk fog. The scene fades to deep ember rather than neutral
  // black, which keeps the Ashenhold mood consistent edge-to-edge.
  const FOG_COLOR = '#1a1224';
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.014);

  // True isometric: camera offset direction (1,1,1)/√3 gives yaw = 45° and
  // elevation = arcsin(1/√3) ≈ 35.264°. Orthographic projection is what makes
  // the result look "flat"; distance is arbitrary (just far enough to clear
  // near-plane clipping).
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  camera.up.set(0, 1, 0);
  const cameraOffset = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(60);

  // Lighting (moody warm-sun key, cool fill):
  // - Lower ambient so the directional light actually shapes things.
  // - Hemisphere: cool dusk sky → warm rust ground gives free environmental
  //   gradient on every mesh.
  // - Sun: warm-amber tinted directional, angled to throw long shadows.
  // - Ember point light tucked into the camera target, low intensity, stays
  //   with the player as they pan — gives a "lantern" reading on nearby
  //   towers and monsters.
  scene.add(new THREE.AmbientLight(0xffe8c0, 0.40));
  scene.add(new THREE.HemisphereLight(0x6e88c4, 0x4a2818, 0.55));
  const sun = new THREE.DirectionalLight(0xffd49a, 1.1);
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

  // Ember "lantern" — soft warm point light that follows the camera target
  // so close-up entities catch a hint of fireglow. Distance/decay tuned so
  // it falls off well before reaching the map edge.
  const ember = new THREE.PointLight(0xff7a3a, 0.7, 14, 1.6);
  scene.add(ember);

  const tileRoot   = new THREE.Group(); scene.add(tileRoot);
  const entityRoot = new THREE.Group(); scene.add(entityRoot);

  /** @type {THREE.InstancedMesh[]} one per distinct ground type present in the map */
  const tileMeshes = [];
  const mapCache = { cols: 0, rows: 0, /** @type {?Uint8Array} */ ground: null, towerCount: -1 };

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

  // Tile shapes: keep the plain box — InstancedMesh + setColorAt + uv-mapped
  // texture already gives each tile organic variation.
  const tileGeom        = boxGeom;
  // Mountain peaks: 4-sided pyramid for a jagged silhouette.
  const peakGeom        = new THREE.ConeGeometry(0.55, 1, 4);
  // Tree decoration layered on forest tiles.
  const treeTrunkGeom   = new THREE.CylinderGeometry(0.04, 0.06, 0.18, 6);
  const treeCanopyGeom  = new THREE.ConeGeometry(0.16, 0.34, 6);

  // Entity primitives — small / scaled to fit the per-frame entity rebuild.
  const smallBoxGeom    = new THREE.BoxGeometry(1, 1, 1); // alias of boxGeom
  const smallSphereGeom = new THREE.SphereGeometry(0.12, 10, 8);
  const armGeom         = new THREE.BoxGeometry(0.08, 0.32, 0.08);
  const legGeom         = new THREE.BoxGeometry(0.12, 0.28, 0.12);
  const wingGeom        = makeWingGeom();
  const orbGeom         = new THREE.SphereGeometry(0.13, 10, 8);
  const spearGeom       = new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6);
  const spearTipGeom    = new THREE.ConeGeometry(0.06, 0.18, 6);
  const helmetGeom      = new THREE.ConeGeometry(0.18, 0.16, 8);
  const wispGeom        = makeWispGeom();
  const merlonGeom      = new THREE.BoxGeometry(0.18, 0.18, 0.18);

  const SHARED_GEOM = new WeakSet();
  [
    boxGeom, cylinderGeom, headGeom, coneGeom, sphereGeom,
    circleLineGeom, boxEdgesGeom, tileGeom, peakGeom,
    treeTrunkGeom, treeCanopyGeom, smallBoxGeom, smallSphereGeom,
    armGeom, legGeom, wingGeom, orbGeom, spearGeom, spearTipGeom,
    helmetGeom, wispGeom, merlonGeom,
  ].forEach(g => SHARED_GEOM.add(g));

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

  // Chamfered tile: 1×1 in xz, 1 in y. Top face is 0.94×0.94, walls slope out
  // to 0.98×0.98 at the bottom. Renders as a "stone tile" silhouette under
  // the iso camera. UVs map the canvas texture onto the top.
  function makeChamferedTile() {
    const top = 0.47;   // half-extent at top
    const bot = 0.49;   // half-extent at bottom
    const h = 1;
    const verts = [
      // top face (4 vertices, +y)
      -top,  h, -top,    top,  h, -top,    top,  h,  top,   -top,  h,  top,
      // bottom face
      -bot,  0, -bot,    bot,  0, -bot,    bot,  0,  bot,   -bot,  0,  bot,
    ];
    const uvs = [
      0, 1, 1, 1, 1, 0, 0, 0,        // top, mapped from canvas texture
      0, 1, 1, 1, 1, 0, 0, 0,        // bottom (unused but kept consistent)
    ];
    const idx = [
      0, 1, 2, 0, 2, 3,                  // top
      // 4 trapezoid sides: top-edge connects to bottom-edge
      0, 4, 5, 0, 5, 1,                  // -z side
      1, 5, 6, 1, 6, 2,                  // +x side
      2, 6, 7, 2, 7, 3,                  // +z side
      3, 7, 4, 3, 4, 0,                  // -x side
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Stylised wing: thin diamond, anchored at the body-side narrow tip.
  function makeWingGeom() {
    const verts = [
      0,    0, 0,
      0.34, 0.04, -0.10,
      0.46, 0,    0,
      0.34, -0.04, 0.10,
    ];
    const idx = [0,1,2, 0,2,3, 0,2,1, 0,3,2];  // double-sided
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Wisp: tall lathed teardrop for shade-like hovering monsters.
  function makeWispGeom() {
    const points = [];
    const segs = 7;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // taper sharply to top, fuller at the lower-third
      const r = 0.22 * Math.sin(Math.PI * t * 0.85) + 0.04;
      const y = t * 0.7;
      points.push(new THREE.Vector2(r, y));
    }
    return new THREE.LatheGeometry(points, 12);
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
    // Ember lantern hangs slightly above and toward the camera from the
    // pan target — gives close foreground meshes a warm rim.
    ember.position.set(t.x - 1, 2.2, t.z - 1);
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
    const size = 128;
    const canvas2d = document.createElement('canvas');
    canvas2d.width = canvas2d.height = size;
    const ctx = canvas2d.getContext('2d');
    const base = brightTileColor(gt.bg);
    // Subtle base gradient — slightly darker at one corner so flat tiles get
    // a hint of variation even before the per-type pattern lands.
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, shadeColor(base, 0.04));
    bg.addColorStop(1, shadeColor(base, -0.06));
    ctx.fillStyle = bg;
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
    drawTileVignette(ctx, size, base);
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
    // Mountains are split off into their own pyramid mesh; forests get an
    // extra tree-decoration mesh layered on top of the ground tile.
    /** @type {Map<number, number>} */
    const countByType = new Map();
    let forestTiles = 0;
    let mountainTiles = 0;
    for (let i = 0; i < map.cols * map.rows; i++) {
      const t = map.ground[i];
      const gt = GROUND_TYPES[t] || GROUND_TYPES[0];
      if (gt.name === 'Mountain') { mountainTiles++; continue; }
      countByType.set(t, (countByType.get(t) || 0) + 1);
      if (gt.name === 'Forest') forestTiles++;
    }

    /** @type {Map<number, THREE.InstancedMesh>} */
    const meshByType = new Map();
    for (const [typeId, count] of countByType) {
      const mesh = new THREE.InstancedMesh(tileGeom, getTileMaterial(typeId), count);
      mesh.castShadow = false;       // flat tiles barely cast useful shadows
      mesh.receiveShadow = true;
      mesh.count = 0;
      meshByType.set(typeId, mesh);
      tileMeshes.push(mesh);
      tileRoot.add(mesh);
    }
    // Mountain mesh: pyramidal peaks on a base block. We reuse the box mesh
    // for the base (tucked into the same InstancedMesh as grass-style tiles
    // would be too complicated) by drawing a short box plus a pyramid.
    /** @type {?THREE.InstancedMesh} */
    let mountainMesh = null;
    /** @type {?THREE.InstancedMesh} */
    let mountainPeak = null;
    if (mountainTiles > 0) {
      const baseMatId = GROUND_TYPES.findIndex(g => g.name === 'Mountain');
      const baseMat = baseMatId >= 0 ? getTileMaterial(baseMatId) : getTileMaterial(0);
      mountainMesh = new THREE.InstancedMesh(tileGeom, baseMat, mountainTiles);
      mountainMesh.castShadow = true;
      mountainMesh.receiveShadow = true;
      mountainMesh.count = 0;
      tileMeshes.push(mountainMesh);
      tileRoot.add(mountainMesh);

      mountainPeak = new THREE.InstancedMesh(peakGeom, lambertMat(brightTileColor(GROUND_TYPES[baseMatId].bg).getStyle()), mountainTiles);
      mountainPeak.castShadow = true;
      mountainPeak.receiveShadow = true;
      mountainPeak.count = 0;
      tileMeshes.push(mountainPeak);
      tileRoot.add(mountainPeak);
    }
    // Forest tree decorations: small canopy cones on every forest tile.
    /** @type {?THREE.InstancedMesh} */
    let treeCanopy = null;
    /** @type {?THREE.InstancedMesh} */
    let treeTrunk = null;
    if (forestTiles > 0) {
      treeCanopy = new THREE.InstancedMesh(treeCanopyGeom, lambertMat('#2c5a2e'), forestTiles);
      treeCanopy.castShadow = true;
      treeTrunk  = new THREE.InstancedMesh(treeTrunkGeom,  lambertMat('#3a2a1a'), forestTiles);
      treeTrunk.castShadow = true;
      treeCanopy.count = 0;
      treeTrunk.count = 0;
      tileMeshes.push(treeCanopy, treeTrunk);
      tileRoot.add(treeCanopy);
      tileRoot.add(treeTrunk);
    }

    const _matrix = new THREE.Matrix4();
    const _pos    = new THREE.Vector3();
    const _quat   = new THREE.Quaternion();
    const _scl    = new THREE.Vector3();
    const _color  = new THREE.Color();
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const i = row * map.cols + col;
        const typeId = map.ground[i];
        const gt = GROUND_TYPES[typeId] || GROUND_TYPES[0];

        if (gt.name === 'Mountain') {
          // Short base + tall peak so the silhouette has a real point on top.
          if (!mountainMesh || !mountainPeak) continue;
          const baseH = 0.7;
          _pos.set(col + 0.5, baseH / 2, row + 0.5);
          _scl.set(0.98, baseH, 0.98);
          _matrix.compose(_pos, _quat, _scl);
          mountainMesh.setMatrixAt(mountainMesh.count, _matrix);
          jitterColor(_color, 0.08, hashTile(col, row));
          mountainMesh.setColorAt(mountainMesh.count, _color);
          mountainMesh.count++;

          const peakH = 1.1 + 0.15 * Math.sin(hashTile(col, row) * 11.13);
          _pos.set(col + 0.5, baseH + peakH / 2 - 0.04, row + 0.5);
          _scl.set(1, peakH, 1);
          _quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hashTile(col, row) * Math.PI);
          _matrix.compose(_pos, _quat, _scl);
          mountainPeak.setMatrixAt(mountainPeak.count, _matrix);
          mountainPeak.setColorAt(mountainPeak.count, _color);
          mountainPeak.count++;
          _quat.identity();
          continue;
        }

        const hgt =
          gt.name === 'Water'  ? 0.08 :        // water sits low
          gt.name === 'Forest' ? 0.30 :        // forest slightly raised
                                 0.2;          // grass / road / swamp
        _pos.set(col + 0.5, hgt / 2, row + 0.5);
        _scl.set(0.98, hgt, 0.98);
        _matrix.compose(_pos, _quat, _scl);
        const mesh = meshByType.get(typeId);
        if (!mesh) continue;
        mesh.setMatrixAt(mesh.count, _matrix);
        // Per-tile color jitter — gives the field of grass texture
        // organic variation without exporting per-tile materials.
        const amt = gt.name === 'Road' ? 0.04 : 0.08;
        jitterColor(_color, amt, hashTile(col, row));
        mesh.setColorAt(mesh.count, _color);
        mesh.count++;

        // Forest tiles that hold a tower lose their canopy decoration so the
        // tower silhouette reads cleanly without a tree poking through it.
        if (gt.name === 'Forest' && treeCanopy && treeTrunk && (!map.grid || map.grid[i] === 0)) {
          const hash = hashTile(col, row);
          const offX = (hash % 7 - 3) * 0.05;
          const offZ = ((hash >> 3) % 7 - 3) * 0.05;
          const sc = 0.85 + (hash % 5) * 0.06;
          const trunkY = hgt + 0.09;
          const canopyY = hgt + 0.30 + (hash % 3) * 0.02;
          _pos.set(col + 0.5 + offX, trunkY, row + 0.5 + offZ);
          _scl.set(sc, sc, sc);
          _matrix.compose(_pos, _quat, _scl);
          treeTrunk.setMatrixAt(treeTrunk.count++, _matrix);
          _pos.set(col + 0.5 + offX, canopyY, row + 0.5 + offZ);
          _scl.set(sc, sc, sc);
          _matrix.compose(_pos, _quat, _scl);
          treeCanopy.setMatrixAt(treeCanopy.count++, _matrix);
        }
      }
    }
    for (const m of tileMeshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // Per-tile color jitter using a deterministic hash so tiles look the
  // same on every reload. amt is the +/- HSL-lightness range.
  function jitterColor(out, amt, hash) {
    const offset = ((hash % 1000) / 1000) * 2 - 1;  // [-1, 1)
    const v = 1 + offset * amt;
    out.setRGB(v, v, v);
    return out;
  }
  function hashTile(c, r) {
    let h = (c * 73856093) ^ (r * 19349663);
    h = (h ^ (h >>> 13)) * 1274126177;
    return Math.abs(h ^ (h >>> 16)) >>> 0;
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

    // Pick a silhouette by tower id; fall back to a generic box+cone stack
    // for user campaigns that introduce custom towers.
    const baseId = (campaign.towers[t.typeIdx] || {}).id || node.id;
    const builder = TOWER_BUILDERS[baseId] || buildGenericTower;
    const towerArt = builder(node, size);
    g.add(towerArt);
    // Records the top of the base so the rotation arrow / health bar / range
    // ring can layer above the tower without collision math.
    const topY = towerArt.userData.topY || 0.9;

    if (t.hp < t.maxHp) {
      const ratio = Math.max(0, Math.min(1, t.hp / t.maxHp));
      const barY = topY + 0.18;
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
      const barY = topY * 0.55;
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
      outline.scale.set(size.w * 0.92, 0.4, size.h * 0.92);
      outline.position.y = 0.2;
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

  // ---- Tower silhouette builders ----
  // Each builder returns a Group anchored at the tower's tile centre (y=0
  // is ground). Set userData.topY to the local y of the tower's highest
  // useful surface so the surrounding code can layer health bars / arrows
  // above the silhouette.

  function buildGenericTower(node, size) {
    const g = new THREE.Group();
    const base = outlinedMesh(boxGeom, lambertMat(node.bg || '#444'));
    base.scale.set(size.w * 0.9, 0.4, size.h * 0.9);
    base.position.y = 0.2;
    g.add(base);
    const top = outlinedMesh(coneGeom, lambertMat(node.color || '#fff'));
    top.position.y = 0.4 + 0.35;
    g.add(top);
    g.userData.topY = 0.4 + 0.7;
    return g;
  }

  function buildSoldierTower(node, size) {
    const g = new THREE.Group();
    const baseColor = lambertMat(node.bg || '#1565c0');
    const accent    = lambertMat(node.color || '#4fc3f7');
    // No base plate — soldier stands directly on the tile.
    const torso = outlinedMesh(boxGeom, accent);
    torso.scale.set(0.45, 0.45, 0.32);
    torso.position.y = 0.225;
    g.add(torso);
    // Head — small sphere
    const head = outlinedMesh(headGeom, lambertMat('#e1c28a'));
    head.scale.set(1.05, 1.05, 1.05);
    head.position.y = 0.45 + 0.18;
    g.add(head);
    // Conical helmet
    const helm = outlinedMesh(helmetGeom, baseColor);
    helm.position.y = 0.45 + 0.36;
    g.add(helm);
    // Spear (stationary on the right side)
    const shaft = outlinedMesh(spearGeom, lambertMat('#5d4037'));
    shaft.position.set(0.32, 0.40, 0);
    g.add(shaft);
    const tip = outlinedMesh(spearTipGeom, baseColor);
    tip.position.set(0.32, 0.78, 0);
    g.add(tip);
    g.userData.topY = 0.92;
    return g;
  }

  function buildMageTower(node, size) {
    const g = new THREE.Group();
    const baseColor = lambertMat(node.bg || '#bf360c');
    const accent    = lambertMat(node.color || '#ff8a65');
    // No base plate — small pedestal grounds the spire.
    const ped = outlinedMesh(boxGeom, baseColor);
    ped.scale.set(size.w * 0.72, 0.22, size.h * 0.72);
    ped.position.y = 0.11;
    g.add(ped);
    // Tall slender spire
    const spire = outlinedMesh(coneGeom, accent);
    spire.scale.set(0.85, 1.4, 0.85);
    spire.position.y = 0.22 + 0.49;
    g.add(spire);
    // Floating orb — emissive accent
    const orb = new THREE.Mesh(orbGeom, basicMat(node.color || '#ff8a65'));
    orb.position.y = 0.22 + 1.10;
    g.add(orb);
    g.userData.topY = 0.22 + 1.16;
    return g;
  }

  function buildBarricadeTower(node, size) {
    const g = new THREE.Group();
    const stone = lambertMat(node.bg || '#455a64');
    // Stout wall block
    const wall = outlinedMesh(boxGeom, stone);
    wall.scale.set(size.w * 0.94, 0.55, size.h * 0.94);
    wall.position.y = 0.275;
    g.add(wall);
    // Crenellations: 4 small blocks at the top corners
    const c = lambertMat(node.color || '#90a4ae');
    const ofs = 0.30;
    [[ -ofs, -ofs ], [ ofs, -ofs ], [ -ofs, ofs ], [ ofs, ofs ]].forEach(([dx, dz]) => {
      const m = outlinedMesh(merlonGeom, c);
      m.position.set(dx * size.w, 0.55 + 0.09, dz * size.h);
      g.add(m);
    });
    g.userData.topY = 0.55 + 0.18;
    return g;
  }

  /** @type {Record<string, (node: any, size: any) => any>} */
  const TOWER_BUILDERS = {
    soldier:   buildSoldierTower,
    mage:      buildMageTower,
    barricade: buildBarricadeTower,
  };

  function monsterGroup(m, campaign) {
    const g = new THREE.Group();
    g.position.set(m.x, 0, m.y);
    const scale = m.renderScale || 1;
    const def = (campaign && campaign.monsters[m.typeIdx]) || {};
    m._defId = def.id || '';
    const archetype = MONSTER_ARCHETYPES[m._defId] || 'biped';
    // Cycle phase derived from world position so neighbouring monsters
    // animate out of phase — looks like a march, not a chorus.
    const t = performance.now() / 1000;
    const phase = (m.x + m.y) * 1.7;
    const builder =
      archetype === 'quadruped' ? buildQuadrupedMonster :
      archetype === 'flyer'     ? buildFlyerMonster :
      archetype === 'wisp'      ? buildWispMonster :
                                  buildBipedMonster;
    const monsterArt = builder(m, t, phase);
    monsterArt.scale.set(scale, scale, scale);
    g.add(monsterArt);
    const topY = (monsterArt.userData.topY || 1.0) * scale;

    if (m.hp < m.maxHp) {
      const ratio = Math.max(0, Math.min(1, m.hp / m.maxHp));
      const barY = topY + 0.18;
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

  // ---- Monster archetype builders ----
  // Each receives the monster, current time (s), and per-instance phase. The
  // group's local origin is the tile centre at ground level. Set userData.topY
  // for the health-bar layer.

  /** @type {Record<string, string>} */
  const MONSTER_ARCHETYPES = {
    goblin: 'biped',
    knight: 'biped',
    troll:  'biped-heavy',
    wolf:   'quadruped',
    bat:    'flyer',
    shade:  'wisp',
  };

  function buildBipedMonster(m, t, phase) {
    const heavy = (MONSTER_ARCHETYPES[m._defId || ''] === 'biped-heavy');
    const g = new THREE.Group();
    const skin = lambertMat(m.color);
    // Body
    const body = outlinedMesh(boxGeom, skin);
    const bw = heavy ? 0.55 : 0.42;
    const bh = heavy ? 0.5  : 0.42;
    const bd = heavy ? 0.40 : 0.32;
    body.scale.set(bw, bh, bd);
    const bobY = Math.sin(t * 6 + phase) * 0.04;
    body.position.y = 0.35 + bobY;
    g.add(body);
    // Head
    const head = outlinedMesh(headGeom, skin);
    const hs = heavy ? 1.4 : 1.0;
    head.scale.set(hs, hs, hs);
    head.position.y = 0.35 + bh / 2 + 0.18 * hs + bobY;
    g.add(head);
    // Eyes
    addEyes(g, head.position, 0.08, hs * 0.13);
    // Legs — opposite phase for walk illusion
    const swing = Math.sin(t * 6 + phase) * 0.4;
    const leftLeg  = outlinedMesh(legGeom, skin);
    const rightLeg = outlinedMesh(legGeom, skin);
    leftLeg.scale.set(0.9, heavy ? 1.2 : 1.0, 0.9);
    rightLeg.scale.set(0.9, heavy ? 1.2 : 1.0, 0.9);
    leftLeg.position.set(-0.1, 0.13, 0);
    rightLeg.position.set(0.1, 0.13, 0);
    leftLeg.rotation.x  =  swing * 0.8;
    rightLeg.rotation.x = -swing * 0.8;
    g.add(leftLeg);
    g.add(rightLeg);
    // Heavy bipeds get hanging arms
    if (heavy) {
      const armSwing = Math.sin(t * 6 + phase + Math.PI) * 0.3;
      const leftArm  = outlinedMesh(armGeom, skin);
      const rightArm = outlinedMesh(armGeom, skin);
      leftArm.scale.set(1.2, 1.4, 1.2);
      rightArm.scale.set(1.2, 1.4, 1.2);
      leftArm.position.set(-bw / 2 - 0.04, 0.45 + bobY, 0);
      rightArm.position.set(bw / 2 + 0.04, 0.45 + bobY, 0);
      leftArm.rotation.x  = -armSwing;
      rightArm.rotation.x =  armSwing;
      g.add(leftArm);
      g.add(rightArm);
    }
    g.userData.topY = 0.35 + bh / 2 + 0.36 * hs;
    return g;
  }

  function buildQuadrupedMonster(m, t, phase) {
    const g = new THREE.Group();
    const skin = lambertMat(m.color);
    // Long horizontal body
    const body = outlinedMesh(boxGeom, skin);
    body.scale.set(0.36, 0.30, 0.58);
    const bobY = Math.sin(t * 8 + phase) * 0.025;
    body.position.y = 0.30 + bobY;
    g.add(body);
    // Head jutting forward
    const head = outlinedMesh(boxGeom, skin);
    head.scale.set(0.28, 0.26, 0.26);
    head.position.set(0, 0.32 + bobY, 0.38);
    g.add(head);
    addEyes(g, head.position, 0.07, 0.10);
    // Tail
    const tail = outlinedMesh(boxGeom, skin);
    tail.scale.set(0.10, 0.10, 0.18);
    tail.position.set(0, 0.34 + bobY, -0.34);
    tail.rotation.x = -0.6 + Math.sin(t * 6 + phase) * 0.2;
    g.add(tail);
    // Four legs — front pair anti-phase to back pair (canter)
    const swingA = Math.sin(t * 8 + phase) * 0.45;
    const swingB = Math.sin(t * 8 + phase + Math.PI) * 0.45;
    const legPositions = [
      [ -0.13, -0.20, swingA ],   // back-left
      [  0.13, -0.20, swingB ],   // back-right
      [ -0.13,  0.22, swingB ],   // front-left
      [  0.13,  0.22, swingA ],   // front-right
    ];
    for (const [lx, lz, lswing] of legPositions) {
      const leg = outlinedMesh(legGeom, skin);
      leg.scale.set(0.8, 0.9, 0.8);
      leg.position.set(lx, 0.13, lz);
      leg.rotation.x = lswing;
      g.add(leg);
    }
    g.userData.topY = 0.55;
    return g;
  }

  function buildFlyerMonster(m, t, phase) {
    const g = new THREE.Group();
    const skin = lambertMat(m.color);
    // Hover offset
    const hover = 0.55 + Math.sin(t * 3 + phase) * 0.12;
    // Compact rounded body
    const body = outlinedMesh(headGeom, skin);
    body.scale.set(1.4, 1.2, 1.4);
    body.position.y = hover;
    g.add(body);
    // Eyes
    addEyes(g, body.position, 0.13, 0.09);
    // Two flapping wings — rotate around y to flap
    const flap = Math.sin(t * 14 + phase) * 0.6;
    const leftWing  = outlinedMesh(wingGeom, skin);
    const rightWing = outlinedMesh(wingGeom, skin);
    leftWing.position.set(-0.12, hover + 0.04, 0);
    rightWing.position.set(0.12, hover + 0.04, 0);
    leftWing.rotation.set(0, Math.PI, -flap);
    rightWing.rotation.set(0, 0, flap);
    g.add(leftWing);
    g.add(rightWing);
    g.userData.topY = hover + 0.2;
    return g;
  }

  function buildWispMonster(m, t, phase) {
    const g = new THREE.Group();
    const skin = lambertMat(m.color);
    const hover = 0.18 + Math.sin(t * 2 + phase) * 0.05;
    // Tapered hovering body
    const body = outlinedMesh(wispGeom, skin);
    body.position.y = hover;
    body.rotation.y = Math.sin(t * 1.5 + phase) * 0.2;
    g.add(body);
    // Glowing eye in the upper part of the wisp
    const eye = new THREE.Mesh(smallSphereGeom, basicMat('#fff3a0'));
    eye.scale.set(0.9, 0.9, 0.9);
    eye.position.y = hover + 0.55;
    g.add(eye);
    g.userData.topY = hover + 0.7;
    return g;
  }

  // Two small black sphere "eyes" in front of a head position.
  function addEyes(parent, headPos, sep, size) {
    const eyeMat = basicMat('#0a0a14');
    const left = new THREE.Mesh(smallSphereGeom, eyeMat);
    const right = new THREE.Mesh(smallSphereGeom, eyeMat);
    left.scale.set(size, size, size);
    right.scale.set(size, size, size);
    left.position.set(-sep, headPos.y + 0.02, headPos.z + 0.18);
    right.position.set(sep, headPos.y + 0.02, headPos.z + 0.18);
    parent.add(left);
    parent.add(right);
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
      mapCache.towerCount = state.towers.length;
      rebuildTileMesh(map);
    } else if (mapCache.ground !== map.ground || mapCache.towerCount !== state.towers.length) {
      // ground or tower placement changed — rebuild so trees on occupied
      // forest tiles disappear (or reappear after a sell).
      mapCache.ground = map.ground;
      mapCache.towerCount = state.towers.length;
      rebuildTileMesh(map);
    }

    clearEntities();
    for (const t of state.towers) entityRoot.add(towerGroup(t, state, campaign));
    for (const m of state.monsters) {
      if (m.hp > 0) entityRoot.add(monsterGroup(m, campaign));
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

    updateMessageOverlay(state);
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
    hideMessageOverlay();
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

// Tile vignette: darken the outer ring so individual tiles read as discrete
// stones rather than blending into a continuous field. Uses a radial gradient
// drawn with multiply so it composes regardless of base hue.
function drawTileVignette(ctx, size, base) {
  const dark = shadeColor(base, -0.18);
  ctx.save();
  ctx.globalAlpha = 0.45;
  // Top + bottom + left + right narrow gradient bands.
  const inset = Math.round(size * 0.08);
  const grad = ctx.createLinearGradient(0, 0, 0, inset);
  grad.addColorStop(0, dark);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, inset);
  const grad2 = ctx.createLinearGradient(0, size - inset, 0, size);
  grad2.addColorStop(0, 'rgba(0,0,0,0)');
  grad2.addColorStop(1, dark);
  ctx.fillStyle = grad2;
  ctx.fillRect(0, size - inset, size, inset);
  const grad3 = ctx.createLinearGradient(0, 0, inset, 0);
  grad3.addColorStop(0, dark);
  grad3.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad3;
  ctx.fillRect(0, 0, inset, size);
  const grad4 = ctx.createLinearGradient(size - inset, 0, size, 0);
  grad4.addColorStop(0, 'rgba(0,0,0,0)');
  grad4.addColorStop(1, dark);
  ctx.fillStyle = grad4;
  ctx.fillRect(size - inset, 0, inset, size);
  ctx.restore();
}

function drawGrass(ctx, size, base) {
  // Layered tufts: dark blades (back) + mid blades + occasional bright tips
  // and tiny wildflowers.
  const dark   = shadeColor(base, -0.14);
  const mid    = shadeColor(base, -0.04);
  const bright = shadeColor(base, 0.16);
  // Long under-blades
  ctx.fillStyle = dark;
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillRect(x, y, 1, 2 + Math.random() * 3);
  }
  // Mid blades at slight angle (3-pixel diagonal flecks)
  ctx.fillStyle = mid;
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillRect(x, y, 1, 2);
    ctx.fillRect(x + 1, y + 1, 1, 2);
  }
  // Bright highlights — sun-catching tips
  ctx.fillStyle = bright;
  for (let i = 0; i < 35; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  // Sparse wildflowers — small saturated points
  const flowers = ['#f6d36c', '#dac9f0', '#ec8a8a'];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = flowers[i % flowers.length];
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillRect(x, y, 1, 1);
    ctx.fillRect(x + 1, y, 1, 1);
    ctx.fillRect(x, y + 1, 1, 1);
  }
}

function drawRoad(ctx, size, base) {
  // Cobblestones with mortar in between. Each stone is an irregular blob.
  const stoneLight = shadeColor(base, 0.12);
  const stoneMid   = shadeColor(base, -0.04);
  const mortar     = shadeColor(base, -0.20);
  // Mortar grid as a backdrop, then stones overlap it.
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, size, size);
  // Layout cobblestones on a jittered grid.
  const step = 16;
  for (let gy = 0; gy < size + step; gy += step) {
    for (let gx = 0; gx < size + step; gx += step) {
      const cx = gx + (Math.random() - 0.5) * 5 + (gy / step % 2 ? step / 2 : 0);
      const cy = gy + (Math.random() - 0.5) * 5;
      const r  = step * 0.42 + Math.random() * 2;
      // Stone fill — random tonal pick
      ctx.fillStyle = Math.random() < 0.6 ? stoneMid : stoneLight;
      ctx.beginPath();
      // Approximate cobble: 6-sided blob
      const sides = 6;
      for (let s = 0; s < sides; s++) {
        const t = (s / sides) * Math.PI * 2 + Math.random() * 0.3;
        const rr = r * (0.78 + Math.random() * 0.28);
        const x = cx + Math.cos(t) * rr;
        const y = cy + Math.sin(t) * rr;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      // Tiny highlight on top-left of stone
      ctx.fillStyle = shadeColor(base, 0.22);
      ctx.fillRect(cx - r * 0.5, cy - r * 0.5, 2, 1);
    }
  }
  // Gritty dust speckles
  ctx.fillStyle = shadeColor(base, -0.05);
  for (let i = 0; i < 80; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
}

function drawWater(ctx, size, base) {
  // Layered ripple bands + concentric ripple rings + sparkle.
  const lit  = shadeColor(base, 0.28);
  const mid  = shadeColor(base, 0.08);
  // Horizontal wave-crest stripes (uneven)
  ctx.strokeStyle = mid;
  ctx.lineWidth = 1;
  for (let y = 8; y < size; y += 11) {
    ctx.beginPath();
    let prev = -3;
    for (let x = 0; x <= size; x += 4) {
      const yy = y + Math.sin((x + y) * 0.21) * 2 + (Math.random() - 0.5);
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
      prev = yy;
    }
    ctx.stroke();
  }
  // Concentric ripples — 3-4 nested circles
  ctx.strokeStyle = lit;
  for (let i = 0; i < 5; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const rings = 2 + Math.floor(Math.random() * 2);
    for (let r = 1; r <= rings; r++) {
      ctx.globalAlpha = 0.5 - r * 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // Sparkle highlights — bright single pixels
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 18; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  ctx.globalAlpha = 1;
}

function drawSwamp(ctx, size, base) {
  // Murky pools (radial gradient blobs) + bubble highlights + dead twigs.
  for (let i = 0; i < 14; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r = 4 + Math.random() * 7;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, shadeColor(base, -0.20));
    grad.addColorStop(1, shadeColor(base, -0.02));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Bubble highlights (single bright pixels at pool edges)
  ctx.fillStyle = shadeColor(base, 0.25);
  for (let i = 0; i < 50; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  // Dead twigs — thin dark strokes
  ctx.strokeStyle = shadeColor(base, -0.30);
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 6 + Math.random() * 8;
    const ang = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
}

function drawForest(ctx, size, base) {
  // Forest floor: leaf litter (3 colour scatter) + dappled light spots,
  // since the standalone canopy meshes already provide tree tops above the
  // tile.
  const litterDark = shadeColor(base, -0.18);
  const litterMid  = shadeColor(base, -0.05);
  const leaf1      = '#7a4a26';
  const leaf2      = '#a08a3c';
  const leaf3      = '#3a5a2c';
  // Mossy dappling
  for (let i = 0; i < 30; i++) {
    const r = 2 + Math.random() * 5;
    ctx.fillStyle = litterDark;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Smaller mid-tone moss blobs
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = litterMid;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  // Leaf litter — tiny colored dots in 3 leaf colours
  const leafColors = [leaf1, leaf2, leaf3];
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = leafColors[i % 3];
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillRect(x, y, 1, 1);
    if (Math.random() < 0.3) ctx.fillRect(x + 1, y + 1, 1, 1);
  }
  // Dappled light spots (subtle pale circles, low opacity)
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = shadeColor(base, 0.4);
  for (let i = 0; i < 6; i++) {
    const cx = Math.random() * size, cy = Math.random() * size;
    const r = 6 + Math.random() * 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMountain(ctx, size, base) {
  // Stratified rock with angular fractures, dark crevasses, snow on top.
  const crack    = shadeColor(base, -0.30);
  const stratum1 = shadeColor(base, -0.10);
  const stratum2 = shadeColor(base,  0.06);
  // Horizontal stratification stripes — gives "layered rock" feel
  for (let y = 10; y < size; y += 12 + Math.random() * 4) {
    ctx.fillStyle = Math.random() < 0.5 ? stratum1 : stratum2;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(0, y, size, 3 + Math.random() * 3);
    ctx.globalAlpha = 1;
  }
  // Angular fracture lines — multi-segment polylines
  ctx.strokeStyle = crack;
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 4; j++) {
      x += (Math.random() - 0.5) * 22;
      y += (Math.random() - 0.5) * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Deep crevasse shadows (short heavy strokes)
  ctx.strokeStyle = shadeColor(base, -0.40);
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 14);
    ctx.stroke();
  }
  // Snow band along the top edge — clusters of bright pixels biased upward
  ctx.fillStyle = '#f4f1e8';
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * size;
    const y = Math.pow(Math.random(), 2) * size * 0.45; // bias toward 0
    ctx.fillRect(x, y, 1, 1);
    if (Math.random() < 0.35) ctx.fillRect(x + 1, y, 1, 1);
  }
  // Glint highlights scattered everywhere
  ctx.fillStyle = shadeColor(base, 0.26);
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

function updateMessageOverlay(state) {
  const el = document.getElementById('game-message');
  if (!el) return;
  if (state.messageTimer > 0) {
    el.style.display = 'flex';
    const txt = document.getElementById('game-message-text');
    if (txt) txt.textContent = state.message;
    state.messageTimer--;
  } else {
    el.style.display = 'none';
  }
}

function hideMessageOverlay() {
  const el = document.getElementById('game-message');
  if (el) el.style.display = 'none';
}
