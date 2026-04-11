// === CONSTANTS ===
const VERSION = '__VERSION__';
let COLS = 15;
let ROWS = 15;
const FPS = 30;
const TICK_RATE = 1000 / FPS;

// Tile size derived from viewport width so the board fills the screen width
let TILE_SIZE, CANVAS_W, CANVAS_H;

// === DAMAGE TYPES ===
const DAMAGE_TYPES = ['physical', 'fire', 'ice', 'lightning', 'poison'];
const DAMAGE_TYPE_COLORS = { physical: '#aaa', fire: '#ff6600', ice: '#66ccff', lightning: '#ffff33', poison: '#aa44ff' };

// === CONFIG (data-driven, editable via settings) ===
const DEFAULT_CONFIG = {
  towers: [
    { name: 'Melee',     letter: 'M', color: '#4fc3f7', bg: '#1565c0', range: 1, damage: 3, fireRate: 15, cost: 10, hp: 10, damageType: 'physical' },
    { name: 'Range',     letter: 'R', color: '#fff176', bg: '#f57f17', range: 4, damage: 2, fireRate: 30, cost: 15, hp: 5, damageType: 'physical' },
    { name: 'DOT',       letter: 'D', color: '#81c784', bg: '#2e7d32', range: 1, damage: 0, fireRate: 30, cost: 20, hp: 8, damageType: 'fire', dot: { dps: 1, duration: 90 } },
    { name: 'Pierce',    letter: 'P', color: '#ce93d8', bg: '#6a1b9a', range: 5, damage: 1, fireRate: 45, cost: 25, hp: 5, damageType: 'lightning', pierce: true, sizeW: 1, sizeH: 2, attackDir: 'fixed' },
    { name: 'Barricade', letter: 'B', color: '#90a4ae', bg: '#455a64', range: 0, damage: 0, fireRate: 9999, cost: 3, hp: 15 },
  ],
  monsters: [
    { name: 'Normal', letter: 'N', color: '#ef5350', hp: 12, speed: 0.08, reward: 5 },
    { name: 'Fast',   letter: 'F', color: '#ff8a65', hp: 6,  speed: 0.16, reward: 7, damageModifiers: { ice: 2 } },
    { name: 'Tank',   letter: 'H', color: '#ab47bc', hp: 30, speed: 0.05, reward: 12, damageModifiers: { physical: 0.5, fire: 2, poison: 1.5 } },
  ],
  waves: {
    baseCounts: [6, 3, 2],
    unlockWave: [1, 2, 3],
    scaleEvery: 2,
    hpScale: 20,
    intervalStart: 40,
    intervalDecay: 3,
    intervalMin: 10,
  },
  game: {
    startGold: 50,
    startLives: 20,
    waveBonusGold: 10,
  },
};

let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// Load saved config from localStorage
try {
  const saved = localStorage.getItem('td-config');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.towers && parsed.monsters && parsed.waves && parsed.game) {
      CONFIG = parsed;
    }
  }
} catch(e) { /* use defaults */ }

function getWaveConfig(waveNum) {
  const w = CONFIG.waves;
  const scale = Math.pow(2, Math.floor((waveNum - 1) / w.scaleEvery));
  const counts = CONFIG.monsters.map((_, i) => {
    const base = (w.baseCounts[i] || 1);
    const unlock = (w.unlockWave[i] || 1);
    return waveNum >= unlock ? Math.round(base * scale) : 0;
  });
  const interval = Math.max(w.intervalMin, w.intervalStart - (waveNum - 1) * w.intervalDecay);
  const hpMult = 1 + (waveNum - 1) * (w.hpScale || 0) / 100;
  return { counts, interval, hpMult };
}

// === GROUND TYPES ===
const GROUND_GRASS = 0;
const GROUND_ROAD  = 1;
const GROUND_WATER = 2;
const GROUND_SWAMP = 3;
const GROUND_FOREST = 4;

const GROUND_WALKABLE   = [true, true, false, true, false];   // can monsters walk?
const GROUND_BUILDABLE  = [true, false, false, false, true];   // can towers be placed?
const GROUND_SPEED_MULT = [1.0, 1.0, 1.0, 0.5, 1.0];         // monster speed multiplier

const GROUND_BG         = ['#1a2a1a', '#2a2218', '#0a1a3a', '#2a2a0a', '#0a2a0a'];
const GROUND_CHAR       = ['', '.', '~', ',', '\u2663'];
const GROUND_CHAR_COLOR = ['', '#3a3028', '#1a3a6a', '#4a4a1a', '#1a5a1a'];

// === SAVED MAPS ===
const GROUND_NAMES = ['Grass', 'Road', 'Water', 'Swamp', 'Forest'];

let savedMaps = [];
try {
  const raw = localStorage.getItem('td-maps');
  if (raw) savedMaps = JSON.parse(raw);
} catch(e) { savedMaps = []; }

function saveMapsToStorage() {
  localStorage.setItem('td-maps', JSON.stringify(savedMaps));
}

function loadGroundFromMap(mapData) {
  ground.fill(GROUND_GRASS);
  for (let x = 0; x < COLS; x++) {
    ground[x] = GROUND_ROAD;
    ground[(ROWS - 1) * COLS + x] = GROUND_ROAD;
  }
  if (mapData) {
    for (let i = 0; i < mapData.length && i < COLS * ROWS; i++) {
      // Don't overwrite top/bottom road rows
      const y = Math.floor(i / COLS);
      if (y === 0 || y === ROWS - 1) continue;
      ground[i] = mapData[i];
    }
  }
}

function groundToMapData() {
  return Array.from(ground);
}

// === MAP EDITOR ===
const editor = {
  brush: GROUND_GRASS,
  brushSize: 1,
  painting: false,
  mapIndex: -1,  // -1 = new map
  mapName: 'My Map',
};

function openMapEditor(mapIndex) {
  if (mapIndex >= 0 && savedMaps[mapIndex]) {
    const map = savedMaps[mapIndex];
    resizeGrid(map.cols || 24, map.rows || 48);
    loadGroundFromMap(map.data);
    editor.mapName = map.name;
    editor.mapIndex = mapIndex;
  } else {
    resizeGrid(15, 15);
    editor.mapIndex = -1;
    editor.mapName = 'My Map';
  }
  editor.brush = GROUND_GRASS;
  editor.brushSize = 1;
  editor.painting = false;
  state.cursor = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2), visible: false };
  state.phase = 'MAP_EDIT';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('ui').style.display = 'none';
  document.getElementById('editor-ui').style.display = 'flex';
  document.getElementById('editor-map-name').value = editor.mapName;
  document.getElementById('editor-map-cols').value = COLS;
  document.getElementById('editor-map-rows').value = ROWS;
  rebuildBrushButtons();
}

function rebuildBrushButtons() {
  const container = document.getElementById('brush-buttons');
  container.innerHTML = '';
  for (let i = 0; i < GROUND_NAMES.length; i++) {
    const btn = document.createElement('button');
    btn.textContent = GROUND_NAMES[i];
    btn.dataset.brush = i;
    btn.style.borderColor = GROUND_BG[i];
    if (i === editor.brush) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      editor.brush = i;
      document.querySelectorAll('#brush-buttons button').forEach(b =>
        b.classList.toggle('selected', parseInt(b.dataset.brush) === i));
    });
    container.appendChild(btn);
  }
}

function paintTile(x, y) {
  const sz = editor.brushSize;
  for (let dy = 0; dy < sz; dy++) {
    for (let dx = 0; dx < sz; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= COLS || py < 0 || py >= ROWS) continue;
      // Don't paint over top/bottom road rows
      if (py === 0 || py === ROWS - 1) continue;
      ground[py * COLS + px] = editor.brush;
    }
  }
}

function saveMap() {
  const nameInput = document.getElementById('editor-map-name');
  editor.mapName = (nameInput.value || '').trim() || 'My Map';
  const data = groundToMapData();
  if (editor.mapIndex >= 0) {
    savedMaps[editor.mapIndex].data = data;
    savedMaps[editor.mapIndex].name = editor.mapName;
    savedMaps[editor.mapIndex].cols = COLS;
    savedMaps[editor.mapIndex].rows = ROWS;
  } else {
    savedMaps.push({ name: editor.mapName, data: data, cols: COLS, rows: ROWS });
    editor.mapIndex = savedMaps.length - 1;
  }
  saveMapsToStorage();
  showMessage('Map saved!');
}

function validateAndPlay() {
  // Check path exists
  grid.fill(0);
  recomputePath();
  if (!isTopRowReachable()) {
    showMessage('No valid path! Monsters need a walkable route top to bottom.');
    return;
  }
  saveMap();
  document.getElementById('editor-ui').style.display = 'none';
  startGameWithGround();
}

function startGameWithGround() {
  // Start game using current ground state (already set)
  grid.fill(0);
  state.towers.length = 0;
  state.monsters.length = 0;
  state.effects.length = 0;
  state.projectiles.length = 0;
  state.wave = 0;
  state.lives = CONFIG.game.startLives;
  state.gold = CONFIG.game.startGold;
  state.score = 0;
  state.frame = 0;
  state.cursor = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2), visible: false };
  state.selectedTower = 0;
  state.placeRotation = 0;
  state.message = '';
  state.messageTimer = 0;
  recomputePath();
  rebuildTowerButtons();
  state.phase = 'PLACE';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('ui').style.display = 'flex';
}

function enterMapSelect() {
  // Use a fixed 15-col layout for the menu so items fit vertically
  COLS = 15;
  ROWS = Math.max(15, Math.ceil(window.innerHeight / Math.floor(window.innerWidth / 15)));
  grid = new Uint8Array(COLS * ROWS);
  ground = new Uint8Array(COLS * ROWS);
  resizeCanvas();
  state.phase = 'MAP_SELECT';
}

function exitEditor() {
  document.getElementById('editor-ui').style.display = 'none';
  enterMapSelect();
}

function deleteMap(idx) {
  savedMaps.splice(idx, 1);
  saveMapsToStorage();
}

// === CANVAS SETUP ===
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;

function resizeCanvas() {
  TILE_SIZE = Math.floor(window.innerWidth / COLS);
  CANVAS_W = COLS * TILE_SIZE;
  CANVAS_H = ROWS * TILE_SIZE;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = CANVAS_W + 'px';
  canvas.style.height = CANVAS_H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// === STATE ===
let grid = new Uint8Array(COLS * ROWS);    // 0=empty, 1=tower
let ground = new Uint8Array(COLS * ROWS);  // GROUND_* terrain type per tile

function resizeGrid(newCols, newRows) {
  const oldCols = COLS, oldRows = ROWS;
  const oldGround = ground;
  COLS = newCols;
  ROWS = newRows;
  grid = new Uint8Array(COLS * ROWS);
  ground = new Uint8Array(COLS * ROWS);
  ground.fill(GROUND_GRASS);
  // Copy old terrain data where it overlaps
  const copyW = Math.min(oldCols, COLS);
  const copyH = Math.min(oldRows, ROWS);
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      ground[y * COLS + x] = oldGround[y * oldCols + x];
    }
  }
  // Enforce top/bottom road rows
  for (let x = 0; x < COLS; x++) {
    ground[x] = GROUND_ROAD;
    ground[(ROWS - 1) * COLS + x] = GROUND_ROAD;
  }
  resizeCanvas();
}

const state = {
  towers: [],
  monsters: [],
  effects: [],      // visual effects [{x,y,tx,ty,ttl,color}]
  projectiles: [],   // in-flight projectiles
  cursor: { x: 7, y: 7, visible: false },
  selectedTower: 0,
  placeRotation: 0,   // 0=up, 1=right, 2=down, 3=left (for pierce tower)
  wave: 0,
  lives: 20,
  gold: 50,
  score: 0,
  frame: 0,
  phase: 'MAP_SELECT', // MAP_SELECT | PLACE | WAVE | GAMEOVER
  selectedMap: 0,
  spawnQueue: [],
  spawnTimer: 0,
  message: '',
  messageTimer: 0,
};

let pathDist = null;   // Int32Array
let pathFlow = null;   // Int8Array (-1=none, 0-7 directions)

// 8 directions: 0=up, 1=up-right, 2=right, 3=down-right, 4=down, 5=down-left, 6=left, 7=up-left
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

// === PATHFINDING (Dijkstra, prefers downward movement) ===
// Costs from BFS expand direction (monster moves opposite):
//   expand up (dir=0) => monster goes down => cheap (2)
//   expand diag-up (dir=1,7) => monster goes diag-down => cheap (3)
//   expand left/right (dir=2,6) => monster goes sideways => moderate (4)
//   expand diag-down (dir=3,5) => monster goes diag-up => expensive (6)
//   expand down (dir=4) => monster goes up => most expensive (7)
const DIR_COST = [2, 3, 4, 6, 7, 6, 4, 3];

function computePath(tempGrid) {
  const g = tempGrid || grid;
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  const flow = new Int8Array(COLS * ROWS).fill(-1);

  // Simple binary heap priority queue
  const heap = [];
  function heapPush(cost, idx) {
    heap.push((cost << 16) | idx);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent] <= heap[i]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }
  function heapPop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && heap[l] < heap[smallest]) smallest = l;
        if (r < heap.length && heap[r] < heap[smallest]) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  // Seed: all bottom-row cells that are walkable (no tower + walkable ground)
  for (let x = 0; x < COLS; x++) {
    const idx = (ROWS - 1) * COLS + x;
    if (g[idx] === 0 && GROUND_WALKABLE[ground[idx]]) {
      dist[idx] = 0;
      heapPush(0, idx);
    }
  }

  while (heap.length > 0) {
    const val = heapPop();
    const d = val >> 16;
    const idx = val & 0xFFFF;
    if (d > dist[idx] && dist[idx] !== -1 && d !== 0) continue;
    const cx = idx % COLS;
    const cy = (idx - cx) / COLS;

    for (let dir = 0; dir < 8; dir++) {
      const nx = cx + DX[dir];
      const ny = cy + DY[dir];
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const ni = ny * COLS + nx;
      if (g[ni] !== 0 || !GROUND_WALKABLE[ground[ni]]) continue;
      // Diagonal: require both adjacent cardinal cells to be free (no corner-cutting)
      if (dir % 2 === 1) {
        const adj1Idx = cy * COLS + nx;
        const adj2Idx = ny * COLS + cx;
        if (g[adj1Idx] !== 0 || !GROUND_WALKABLE[ground[adj1Idx]] ||
            g[adj2Idx] !== 0 || !GROUND_WALKABLE[ground[adj2Idx]]) continue;
      }
      let tileCost = DIR_COST[dir];
      if (ground[ni] === GROUND_SWAMP) tileCost *= 2;
      const nd = d + tileCost;
      if (dist[ni] !== -1 && nd >= dist[ni]) continue;
      dist[ni] = nd;
      // Flow points from neighbor toward current cell (opposite direction)
      flow[ni] = (dir + 4) % 8;
      heapPush(nd, ni);
    }
  }

  return { dist, flow };
}

function recomputePath() {
  const result = computePath();
  pathDist = result.dist;
  pathFlow = result.flow;
}

function isTopRowReachable(tempGrid) {
  const result = computePath(tempGrid);
  for (let x = 0; x < COLS; x++) {
    if (result.dist[x] !== -1) return true;
  }
  return false;
}

// === TOWER LOGIC ===
const ROT_NAMES = ['Up', 'Right', 'Down', 'Left'];

function getTowerSize(typeIdx, rotation) {
  const type = CONFIG.towers[typeIdx];
  if (!type) return { w: 2, h: 2 };
  const sw = type.sizeW || 2, sh = type.sizeH || 2;
  return (rotation === 1 || rotation === 3) ? { w: sh, h: sw } : { w: sw, h: sh };
}

function canPlaceTower(tx, ty, typeIdx, rotation) {
  if (typeIdx === undefined) typeIdx = state.selectedTower;
  if (rotation === undefined) rotation = state.placeRotation;
  const size = getTowerSize(typeIdx, rotation);
  if (tx < 0 || tx + size.w > COLS || ty < 0 || ty + size.h > ROWS) return false;
  if (ty < 1 || ty + size.h > ROWS - 1) return false;
  for (let dy = 0; dy < size.h; dy++) {
    for (let dx = 0; dx < size.w; dx++) {
      const idx = (ty + dy) * COLS + (tx + dx);
      if (grid[idx] !== 0) return false;
      if (!GROUND_BUILDABLE[ground[idx]]) return false;
    }
  }
  return true;
}

function placeTower() {
  if (state.phase === 'GAMEOVER') return;
  const tx = state.cursor.x;
  const ty = state.cursor.y;
  const type = CONFIG.towers[state.selectedTower];
  const size = getTowerSize(state.selectedTower, state.placeRotation);

  if (state.gold < type.cost) {
    showMessage('Not enough gold!');
    return;
  }
  if (!canPlaceTower(tx, ty)) {
    showMessage('Can\'t place here!');
    return;
  }

  // Tentative placement
  const tempGrid = new Uint8Array(grid);
  for (let dy = 0; dy < size.h; dy++)
    for (let dx = 0; dx < size.w; dx++)
      tempGrid[(ty + dy) * COLS + (tx + dx)] = 1;

  // Check if path still exists
  const pathBlocked = !isTopRowReachable(tempGrid);

  // Commit placement
  for (let dy = 0; dy < size.h; dy++)
    for (let dx = 0; dx < size.w; dx++)
      grid[(ty + dy) * COLS + (tx + dx)] = 1;

  state.towers.push({
    x: tx, y: ty,
    typeIdx: state.selectedTower,
    rotation: state.placeRotation,
    hp: type.hp,
    maxHp: type.hp,
    lastFire: 0,
  });

  state.gold -= type.cost;
  recomputePath();

  if (pathBlocked) {
    showMessage('Path blocked! Monsters will attack!');
  }
}

function removeTower(tower) {
  const idx = state.towers.indexOf(tower);
  if (idx === -1) return;
  state.towers.splice(idx, 1);
  const size = getTowerSize(tower.typeIdx, tower.rotation);
  for (let dy = 0; dy < size.h; dy++)
    for (let dx = 0; dx < size.w; dx++)
      grid[(tower.y + dy) * COLS + (tower.x + dx)] = 0;
  recomputePath();
}

function distToTower(mx, my, tower) {
  const size = getTowerSize(tower.typeIdx, tower.rotation);
  const cx = Math.max(tower.x, Math.min(tower.x + size.w - 1, Math.floor(mx)));
  const cy = Math.max(tower.y, Math.min(tower.y + size.h - 1, Math.floor(my)));
  return Math.abs(mx - cx) + Math.abs(my - cy);
}

// === DAMAGE HELPERS ===
function getDamageModifier(monster, damageType) {
  const mCfg = CONFIG.monsters[monster.typeIdx];
  return (mCfg.damageModifiers && mCfg.damageModifiers[damageType]) ?? 1.0;
}

function applyDamage(monster, baseDamage, damageType) {
  const mod = getDamageModifier(monster, damageType || 'physical');
  monster.hp -= baseDamage * mod;
}

function applySpeedMod(monster, factor, duration) {
  if (factor === 1) return;
  monster.speedMod = { factor: factor, remaining: duration || 60 };
}

function applySplash(cx, cy, radius, towerType, excludeMonster) {
  const dmgType = towerType.damageType || 'physical';
  for (const m of state.monsters) {
    if (m.hp <= 0 || m === excludeMonster) continue;
    const d = Math.hypot(m.x - cx, m.y - cy);
    if (d <= radius) {
      applyDamage(m, towerType.damage, dmgType);
      if (towerType.speedFactor && towerType.speedFactor !== 1) {
        applySpeedMod(m, towerType.speedFactor, towerType.speedDuration);
      }
      if (towerType.dot) {
        m.dot = { dps: towerType.dot.dps, remaining: towerType.dot.duration, damageType: dmgType };
      }
    }
  }
  state.effects.push({ type: 'circle', x: cx, y: cy, radius: radius, ttl: 8, color: towerType.color });
}

function updateTowers() {
  for (const tower of state.towers) {
    const type = CONFIG.towers[tower.typeIdx];
    if (type.range <= 0 || (type.damage <= 0 && !type.dot)) continue;
    if (state.frame - tower.lastFire < type.fireRate) continue;

    const tSize = getTowerSize(tower.typeIdx, tower.rotation);
    const tcx = tower.x + tSize.w / 2;
    const tcy = tower.y + tSize.h / 2;

    // Facing direction for fixed towers
    const isFixed = type.attackDir === 'fixed';
    const fdx = [0, 1, 0, -1][tower.rotation];
    const fdy = [-1, 0, 1, 0][tower.rotation];

    // Fire origin: facing edge for fixed, center otherwise
    let ox = tcx, oy = tcy;
    if (isFixed) {
      if (tower.rotation === 0) { ox = tower.x + tSize.w / 2; oy = tower.y; }
      else if (tower.rotation === 1) { ox = tower.x + tSize.w; oy = tower.y + tSize.h / 2; }
      else if (tower.rotation === 2) { ox = tower.x + tSize.w / 2; oy = tower.y + tSize.h; }
      else { ox = tower.x; oy = tower.y + tSize.h / 2; }
    }

    if (type.pierce) {
      // Pierce corridor attack
      const dir = tower.rotation * 2; // 0=up, 2=right, 4=down, 6=left
      const corridorW = Math.max(tSize.w, tSize.h) === tSize.w ? tSize.h : tSize.w;

      let hit = false;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        const rx = m.x - ox;
        const ry = m.y - oy;
        let inCorridor = false;
        if (dir === 0 && Math.abs(rx) < corridorW && ry >= -type.range && ry <= 0) inCorridor = true;
        if (dir === 4 && Math.abs(rx) < corridorW && ry >= 0 && ry <= type.range) inCorridor = true;
        if (dir === 2 && Math.abs(ry) < corridorW && rx >= 0 && rx <= type.range) inCorridor = true;
        if (dir === 6 && Math.abs(ry) < corridorW && rx >= -type.range && rx <= 0) inCorridor = true;
        if (inCorridor) {
          applyDamage(m, type.damage, type.damageType);
          if (type.speedFactor && type.speedFactor !== 1) {
            applySpeedMod(m, type.speedFactor, type.speedDuration);
          }
          hit = true;
        }
      }
      if (!hit) continue;
      tower.lastFire = state.frame;
      const ex = ox + DX[dir] * type.range;
      const ey = oy + DY[dir] * type.range;
      state.effects.push({ x: ox, y: oy, tx: ex, ty: ey, ttl: 4, color: type.color, wide: true });

    } else if (type.dot) {
      // DOT tower: prioritize monsters without DOT, then nearest in range
      let nearest = null;
      let nearDist = Infinity;
      let nearestHasDot = true;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        if (isFixed) {
          const dx = m.x - tcx, dy = m.y - tcy;
          if (dx * fdx + dy * fdy <= 0) continue;
        }
        const d = distToTower(m.x, m.y, tower);
        if (d > type.range + 1) continue;
        const hasDot = !!m.dot;
        if ((!hasDot && nearestHasDot) || (hasDot === nearestHasDot && d < nearDist)) {
          nearDist = d;
          nearest = m;
          nearestHasDot = hasDot;
        }
      }
      if (!nearest) continue;
      tower.lastFire = state.frame;
      nearest.dot = { dps: type.dot.dps, remaining: type.dot.duration, damageType: type.damageType || 'physical' };
      if (type.speedFactor && type.speedFactor !== 1) {
        applySpeedMod(nearest, type.speedFactor, type.speedDuration);
      }
      state.effects.push({ x: ox, y: oy, tx: nearest.x, ty: nearest.y, ttl: 4, color: type.color });

    } else {
      // Single-target (Melee / Range)
      let nearest = null;
      let nearDist = Infinity;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        if (isFixed) {
          const dx = m.x - tcx, dy = m.y - tcy;
          if (dx * fdx + dy * fdy <= 0) continue;
        }
        const d = (type.range <= 1) ? distToTower(m.x, m.y, tower) : Math.hypot(m.x - tcx, m.y - tcy);
        if (d < nearDist && d <= type.range + 1) {
          nearDist = d;
          nearest = m;
        }
      }
      if (!nearest) continue;
      tower.lastFire = state.frame;

      if (type.projectileSpeed > 0) {
        const dx = nearest.x - ox;
        const dy = nearest.y - oy;
        const dist = Math.hypot(dx, dy) || 1;
        state.projectiles.push({
          x: ox, y: oy,
          tx: nearest.x, ty: nearest.y,
          vx: (dx / dist) * type.projectileSpeed,
          vy: (dy / dist) * type.projectileSpeed,
          damage: type.damage,
          towerTypeIdx: tower.typeIdx,
          color: type.color,
        });
      } else {
        const dmgType = type.damageType || 'physical';
        applyDamage(nearest, type.damage, dmgType);
        if (type.speedFactor && type.speedFactor !== 1) {
          applySpeedMod(nearest, type.speedFactor, type.speedDuration);
        }
        if (type.splashRadius > 0) {
          applySplash(nearest.x, nearest.y, type.splashRadius, type, nearest);
        }
        state.effects.push({ x: ox, y: oy, tx: nearest.x, ty: nearest.y, ttl: 4, color: type.color });
      }
    }
  }
}

// === PROJECTILE LOGIC ===
function updateProjectiles() {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];

    // Move along fixed trajectory
    p.x += p.vx;
    p.y += p.vy;

    // Check if projectile reached or passed the target point
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    // Dot product with velocity: negative means we've passed the target
    const dot = dx * p.vx + dy * p.vy;

    if (dot <= 0) {
      // Impact at target location
      p.x = p.tx;
      p.y = p.ty;
      const type = CONFIG.towers[p.towerTypeIdx];
      const dmgType = type.damageType || 'physical';
      // Direct hit: damage the closest monster at impact point
      let hitMonster = null;
      let hitDist = 1.0; // max distance for direct hit
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < hitDist) { hitDist = d; hitMonster = m; }
      }
      if (hitMonster) {
        applyDamage(hitMonster, p.damage, dmgType);
        if (type.speedFactor && type.speedFactor !== 1) {
          applySpeedMod(hitMonster, type.speedFactor, type.speedDuration);
        }
      }
      if (type.splashRadius > 0) {
        applySplash(p.x, p.y, type.splashRadius, type, hitMonster);
      }
      state.projectiles.splice(i, 1);
    }
  }
}

// === MONSTER LOGIC ===
function spawnMonster(typeIdx, hpMult) {
  const type = CONFIG.monsters[typeIdx];
  // Find a reachable spawn column
  const candidates = [];
  for (let x = 0; x < COLS; x++) {
    if (pathDist && pathDist[x] !== -1 && GROUND_WALKABLE[ground[x]]) candidates.push(x);
  }
  if (candidates.length === 0) {
    // No reachable column, pick any walkable
    for (let x = 0; x < COLS; x++) {
      if (GROUND_WALKABLE[ground[x]]) candidates.push(x);
    }
  }
  const sx = candidates[Math.floor(Math.random() * candidates.length)];

  const scaledHp = Math.round(type.hp * (hpMult || 1));
  state.monsters.push({
    x: sx + 0.3 + Math.random() * 0.4,
    y: 0.3 + Math.random() * 0.4,
    hp: scaledHp,
    maxHp: scaledHp,
    speed: type.speed,
    typeIdx: typeIdx,
    reward: type.reward,
    letter: type.letter,
    color: type.color,
    attacking: null,
    dot: null,
    speedMod: null,
    renderScale: 0.8 + Math.random() * 0.4,  // 0.8 to 1.2
  });
}

function updateMonsters() {
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;

    // DOT damage (respects damage type modifiers)
    if (m.dot) {
      const dotMod = getDamageModifier(m, m.dot.damageType || 'physical');
      m.hp -= (m.dot.dps / FPS) * dotMod;
      m.dot.remaining--;
      if (m.dot.remaining <= 0) m.dot = null;
    }
    if (m.hp <= 0) continue;

    const tileX = Math.floor(m.x);
    const tileY = Math.floor(m.y);

    // Check if at goal
    if (tileY >= ROWS - 1) {
      m.hp = 0;
      state.lives--;
      if (state.lives <= 0) { state.phase = 'GAMEOVER'; releaseWakeLock(); }
      continue;
    }

    const idx = tileY * COLS + tileX;
    const flow = pathFlow ? pathFlow[idx] : -1;
    let speedMult = GROUND_SPEED_MULT[ground[idx]] || 1.0;
    if (m.speedMod) {
      speedMult *= m.speedMod.factor;
      m.speedMod.remaining--;
      if (m.speedMod.remaining <= 0) m.speedMod = null;
    }
    const mspd = m.speed * speedMult;

    if (flow === -1) {
      // No path - attack nearest tower
      if (!m.attacking || m.attacking.hp <= 0) {
        let best = null;
        let bestD = Infinity;
        for (const t of state.towers) {
          const d = distToTower(m.x, m.y, t);
          if (d < bestD) { bestD = d; best = t; }
        }
        m.attacking = best;
      }

      if (m.attacking) {
        const aSize = getTowerSize(m.attacking.typeIdx, m.attacking.rotation);
        const tcx = m.attacking.x + aSize.w / 2;
        const tcy = m.attacking.y + aSize.h / 2;
        const dx = tcx - m.x;
        const dy = tcy - m.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1.5) {
          // Adjacent, deal damage
          m.attacking.hp -= 2 / FPS;  // 2 damage per second
          if (m.attacking.hp <= 0) {
            removeTower(m.attacking);
            m.attacking = null;
          }
        } else {
          // Move toward tower
          m.x += (dx / dist) * mspd;
          m.y += (dy / dist) * mspd;
        }
      }
    } else {
      // Follow flow map
      m.attacking = null;
      const fdx = DX[flow];
      const fdy = DY[flow];
      const isDiag = fdx !== 0 && fdy !== 0;
      // Diagonal movement: normalize speed so diagonal isn't faster
      const spd = isDiag ? mspd * 0.707 : mspd;
      if (isDiag) {
        // Diagonal: move both axes
        m.x += fdx * spd;
        m.y += fdy * spd;
      } else if (fdx !== 0) {
        // Horizontal: snap y toward tile center
        const centerY = tileY + 0.5;
        const diffY = centerY - m.y;
        if (Math.abs(diffY) > 0.01) {
          m.y += Math.sign(diffY) * Math.min(Math.abs(diffY), mspd);
        }
        m.x += fdx * mspd;
      } else {
        // Vertical: snap x toward tile center
        const centerX = tileX + 0.5;
        const diffX = centerX - m.x;
        if (Math.abs(diffX) > 0.01) {
          m.x += Math.sign(diffX) * Math.min(Math.abs(diffX), mspd);
        }
        m.y += fdy * mspd;
      }
    }
  }

  // Remove dead monsters
  for (let i = state.monsters.length - 1; i >= 0; i--) {
    if (state.monsters[i].hp <= 0) {
      const m = state.monsters[i];
      if (m.hp <= 0 && state.lives > 0) {
        // Only award gold if monster was killed (not leaked)
        const tileY = Math.floor(m.y);
        if (tileY < ROWS - 1) {
          state.gold += m.reward;
          state.score += m.reward;
        }
      }
      state.monsters.splice(i, 1);
    }
  }
}

// === WAVE LOGIC ===
function startWave() {
  if (state.phase !== 'PLACE') return;
  state.wave++;
  const w = getWaveConfig(state.wave);
  // Spawn all monsters at once
  w.counts.forEach((count, i) => {
    for (let j = 0; j < count; j++) spawnMonster(i, w.hpMult);
  });
  state.phase = 'WAVE';
  requestWakeLock();
}

function updateSpawning() {
  if (state.phase !== 'WAVE') return;
  if (state.monsters.length === 0) {
    // Wave complete
    state.phase = 'PLACE';
    releaseWakeLock();
    state.gold += CONFIG.game.waveBonusGold;
    showMessage('Wave ' + state.wave + ' complete! +' + CONFIG.game.waveBonusGold + 'g');
  }
}

// === INPUT ===
function canvasToTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  return {
    px: (clientX - rect.left) * scaleX,
    py: (clientY - rect.top) * scaleY,
    x: Math.floor((clientX - rect.left) * scaleX / TILE_SIZE),
    y: Math.floor((clientY - rect.top) * scaleY / TILE_SIZE),
  };
}

function setupInput() {
  let isTouchDevice = false;

  // Mouse move - update cursor + paint in editor
  canvas.addEventListener('mousemove', (e) => {
    const t = canvasToTile(e.clientX, e.clientY);
    const maxX = state.phase === 'MAP_EDIT' ? COLS - 1 : COLS - 2;
    const maxY = state.phase === 'MAP_EDIT' ? ROWS - 1 : ROWS - 2;
    state.cursor.x = Math.max(0, Math.min(maxX, t.x));
    state.cursor.y = Math.max(0, Math.min(maxY, t.y));
    state.cursor.visible = true;
    if (state.phase === 'MAP_EDIT' && editor.painting) {
      paintTile(state.cursor.x, state.cursor.y);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    state.cursor.visible = false;
    editor.painting = false;
  });

  // Mouse down/up for editor drag-painting
  canvas.addEventListener('mousedown', (e) => {
    if (state.phase === 'MAP_EDIT') {
      editor.painting = true;
      const t = canvasToTile(e.clientX, e.clientY);
      state.cursor.x = Math.max(0, Math.min(COLS - 1, t.x));
      state.cursor.y = Math.max(0, Math.min(ROWS - 1, t.y));
      paintTile(state.cursor.x, state.cursor.y);
    }
  });
  canvas.addEventListener('mouseup', () => { editor.painting = false; });

  // Click - map select and tower placement
  canvas.addEventListener('click', (e) => {
    if (isTouchDevice) return;
    if (state.phase === 'MAP_EDIT') return; // handled by mousedown/move
    const t = canvasToTile(e.clientX, e.clientY);

    if (state.phase === 'MAP_SELECT') {
      handleMapSelectClick(t.px, t.py);
      return;
    }

    state.cursor.x = Math.max(0, Math.min(COLS - 2, t.x));
    state.cursor.y = Math.max(0, Math.min(ROWS - 2, t.y));
    placeTower();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (state.phase === 'MAP_SELECT') {
      handleMapSelectKey(e);
      return;
    }
    if (state.phase === 'MAP_EDIT') {
      // Number keys select brush
      const n = parseInt(e.key);
      if (n >= 1 && n <= GROUND_NAMES.length) {
        editor.brush = n - 1;
        rebuildBrushButtons();
        e.preventDefault();
      }
      return;
    }
    const pSize = getTowerSize(state.selectedTower, state.placeRotation);
    switch (e.key) {
      case 'ArrowUp':    state.cursor.y = Math.max(0, state.cursor.y - 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowDown':  state.cursor.y = Math.min(ROWS - pSize.h, state.cursor.y + 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowLeft':  state.cursor.x = Math.max(0, state.cursor.x - 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowRight': state.cursor.x = Math.min(COLS - pSize.w, state.cursor.x + 1); state.cursor.visible = true; e.preventDefault(); break;
      case ' ': case 'Enter': placeTower(); e.preventDefault(); break;
      case 'w': case 'W': startWave(); break;
      default: {
        const n = parseInt(e.key);
        if (n >= 1 && n <= CONFIG.towers.length) selectTowerType(n - 1);
      }
    }
  });

  // Touch
  let touchStartPos = null;
  canvas.addEventListener('touchstart', (e) => {
    isTouchDevice = true;
    const touch = e.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };
    if (state.phase === 'MAP_EDIT') {
      const t = canvasToTile(touch.clientX, touch.clientY);
      state.cursor.x = Math.max(0, Math.min(COLS - 1, t.x));
      state.cursor.y = Math.max(0, Math.min(ROWS - 1, t.y));
      state.cursor.visible = true;
      paintTile(state.cursor.x, state.cursor.y);
      editor.painting = true;
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (state.phase === 'MAP_EDIT' && editor.painting) {
      const touch = e.touches[0];
      const t = canvasToTile(touch.clientX, touch.clientY);
      state.cursor.x = Math.max(0, Math.min(COLS - 1, t.x));
      state.cursor.y = Math.max(0, Math.min(ROWS - 1, t.y));
      paintTile(state.cursor.x, state.cursor.y);
    }
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    editor.painting = false;
    if (!touchStartPos) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartPos.x;
    const dy = touch.clientY - touchStartPos.y;
    touchStartPos = null;
    if (state.phase === 'MAP_EDIT') return; // already handled
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const t = canvasToTile(touch.clientX, touch.clientY);

    if (state.phase === 'MAP_SELECT') {
      handleMapSelectClick(t.px, t.py);
      return;
    }

    state.cursor.x = Math.max(0, Math.min(COLS - 2, t.x));
    state.cursor.y = Math.max(0, Math.min(ROWS - 2, t.y));
    state.cursor.visible = true;
  });

  // UI buttons
  document.getElementById('btn-wave').addEventListener('click', startWave);
  document.getElementById('btn-place').addEventListener('click', () => {
    state.cursor.visible = true;
    placeTower();
  });
  document.getElementById('btn-settings').addEventListener('click', () => {
    state.phase = 'MAP_SELECT';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('ui').style.display = 'none';
    openSettings();
  });

  // Editor buttons
  document.getElementById('btn-editor-save').addEventListener('click', saveMap);
  document.getElementById('btn-editor-play').addEventListener('click', validateAndPlay);
  document.getElementById('btn-editor-clear').addEventListener('click', () => {
    ground.fill(GROUND_GRASS);
    for (let x = 0; x < COLS; x++) {
      ground[x] = GROUND_ROAD;
      ground[(ROWS - 1) * COLS + x] = GROUND_ROAD;
    }
  });
  document.getElementById('btn-editor-back').addEventListener('click', exitEditor);
  document.getElementById('btn-editor-size').addEventListener('click', () => {
    editor.brushSize = editor.brushSize >= 3 ? 1 : editor.brushSize + 1;
    document.getElementById('btn-editor-size').textContent = editor.brushSize + 'x' + editor.brushSize;
  });
  document.getElementById('editor-map-cols').addEventListener('change', (e) => {
    const v = Math.max(5, Math.min(60, +e.target.value || 15));
    e.target.value = v;
    resizeGrid(v, ROWS);
    state.cursor.x = Math.min(state.cursor.x, COLS - 1);
    state.cursor.y = Math.min(state.cursor.y, ROWS - 1);
  });
  document.getElementById('editor-map-rows').addEventListener('change', (e) => {
    const v = Math.max(5, Math.min(60, +e.target.value || 15));
    e.target.value = v;
    resizeGrid(COLS, v);
    state.cursor.x = Math.min(state.cursor.x, COLS - 1);
    state.cursor.y = Math.min(state.cursor.y, ROWS - 1);
  });
}

function selectTowerType(idx) {
  if (idx >= 0 && idx < CONFIG.towers.length) {
    const t = CONFIG.towers[idx];
    const sw = t.sizeW || 2, sh = t.sizeH || 2;
    if (state.selectedTower === idx && (sw !== sh || t.attackDir === 'fixed')) {
      rotatePlacement();
      return;
    }
    state.selectedTower = idx;
    document.querySelectorAll('#tower-buttons button').forEach((btn) => {
      btn.classList.toggle('selected', parseInt(btn.dataset.tower) === idx);
    });
    updateTowerButtonLabels();
  }
}

function rotatePlacement() {
  state.placeRotation = (state.placeRotation + 1) % 4;
  const size = getTowerSize(state.selectedTower, state.placeRotation);
  state.cursor.x = Math.min(state.cursor.x, COLS - size.w);
  state.cursor.y = Math.min(state.cursor.y, ROWS - size.h);
  updateTowerButtonLabels();
}

function updateTowerButtonLabels() {
  document.querySelectorAll('#tower-buttons button').forEach((btn) => {
    const i = parseInt(btn.dataset.tower);
    const t = CONFIG.towers[i];
    let label = (i + 1) + ': ' + t.name + ' (' + t.cost + 'g)';
    const sw = t.sizeW || 2, sh = t.sizeH || 2;
    if (state.selectedTower === i && (sw !== sh || t.attackDir === 'fixed')) {
      label += ' ' + ROT_NAMES[state.placeRotation];
    }
    btn.textContent = label;
  });
}

function showMessage(msg) {
  state.message = msg;
  state.messageTimer = FPS * 2;  // 2 seconds
}

// === RENDERING ===
function render() {
  ctx.fillStyle = '#0e0e1a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (state.phase === 'MAP_SELECT') {
    drawMapSelect();
    return;
  }
  if (state.phase === 'MAP_EDIT') {
    drawGrid();
    drawEditorCursor();
    drawMessage();
    return;
  }

  drawGrid();
  drawTowers();
  drawMonsters();
  drawProjectiles();
  drawCursor();
  drawEffects();
  drawUI();
}

function drawEditorCursor() {
  if (!state.cursor.visible) return;
  const px = state.cursor.x * TILE_SIZE;
  const py = state.cursor.y * TILE_SIZE;
  const sz = editor.brushSize;

  // Brush preview
  ctx.fillStyle = GROUND_BG[editor.brush];
  ctx.globalAlpha = 0.5;
  ctx.fillRect(px, py, TILE_SIZE * sz, TILE_SIZE * sz);
  ctx.globalAlpha = 1;

  // Cursor outline
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE * sz - 1, TILE_SIZE * sz - 1);

  // Show terrain name
  const name = GROUND_NAMES[editor.brush];
  if (name) {
    ctx.font = Math.floor(TILE_SIZE * 0.5) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(name, px + TILE_SIZE * sz / 2, py + TILE_SIZE * sz / 2);
  }
}

function drawGrid() {
  ctx.font = (TILE_SIZE - 4) + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Draw terrain per tile
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const gt = ground[y * COLS + x];
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      ctx.fillStyle = GROUND_BG[gt];
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      if (GROUND_CHAR[gt]) {
        ctx.fillStyle = GROUND_CHAR_COLOR[gt];
        ctx.fillText(GROUND_CHAR[gt], px + TILE_SIZE / 2, py + TILE_SIZE / 2);
      }
    }
  }

  // Grid lines (subtle)
  ctx.strokeStyle = '#1a1a2a';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE_SIZE, 0);
    ctx.lineTo(x * TILE_SIZE, CANVAS_H);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE_SIZE);
    ctx.lineTo(CANVAS_W, y * TILE_SIZE);
    ctx.stroke();
  }

  // Spawn markers (only on walkable tiles)
  ctx.fillStyle = '#2a4a2a';
  for (let x = 0; x < COLS; x++) {
    if (GROUND_WALKABLE[ground[x]])
      ctx.fillText('v', x * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 2);
  }
  // Goal markers (only on walkable tiles)
  ctx.fillStyle = '#2a2a4a';
  for (let x = 0; x < COLS; x++) {
    if (GROUND_WALKABLE[ground[(ROWS - 1) * COLS + x]])
      ctx.fillText('=', x * TILE_SIZE + TILE_SIZE / 2, (ROWS - 1) * TILE_SIZE + TILE_SIZE / 2);
  }
}

function drawTowers() {
  for (const tower of state.towers) {
    const type = CONFIG.towers[tower.typeIdx];
    const size = getTowerSize(tower.typeIdx, tower.rotation);
    const px = tower.x * TILE_SIZE;
    const py = tower.y * TILE_SIZE;
    const tw = size.w * TILE_SIZE;
    const th = size.h * TILE_SIZE;

    // Background
    ctx.fillStyle = type.bg;
    ctx.fillRect(px + 1, py + 1, tw - 2, th - 2);

    // HP bar
    if (tower.hp < tower.maxHp) {
      const hpRatio = tower.hp / tower.maxHp;
      ctx.fillStyle = '#333';
      ctx.fillRect(px + 2, py + th - 4, tw - 4, 3);
      ctx.fillStyle = hpRatio > 0.5 ? '#4caf50' : hpRatio > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(px + 2, py + th - 4, (tw - 4) * hpRatio, 3);
    }

    // Letter at center
    ctx.font = 'bold ' + (TILE_SIZE) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = type.color;
    ctx.fillText(type.letter, px + tw / 2, py + th / 2);

    // Direction arrow for fixed-direction towers
    if (type.attackDir === 'fixed') {
      const as = TILE_SIZE * 0.3;
      ctx.fillStyle = type.color;
      ctx.beginPath();
      if (tower.rotation === 0) {
        ctx.moveTo(px + tw / 2, py + 2);
        ctx.lineTo(px + tw / 2 - as, py + 2 + as);
        ctx.lineTo(px + tw / 2 + as, py + 2 + as);
      } else if (tower.rotation === 1) {
        ctx.moveTo(px + tw - 2, py + th / 2);
        ctx.lineTo(px + tw - 2 - as, py + th / 2 - as);
        ctx.lineTo(px + tw - 2 - as, py + th / 2 + as);
      } else if (tower.rotation === 2) {
        ctx.moveTo(px + tw / 2, py + th - 2);
        ctx.lineTo(px + tw / 2 - as, py + th - 2 - as);
        ctx.lineTo(px + tw / 2 + as, py + th - 2 - as);
      } else {
        ctx.moveTo(px + 2, py + th / 2);
        ctx.lineTo(px + 2 + as, py + th / 2 - as);
        ctx.lineTo(px + 2 + as, py + th / 2 + as);
      }
      ctx.fill();
    }
  }
}

function drawMonsters() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const px = m.x * TILE_SIZE;
    const py = m.y * TILE_SIZE;
    const fontSize = Math.round((TILE_SIZE - 2) * (m.renderScale || 1));

    // Speed modifier indicator
    if (m.speedMod) {
      ctx.fillStyle = m.speedMod.factor < 1
        ? 'rgba(100, 181, 246, 0.3)'   // blue for slow
        : 'rgba(255, 235, 59, 0.3)';   // yellow for haste
      ctx.beginPath();
      ctx.arc(px, py, TILE_SIZE / 2 + 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // DOT indicator
    if (m.dot) {
      ctx.fillStyle = 'rgba(129, 199, 132, 0.3)';
      ctx.beginPath();
      ctx.arc(px, py, TILE_SIZE / 2 + 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Monster letter (scaled per monster)
    ctx.font = 'bold ' + fontSize + 'px monospace';
    ctx.fillStyle = m.color;
    ctx.fillText(m.letter, px, py);

    // HP bar
    if (m.hp < m.maxHp) {
      const hpRatio = m.hp / m.maxHp;
      const barW = TILE_SIZE - 2;
      ctx.fillStyle = '#333';
      ctx.fillRect(px - barW / 2, py - TILE_SIZE / 2 - 2, barW, 2);
      ctx.fillStyle = '#ef5350';
      ctx.fillRect(px - barW / 2, py - TILE_SIZE / 2 - 2, barW * hpRatio, 2);
    }
  }
}

function drawProjectiles() {
  for (const p of state.projectiles) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x * TILE_SIZE, p.y * TILE_SIZE, TILE_SIZE * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCursor() {
  if (!state.cursor.visible) return;
  const px = state.cursor.x * TILE_SIZE;
  const py = state.cursor.y * TILE_SIZE;
  const type = CONFIG.towers[state.selectedTower];
  const size = getTowerSize(state.selectedTower, state.placeRotation);
  const tw = size.w * TILE_SIZE;
  const th = size.h * TILE_SIZE;
  const canPlace = canPlaceTower(state.cursor.x, state.cursor.y);

  // Cursor highlight
  ctx.fillStyle = canPlace ? 'rgba(255,255,255,0.15)' : 'rgba(255,80,80,0.15)';
  ctx.fillRect(px, py, tw, th);
  ctx.strokeStyle = canPlace ? 'rgba(255,255,255,0.5)' : 'rgba(255,80,80,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, tw - 1, th - 1);

  // Show selected tower letter
  ctx.font = 'bold ' + TILE_SIZE + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = canPlace ? 'rgba(255,255,255,0.5)' : 'rgba(255,80,80,0.3)';
  ctx.fillText(type.letter, px + tw / 2, py + th / 2);

  // Direction arrow for fixed-direction towers
  if (type.attackDir === 'fixed' && canPlace) {
    const as = TILE_SIZE * 0.3;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    if (state.placeRotation === 0) {
      ctx.moveTo(px + tw / 2, py + 2);
      ctx.lineTo(px + tw / 2 - as, py + 2 + as);
      ctx.lineTo(px + tw / 2 + as, py + 2 + as);
    } else if (state.placeRotation === 1) {
      ctx.moveTo(px + tw - 2, py + th / 2);
      ctx.lineTo(px + tw - 2 - as, py + th / 2 - as);
      ctx.lineTo(px + tw - 2 - as, py + th / 2 + as);
    } else if (state.placeRotation === 2) {
      ctx.moveTo(px + tw / 2, py + th - 2);
      ctx.lineTo(px + tw / 2 - as, py + th - 2 - as);
      ctx.lineTo(px + tw / 2 + as, py + th - 2 - as);
    } else {
      ctx.moveTo(px + 2, py + th / 2);
      ctx.lineTo(px + 2 + as, py + th / 2 - as);
      ctx.lineTo(px + 2 + as, py + th / 2 + as);
    }
    ctx.fill();
  }

  // Range preview
  if (canPlace) {
    const range = type.range;
    if (type.pierce) {
      // Show ray line preview in fire direction
      let ox, oy;
      if (state.placeRotation === 0) { ox = px + tw / 2; oy = py; }
      else if (state.placeRotation === 1) { ox = px + tw; oy = py + th / 2; }
      else if (state.placeRotation === 2) { ox = px + tw / 2; oy = py + th; }
      else { ox = px; oy = py + th / 2; }
      const dir = state.placeRotation * 2;
      const ex = ox + DX[dir] * range * TILE_SIZE;
      const ey = oy + DY[dir] * range * TILE_SIZE;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = Math.max(2, TILE_SIZE * 0.3);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 0.5;
      const rcx = px + tw / 2;
      const rcy = py + th / 2;
      const rr = (range + 1) * TILE_SIZE;
      ctx.beginPath();
      ctx.arc(rcx, rcy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawEffects() {
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];

    if (e.type === 'circle') {
      // Splash circle: expands and fades
      const progress = 1 - (e.ttl / 8);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = e.ttl / 8;
      ctx.beginPath();
      ctx.arc(e.x * TILE_SIZE, e.y * TILE_SIZE, e.radius * TILE_SIZE * progress, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // Line effect (default)
      ctx.strokeStyle = e.color;
      ctx.lineWidth = e.wide ? Math.max(4, TILE_SIZE * 0.4) : 2;
      ctx.globalAlpha = e.ttl / 4;
      ctx.beginPath();
      ctx.moveTo(e.x * TILE_SIZE, e.y * TILE_SIZE);
      ctx.lineTo(e.tx * TILE_SIZE, e.ty * TILE_SIZE);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    e.ttl--;
    if (e.ttl <= 0) state.effects.splice(i, 1);
  }
}

function getMapSelectLayout() {
  const itemSize = Math.floor(TILE_SIZE * 0.9);
  const descSize = Math.floor(TILE_SIZE * 0.6);
  const boxH = TILE_SIZE * 3;
  const boxW = COLS * TILE_SIZE * 0.85;
  const centerX = CANVAS_W / 2;
  const startY = TILE_SIZE * 5;
  const gap = TILE_SIZE * 0.5;
  // Items: "New Map" button, then each saved map, then settings
  const items = [];
  // "Empty" play option
  items.push({ type: 'play-empty', y: 0, h: boxH });
  // "New Map" editor button
  items.push({ type: 'new-map', y: 0, h: boxH });
  // Saved maps
  for (let i = 0; i < savedMaps.length; i++) {
    items.push({ type: 'saved', idx: i, y: 0, h: boxH });
  }
  // Settings + version
  items.push({ type: 'settings', y: 0, h: TILE_SIZE * 2.5 });
  // Calculate positions
  let cy = startY;
  for (const item of items) {
    item.y = cy;
    cy += item.h + gap;
  }
  return { items, boxW, boxH, centerX, itemSize, descSize };
}

function drawMapSelect() {
  const layout = getMapSelectLayout();
  const { items, boxW, centerX, itemSize, descSize } = layout;
  const titleSize = Math.floor(TILE_SIZE * 1.5);

  // Title
  ctx.font = 'bold ' + titleSize + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#81d4fa';
  ctx.fillText('TOWER DEFENCE', centerX, TILE_SIZE * 2.5);

  // Store hit areas for click handling
  state._mapSelectItems = items;
  state._mapSelectBoxW = boxW;

  for (const item of items) {
    const y = item.y;
    const x = centerX - boxW / 2;

    if (item.type === 'play-empty') {
      // Play Empty map button
      ctx.fillStyle = '#111';
      ctx.fillRect(x, y, boxW, item.h);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, boxW, item.h);
      ctx.font = 'bold ' + itemSize + 'px monospace';
      ctx.fillStyle = '#4caf50';
      ctx.fillText('Play Empty Map', centerX, y + item.h * 0.4);
      ctx.font = descSize + 'px monospace';
      ctx.fillStyle = '#555';
      ctx.fillText('Open field, build freely', centerX, y + item.h * 0.75);

    } else if (item.type === 'new-map') {
      // New map button
      ctx.fillStyle = '#0a1a0a';
      ctx.fillRect(x, y, boxW, item.h);
      ctx.strokeStyle = '#4caf50';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, boxW, item.h);
      ctx.font = 'bold ' + itemSize + 'px monospace';
      ctx.fillStyle = '#4caf50';
      ctx.fillText('+ New Map', centerX, y + item.h * 0.4);
      ctx.font = descSize + 'px monospace';
      ctx.fillStyle = '#555';
      ctx.fillText('Open the map editor', centerX, y + item.h * 0.75);

    } else if (item.type === 'saved') {
      const map = savedMaps[item.idx];
      // Map box
      ctx.fillStyle = '#111';
      ctx.fillRect(x, y, boxW, item.h);
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, boxW, item.h);
      // Map name + Play
      ctx.font = 'bold ' + itemSize + 'px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(map.name, x + TILE_SIZE * 0.5, y + item.h * 0.35);
      // Edit button
      const btnW = TILE_SIZE * 3;
      const btnH = item.h * 0.5;
      const editX = x + boxW - btnW * 2 - TILE_SIZE * 0.5;
      const editY = y + (item.h - btnH) / 2;
      ctx.fillStyle = '#1a2a1a';
      ctx.fillRect(editX, editY, btnW, btnH);
      ctx.strokeStyle = '#4caf50';
      ctx.strokeRect(editX, editY, btnW, btnH);
      ctx.font = descSize + 'px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#4caf50';
      ctx.fillText('Edit', editX + btnW / 2, editY + btnH / 2);
      item._editBtn = { x: editX, y: editY, w: btnW, h: btnH };
      // Delete button
      const delX = x + boxW - btnW - TILE_SIZE * 0.3;
      ctx.fillStyle = '#2a0a0a';
      ctx.fillRect(delX, editY, btnW, btnH);
      ctx.strokeStyle = '#f44336';
      ctx.strokeRect(delX, editY, btnW, btnH);
      ctx.fillStyle = '#f44336';
      ctx.fillText('Del', delX + btnW / 2, editY + btnH / 2);
      item._delBtn = { x: delX, y: editY, w: btnW, h: btnH };
      // "Tap to play" hint + dimensions
      ctx.textAlign = 'left';
      ctx.fillStyle = '#555';
      const dims = (map.cols || 24) + 'x' + (map.rows || 48);
      ctx.fillText(dims + '  Tap to play', x + TILE_SIZE * 0.5, y + item.h * 0.75);
      ctx.textAlign = 'center';

    } else if (item.type === 'settings') {
      ctx.fillStyle = '#1a1a2a';
      ctx.fillRect(x, y, boxW, item.h);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, boxW, item.h);
      ctx.font = 'bold ' + itemSize + 'px monospace';
      ctx.fillStyle = '#888';
      ctx.fillText('Settings (S)', centerX, y + item.h / 2);
    }
  }

  // Version at bottom
  const lastItem = items[items.length - 1];
  ctx.font = descSize + 'px monospace';
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.fillText('v' + VERSION, centerX, lastItem.y + lastItem.h + TILE_SIZE);
}

function handleMapSelectClick(px, py) {
  const items = state._mapSelectItems;
  const boxW = state._mapSelectBoxW;
  if (!items) return;
  const centerX = CANVAS_W / 2;

  for (const item of items) {
    const x = centerX - boxW / 2;
    if (py < item.y || py > item.y + item.h) continue;
    if (px < x || px > x + boxW) continue;

    if (item.type === 'play-empty') {
      startGame(-1); // -1 = empty map
      return;
    }
    if (item.type === 'new-map') {
      openMapEditor(-1);
      return;
    }
    if (item.type === 'saved') {
      // Check edit/delete buttons first
      const eb = item._editBtn;
      if (eb && px >= eb.x && px <= eb.x + eb.w && py >= eb.y && py <= eb.y + eb.h) {
        openMapEditor(item.idx);
        return;
      }
      const db = item._delBtn;
      if (db && px >= db.x && px <= db.x + db.w && py >= db.y && py <= db.y + db.h) {
        deleteMap(item.idx);
        return;
      }
      // Tap on box = play
      startGame(item.idx);
      return;
    }
    if (item.type === 'settings') {
      openSettings();
      return;
    }
  }
}

function handleMapSelectKey(e) {
  switch (e.key) {
    case 's': case 'S': openSettings(); break;
    case 'n': case 'N': openMapEditor(-1); break;
    case 'e': case 'E':
      // Edit first saved map
      if (savedMaps.length > 0) openMapEditor(0);
      break;
    case ' ': case 'Enter':
      startGame(-1); // play empty
      e.preventDefault();
      break;
    default: {
      const n = parseInt(e.key);
      if (n === 0) { startGame(-1); } // 0 = empty
      else if (n >= 1 && n <= savedMaps.length) { startGame(n - 1); }
    }
  }
}

function drawMessage() {
  if (state.messageTimer <= 0) return;
  const fontSize = Math.max(10, Math.floor(TILE_SIZE * 0.7));
  const msgH = TILE_SIZE * 1.5;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, CANVAS_H / 2 - msgH / 2, CANVAS_W, msgH);
  ctx.font = fontSize + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(state.message, CANVAS_W / 2, CANVAS_H / 2);
  state.messageTimer--;
}

function drawUI() {
  // Update sticky HTML HUD
  document.getElementById('hud-gold').textContent = 'G:' + state.gold;
  document.getElementById('hud-lives').textContent = 'L:' + state.lives;
  document.getElementById('hud-wave').textContent = 'W:' + state.wave;
  document.getElementById('hud-score').textContent = 'S:' + state.score;
  document.getElementById('hud-version').textContent = 'v' + VERSION;
  const phaseEl = document.getElementById('hud-phase');
  phaseEl.textContent = state.phase === 'PLACE' ? 'PLACE TOWERS' : state.phase === 'WAVE' ? 'WAVE ' + state.wave : 'GAME OVER';
  phaseEl.style.color = state.phase === 'WAVE' ? '#ff9800' : state.phase === 'GAMEOVER' ? '#f44336' : '#4caf50';

  drawMessage();

  // Game over overlay
  if (state.phase === 'GAMEOVER') {
    const goFont = Math.floor(TILE_SIZE * 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = 'bold ' + goFont + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f44336';
    ctx.fillText('GAME OVER', CANVAS_W / 2, CANVAS_H / 2 - TILE_SIZE * 1.5);
    ctx.font = fontSize + 'px monospace';
    ctx.fillStyle = '#ccc';
    ctx.fillText('Score: ' + state.score, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = '#888';
    ctx.fillText('Refresh to restart', CANVAS_W / 2, CANVAS_H / 2 + TILE_SIZE * 1.5);
  }
}

// === WAKE LOCK ===
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); }
  catch (e) { /* user denied or not supported */ }
}
async function releaseWakeLock() {
  if (wakeLock) { await wakeLock.release(); wakeLock = null; }
}
// Re-acquire wake lock when page becomes visible again (lock auto-releases on tab switch)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.phase === 'WAVE') requestWakeLock();
});

// === GAME LOOP ===
function update() {
  state.frame++;
  updateSpawning();
  updateMonsters();
  updateTowers();
  updateProjectiles();
}

let lastTime = 0;
let accumulator = 0;

function gameLoop(timestamp) {
  const dt = timestamp - lastTime;
  lastTime = timestamp;
  accumulator += dt;

  while (accumulator >= TICK_RATE) {
    if (state.phase !== 'GAMEOVER' && state.phase !== 'MAP_SELECT') {
      update();
    }
    accumulator -= TICK_RATE;
  }

  render();
  requestAnimationFrame(gameLoop);
}

// === SETTINGS ===
function esc(s) { return s.replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// Track which detail view is open
let settingsDetail = { type: null, index: -1 };

function openSettings() {
  document.getElementById('settings').style.display = 'flex';
  canvas.style.display = 'none';
  showSettingsList();
}

function closeSettings() {
  readSettings();
  localStorage.setItem('td-config', JSON.stringify(CONFIG));
  document.getElementById('settings').style.display = 'none';
  canvas.style.display = 'block';
  enterMapSelect();
}

function resetSettings() {
  CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  localStorage.removeItem('td-config');
  showSettingsList();
}

function exportData() {
  readSettings();
  const data = JSON.stringify({ config: CONFIG, maps: savedMaps }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tower-defence-data.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.config && data.config.towers && data.config.monsters && data.config.waves && data.config.game) {
          CONFIG = data.config;
          localStorage.setItem('td-config', JSON.stringify(CONFIG));
        }
        if (Array.isArray(data.maps)) {
          savedMaps = data.maps;
          saveMapsToStorage();
        }
        showSettingsList();
        showMessage('Imported!');
      } catch(e) {
        showMessage('Invalid file');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

// === SETTINGS LIST VIEW ===

function showSettingsList() {
  settingsDetail = { type: null, index: -1 };
  document.getElementById('settings-list').style.display = '';
  document.getElementById('settings-detail').style.display = 'none';
  populateSettingsList();
}

function populateSettingsList() {
  // Towers
  const towersDiv = document.getElementById('settings-towers');
  towersDiv.innerHTML = '';
  CONFIG.towers.forEach((t, i) => {
    towersDiv.appendChild(createListItem(t.color, t.letter, t.name, () => openDetail('tower', i)));
  });

  // Monsters
  const monstersDiv = document.getElementById('settings-monsters');
  monstersDiv.innerHTML = '';
  CONFIG.monsters.forEach((m, i) => {
    monstersDiv.appendChild(createListItem(m.color, m.letter, m.name, () => openDetail('monster', i)));
  });

  // Waves
  populateWaveFields();

  // Game
  document.getElementById('cfg-startGold').value = CONFIG.game.startGold;
  document.getElementById('cfg-startLives').value = CONFIG.game.startLives;
  document.getElementById('cfg-waveBonusGold').value = CONFIG.game.waveBonusGold;
}

function createListItem(color, letter, name, onClick) {
  const div = document.createElement('div');
  div.className = 'cfg-list-item';
  div.innerHTML =
    '<div class="cfg-swatch" style="background:' + color + '">' + esc(letter) + '</div>' +
    '<span class="cfg-list-name">' + esc(name) + '</span>' +
    '<span class="cfg-list-arrow">&#9654;</span>';
  div.addEventListener('click', onClick);
  return div;
}

function populateWaveFields() {
  const wavesDiv = document.getElementById('settings-wave-monsters');
  wavesDiv.innerHTML = '';
  CONFIG.monsters.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'cfg-row';
    div.innerHTML =
      '<span style="color:' + m.color + '">' + esc(m.name) + '</span>' +
      '<label>Count <input type="number" class="wv-base" min="0" value="' + (CONFIG.waves.baseCounts[i] || 0) + '"></label>' +
      '<label>Unlock wave <input type="number" class="wv-unlock" min="1" value="' + (CONFIG.waves.unlockWave[i] || 1) + '"></label>';
    wavesDiv.appendChild(div);
  });
  document.getElementById('cfg-scaleEvery').value = CONFIG.waves.scaleEvery;
  document.getElementById('cfg-hpScale').value = CONFIG.waves.hpScale ?? 20;
  document.getElementById('cfg-intervalStart').value = CONFIG.waves.intervalStart;
  document.getElementById('cfg-intervalDecay').value = CONFIG.waves.intervalDecay;
  document.getElementById('cfg-intervalMin').value = CONFIG.waves.intervalMin;
}

// === SETTINGS DETAIL VIEW ===

function openDetail(type, index) {
  // Save wave/game fields before switching
  readSettings();
  settingsDetail = { type, index };
  document.getElementById('settings-list').style.display = 'none';
  document.getElementById('settings-detail').style.display = 'flex';

  const title = document.getElementById('settings-detail-title');
  const body = document.getElementById('settings-detail-body');
  body.innerHTML = '';

  if (type === 'tower') {
    title.textContent = 'Tower: ' + CONFIG.towers[index].name;
    body.appendChild(createTowerFields(CONFIG.towers[index]));
  } else {
    title.textContent = 'Monster: ' + CONFIG.monsters[index].name;
    body.appendChild(createMonsterFields(CONFIG.monsters[index]));
  }
}

function closeDetail() {
  const { type, index } = settingsDetail;
  const body = document.getElementById('settings-detail-body');
  const div = body.querySelector('.cfg-item');
  if (div && type === 'tower') {
    CONFIG.towers[index] = readTowerFromForm(div);
  } else if (div && type === 'monster') {
    CONFIG.monsters[index] = readMonsterFromForm(div);
  }
  showSettingsList();
}

function deleteDetailItem() {
  const { type, index } = settingsDetail;
  if (type === 'tower') {
    if (CONFIG.towers.length <= 1) return;
    CONFIG.towers.splice(index, 1);
  } else if (type === 'monster') {
    if (CONFIG.monsters.length <= 1) return;
    CONFIG.monsters.splice(index, 1);
    CONFIG.waves.baseCounts.splice(index, 1);
    CONFIG.waves.unlockWave.splice(index, 1);
  }
  showSettingsList();
}

function createTowerFields(t) {
  const div = document.createElement('div');
  div.className = 'cfg-item';
  const dtVal = t.damageType || 'physical';
  let dtOpts = '';
  for (const dt of DAMAGE_TYPES) {
    dtOpts += '<option value="' + dt + '"' + (dt === dtVal ? ' selected' : '') + '>' + dt.charAt(0).toUpperCase() + dt.slice(1) + '</option>';
  }
  const adVal = t.attackDir || 'any';
  div.innerHTML =
    '<div class="cfg-row">' +
      '<label>Name <input type="text" class="tw-name" value="' + esc(t.name) + '"></label>' +
      '<label>Letter <input type="text" class="tw-letter" maxlength="1" value="' + esc(t.letter) + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>Color <input type="color" class="tw-color" value="' + t.color + '"></label>' +
      '<label>BG <input type="color" class="tw-bg" value="' + t.bg + '"></label>' +
      '<label>W <input type="number" class="tw-sizeW" min="1" max="4" value="' + (t.sizeW || 2) + '"></label>' +
      '<label>H <input type="number" class="tw-sizeH" min="1" max="4" value="' + (t.sizeH || 2) + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>Range <input type="number" class="tw-range" min="0" value="' + t.range + '"></label>' +
      '<label>Damage <input type="number" class="tw-damage" min="0" value="' + t.damage + '"></label>' +
      '<label>Fire Rate <input type="number" class="tw-fireRate" min="1" value="' + t.fireRate + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>Cost <input type="number" class="tw-cost" min="0" value="' + t.cost + '"></label>' +
      '<label>HP <input type="number" class="tw-hp" min="1" value="' + t.hp + '"></label>' +
      '<label>Dmg Type <select class="tw-damageType">' + dtOpts + '</select></label>' +
      '<label>Attack <select class="tw-attackDir">' +
        '<option value="any"' + (adVal === 'any' ? ' selected' : '') + '>Any</option>' +
        '<option value="fixed"' + (adVal === 'fixed' ? ' selected' : '') + '>Fixed</option>' +
      '</select></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label><input type="checkbox" class="tw-pierce"' + (t.pierce ? ' checked' : '') + '> Pierce</label>' +
      '<label><input type="checkbox" class="tw-hasDot"' + (t.dot ? ' checked' : '') + '> DOT</label>' +
    '</div>' +
    '<div class="cfg-row cfg-dot-fields"' + (t.dot ? '' : ' style="display:none"') + '>' +
      '<label>DOT DPS <input type="number" class="tw-dotDps" min="0" step="0.1" value="' + (t.dot ? t.dot.dps : 1) + '"></label>' +
      '<label>DOT Duration <input type="number" class="tw-dotDur" min="1" value="' + (t.dot ? t.dot.duration : 90) + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>Speed Factor <input type="number" class="tw-speedFactor" min="0" step="0.1" value="' + (t.speedFactor || 1) + '"></label>' +
      '<label>Speed Dur <input type="number" class="tw-speedDuration" min="1" value="' + (t.speedDuration || 60) + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>Splash Radius <input type="number" class="tw-splashRadius" min="0" step="0.5" value="' + (t.splashRadius || 0) + '"></label>' +
      '<label>Projectile Spd <input type="number" class="tw-projectileSpeed" min="0" step="0.01" value="' + (t.projectileSpeed || 0) + '"></label>' +
    '</div>';
  div.querySelector('.tw-hasDot').addEventListener('change', function() {
    div.querySelector('.cfg-dot-fields').style.display = this.checked ? '' : 'none';
  });
  return div;
}

function createMonsterFields(m) {
  const div = document.createElement('div');
  div.className = 'cfg-item';
  let modInputs = '';
  const mods = m.damageModifiers || {};
  for (const dt of DAMAGE_TYPES) {
    const val = mods[dt] ?? 1;
    const label = dt.charAt(0).toUpperCase() + dt.slice(1, 4);
    modInputs += '<label>' + label + ' x<input type="number" class="mo-mod-' + dt + '" min="0" step="0.1" value="' + val + '"></label>';
  }
  div.innerHTML =
    '<div class="cfg-row">' +
      '<label>Name <input type="text" class="mo-name" value="' + esc(m.name) + '"></label>' +
      '<label>Letter <input type="text" class="mo-letter" maxlength="1" value="' + esc(m.letter) + '"></label>' +
      '<label>Color <input type="color" class="mo-color" value="' + m.color + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>HP <input type="number" class="mo-hp" min="1" value="' + m.hp + '"></label>' +
      '<label>Speed <input type="number" class="mo-speed" min="0.01" step="0.01" value="' + m.speed + '"></label>' +
      '<label>Reward <input type="number" class="mo-reward" min="0" value="' + m.reward + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' + modInputs + '</div>';
  return div;
}

// === READ FORM DATA ===

function readTowerFromForm(div) {
  const t = {
    name: div.querySelector('.tw-name').value,
    letter: div.querySelector('.tw-letter').value || '?',
    color: div.querySelector('.tw-color').value,
    bg: div.querySelector('.tw-bg').value,
    range: +div.querySelector('.tw-range').value,
    damage: +div.querySelector('.tw-damage').value,
    fireRate: +div.querySelector('.tw-fireRate').value || 1,
    cost: +div.querySelector('.tw-cost').value,
    hp: +div.querySelector('.tw-hp').value || 1,
  };
  if (div.querySelector('.tw-pierce').checked) t.pierce = true;
  if (div.querySelector('.tw-hasDot').checked) {
    t.dot = {
      dps: +div.querySelector('.tw-dotDps').value || 1,
      duration: +div.querySelector('.tw-dotDur').value || 90,
    };
  }
  t.damageType = div.querySelector('.tw-damageType').value || 'physical';
  const sf = +div.querySelector('.tw-speedFactor').value;
  if (sf && sf !== 1) t.speedFactor = sf;
  const sd = +div.querySelector('.tw-speedDuration').value;
  if (sd && sd !== 60) t.speedDuration = sd;
  const sr = +div.querySelector('.tw-splashRadius').value;
  if (sr > 0) t.splashRadius = sr;
  const ps = +div.querySelector('.tw-projectileSpeed').value;
  if (ps > 0) t.projectileSpeed = ps;
  t.sizeW = +div.querySelector('.tw-sizeW').value || 2;
  t.sizeH = +div.querySelector('.tw-sizeH').value || 2;
  if (div.querySelector('.tw-attackDir').value === 'fixed') t.attackDir = 'fixed';
  return t;
}

function readMonsterFromForm(div) {
  const m = {
    name: div.querySelector('.mo-name').value,
    letter: div.querySelector('.mo-letter').value || '?',
    color: div.querySelector('.mo-color').value,
    hp: +div.querySelector('.mo-hp').value || 1,
    speed: +div.querySelector('.mo-speed').value || 0.05,
    reward: +div.querySelector('.mo-reward').value || 1,
  };
  const mods = {};
  let hasNonDefault = false;
  for (const dt of DAMAGE_TYPES) {
    const el = div.querySelector('.mo-mod-' + dt);
    if (el) {
      const val = +el.value;
      if (!isNaN(val) && val !== 1) {
        mods[dt] = val;
        hasNonDefault = true;
      }
    }
  }
  if (hasNonDefault) m.damageModifiers = mods;
  return m;
}

function readSettings() {
  // Read waves
  const baseDivs = document.querySelectorAll('#settings-wave-monsters .cfg-row');
  CONFIG.waves.baseCounts = Array.from(baseDivs).map(d => +d.querySelector('.wv-base').value || 0);
  CONFIG.waves.unlockWave = Array.from(baseDivs).map(d => +d.querySelector('.wv-unlock').value || 1);
  CONFIG.waves.scaleEvery = +document.getElementById('cfg-scaleEvery').value || 2;
  CONFIG.waves.hpScale = +document.getElementById('cfg-hpScale').value || 0;
  CONFIG.waves.intervalStart = +document.getElementById('cfg-intervalStart').value || 40;
  CONFIG.waves.intervalDecay = +document.getElementById('cfg-intervalDecay').value || 3;
  CONFIG.waves.intervalMin = +document.getElementById('cfg-intervalMin').value || 10;

  // Read game
  CONFIG.game.startGold = +document.getElementById('cfg-startGold').value || 50;
  CONFIG.game.startLives = +document.getElementById('cfg-startLives').value || 20;
  CONFIG.game.waveBonusGold = +document.getElementById('cfg-waveBonusGold').value || 10;
}

function addTowerType() {
  readSettings();
  CONFIG.towers.push({ name: 'New', letter: 'X', color: '#ffffff', bg: '#444444', range: 2, damage: 1, fireRate: 30, cost: 10, hp: 5, damageType: 'physical', sizeW: 2, sizeH: 2 });
  openDetail('tower', CONFIG.towers.length - 1);
}

function addMonsterType() {
  readSettings();
  CONFIG.monsters.push({ name: 'New', letter: '?', color: '#ffffff', hp: 10, speed: 0.08, reward: 5 });
  CONFIG.waves.baseCounts.push(1);
  CONFIG.waves.unlockWave.push(CONFIG.monsters.length);
  openDetail('monster', CONFIG.monsters.length - 1);
}

// === INIT ===
function startGame(mapIdx) {
  // mapIdx: -1 = empty, 0+ = index into savedMaps
  if (mapIdx >= 0 && savedMaps[mapIdx]) {
    const map = savedMaps[mapIdx];
    resizeGrid(map.cols || 24, map.rows || 48);
    loadGroundFromMap(map.data);
  } else {
    resizeGrid(15, 15);
  }
  startGameWithGround();
}

function rebuildTowerButtons() {
  const container = document.getElementById('tower-buttons');
  container.innerHTML = '';
  CONFIG.towers.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.dataset.tower = i;
    btn.textContent = (i + 1) + ': ' + t.name + ' (' + t.cost + 'g)';
    if (i === state.selectedTower) btn.classList.add('selected');
    btn.addEventListener('click', () => selectTowerType(i));
    container.appendChild(btn);
  });
}

function init() {
  document.getElementById('hud').style.display = 'none';
  document.getElementById('ui').style.display = 'none';
  document.getElementById('editor-ui').style.display = 'none';
  enterMapSelect();
  setupInput();
  requestAnimationFrame(gameLoop);
}

init();
