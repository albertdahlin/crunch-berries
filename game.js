// === CONSTANTS ===
const VERSION = '__VERSION__';
const COLS = 24;
const ROWS = 48;
const FPS = 30;
const TICK_RATE = 1000 / FPS;

// Tile size derived from viewport width so the board fills the screen width
let TILE_SIZE, CANVAS_W, CANVAS_H;

// === CONFIG (data-driven, editable via settings) ===
const DEFAULT_CONFIG = {
  towers: [
    { name: 'Melee',     letter: 'M', color: '#4fc3f7', bg: '#1565c0', range: 1, damage: 3, fireRate: 15, cost: 10, hp: 10 },
    { name: 'Range',     letter: 'R', color: '#fff176', bg: '#f57f17', range: 4, damage: 2, fireRate: 30, cost: 15, hp: 5  },
    { name: 'DOT',       letter: 'D', color: '#81c784', bg: '#2e7d32', range: 1, damage: 0, fireRate: 30, cost: 20, hp: 8, dot: { dps: 1, duration: 90 } },
    { name: 'Pierce',    letter: 'P', color: '#ce93d8', bg: '#6a1b9a', range: 5, damage: 1, fireRate: 45, cost: 25, hp: 5, pierce: true },
    { name: 'Barricade', letter: 'B', color: '#90a4ae', bg: '#455a64', range: 0, damage: 0, fireRate: 9999, cost: 3, hp: 15, barricade: true },
  ],
  monsters: [
    { name: 'Normal', letter: 'N', color: '#ef5350', hp: 12, speed: 0.08, reward: 5  },
    { name: 'Fast',   letter: 'F', color: '#ff8a65', hp: 6,  speed: 0.16, reward: 7  },
    { name: 'Tank',   letter: 'H', color: '#ab47bc', hp: 30, speed: 0.05, reward: 12 },
  ],
  waves: {
    baseCounts: [6, 3, 2],
    unlockWave: [1, 2, 3],
    scaleEvery: 2,
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
  return { counts, interval };
}

// === GROUND TYPES ===
const GROUND_GRASS = 0;
const GROUND_ROAD  = 1;
const GROUND_WATER = 2;
const GROUND_SWAMP = 3;
const GROUND_ROCK  = 4;

const GROUND_WALKABLE   = [true, true, false, true, false];   // can monsters walk?
const GROUND_BUILDABLE  = [true, false, false, false, true];   // can towers be placed?
const GROUND_SPEED_MULT = [1.0, 1.0, 1.0, 0.5, 1.0];         // monster speed multiplier

const GROUND_BG         = ['#1a2a1a', '#2a2a2a', '#0a1a3a', '#2a2a0a', '#2a2a2a'];
const GROUND_CHAR       = ['', '', '~', ',', '#'];
const GROUND_CHAR_COLOR = ['', '', '#1a3a6a', '#4a4a1a', '#3a3a3a'];

// === MAPS ===
const MAPS = [
  {
    name: 'Empty',
    desc: 'Open field, build freely',
    setup: function() { /* all grass, road at top/bottom set by startGame */ }
  },
  {
    name: 'Corridor',
    desc: 'Rock walls form corridors',
    setup: function() {
      const wallX1 = 6;
      const wallX2 = 16;
      for (let y = 2; y < ROWS - 2; y++) {
        if (y % 20 < 16) {
          for (let x = wallX1; x < wallX1 + 2; x++)
            ground[y * COLS + x] = GROUND_ROCK;
        }
        if ((y + 10) % 20 < 16) {
          for (let x = wallX2; x < wallX2 + 2; x++)
            ground[y * COLS + x] = GROUND_ROCK;
        }
      }
      // Add some swamp patches in corridor paths
      for (let y = 8; y < ROWS - 8; y += 12) {
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            const x = 10 + dx;
            if (ground[(y + dy) * COLS + x] === GROUND_GRASS)
              ground[(y + dy) * COLS + x] = GROUND_SWAMP;
          }
        }
      }
    }
  },
  {
    name: 'Random',
    desc: 'Mixed terrain',
    setup: function() {
      const terrainTypes = [GROUND_WATER, GROUND_ROCK, GROUND_SWAMP];
      let placed = 0;
      let attempts = 0;
      while (placed < 50 && attempts < 400) {
        attempts++;
        const x = Math.floor(Math.random() * COLS);
        const y = 2 + Math.floor(Math.random() * (ROWS - 4));
        const gt = terrainTypes[Math.floor(Math.random() * terrainTypes.length)];
        if (ground[y * COLS + x] !== GROUND_GRASS) continue;
        // Tentatively place
        ground[y * COLS + x] = gt;
        // Validate path if non-walkable
        if (!GROUND_WALKABLE[gt] && !isTopRowReachable()) {
          ground[y * COLS + x] = GROUND_GRASS;
          continue;
        }
        placed++;
        // Cluster: place 1-3 more of same type adjacent
        for (let c = 0; c < 3; c++) {
          const nx = x + Math.floor(Math.random() * 3) - 1;
          const ny = y + Math.floor(Math.random() * 3) - 1;
          if (nx < 0 || nx >= COLS || ny < 2 || ny >= ROWS - 2) continue;
          if (ground[ny * COLS + nx] !== GROUND_GRASS) continue;
          ground[ny * COLS + nx] = gt;
          if (!GROUND_WALKABLE[gt] && !isTopRowReachable()) {
            ground[ny * COLS + nx] = GROUND_GRASS;
          }
        }
      }
    }
  },
  {
    name: 'Winding',
    desc: 'Follow the road',
    setup: function() {
      // Generate winding road path
      const isRoad = new Uint8Array(COLS * ROWS);
      const roadW = 4;
      let cx = 2;
      let dir = 1;
      for (let y = 2; y < ROWS - 2; y++) {
        for (let dx = 0; dx < roadW; dx++) {
          const rx = cx + dx;
          if (rx >= 0 && rx < COLS) isRoad[y * COLS + rx] = 1;
        }
        if (y % 10 === 0 && y > 2 && y < ROWS - 4) {
          dir = -dir;
          const newCx = dir > 0 ? 2 : COLS - roadW - 2;
          const minX = Math.min(cx, newCx);
          const maxX = Math.max(cx + roadW, newCx + roadW);
          for (let x = minX; x < maxX; x++) {
            if (x >= 0 && x < COLS) {
              isRoad[y * COLS + x] = 1;
              isRoad[(y + 1) * COLS + x] = 1;
            }
          }
          cx = newCx;
          y++;
          for (let dx = 0; dx < roadW; dx++) {
            const rx = cx + dx;
            if (rx >= 0 && rx < COLS) isRoad[y * COLS + rx] = 1;
          }
        }
      }
      // Top and bottom rows are road (already set by startGame)
      for (let x = 0; x < COLS; x++) {
        isRoad[x] = 1;
        isRoad[(ROWS - 1) * COLS + x] = 1;
      }
      // Mark road tiles and fill non-road with terrain
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const idx = y * COLS + x;
          if (isRoad[idx]) {
            ground[idx] = GROUND_ROAD;
          } else if (y >= 2 && y < ROWS - 2) {
            // Fill with mixed terrain
            const r = Math.random();
            if (r < 0.55) ground[idx] = GROUND_ROCK;
            else if (r < 0.80) ground[idx] = GROUND_WATER;
            else ground[idx] = GROUND_SWAMP;
          }
        }
      }
    }
  },
  {
    name: 'Swamp Road',
    desc: 'Road through swamp, slow off-road',
    setup: function() {
      // Fill everything with swamp first (rows 1 to ROWS-2)
      for (let y = 1; y < ROWS - 1; y++)
        for (let x = 0; x < COLS; x++)
          ground[y * COLS + x] = GROUND_SWAMP;

      // Generate a winding road through the swamp
      const roadW = 3;
      let cx = Math.floor(COLS / 2) - 1;
      let drift = 0;
      for (let y = 1; y < ROWS - 1; y++) {
        // Lay road tiles
        for (let dx = 0; dx < roadW; dx++) {
          const rx = cx + dx;
          if (rx >= 0 && rx < COLS) ground[y * COLS + rx] = GROUND_ROAD;
        }
        // Wander left/right
        drift += (Math.random() - 0.5) * 1.8;
        if (drift > 1) { cx++; drift = 0; }
        else if (drift < -1) { cx--; drift = 0; }
        // Stay in bounds
        cx = Math.max(1, Math.min(COLS - roadW - 1, cx));
        // Occasional sharp turn
        if (y % 8 === 0 && y > 2 && y < ROWS - 4) {
          const turn = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.floor(Math.random() * 3));
          const newCx = Math.max(1, Math.min(COLS - roadW - 1, cx + turn));
          // Horizontal bridge
          const minX = Math.min(cx, newCx);
          const maxX = Math.max(cx + roadW, newCx + roadW);
          for (let bx = minX; bx < maxX; bx++) {
            if (bx >= 0 && bx < COLS) {
              ground[y * COLS + bx] = GROUND_ROAD;
              if (y + 1 < ROWS - 1) ground[(y + 1) * COLS + bx] = GROUND_ROAD;
            }
          }
          cx = newCx;
        }
      }
      // Scatter water pools in the swamp
      for (let i = 0; i < 25; i++) {
        const wx = Math.floor(Math.random() * COLS);
        const wy = 2 + Math.floor(Math.random() * (ROWS - 4));
        if (ground[wy * COLS + wx] !== GROUND_SWAMP) continue;
        ground[wy * COLS + wx] = GROUND_WATER;
        if (!isTopRowReachable()) {
          ground[wy * COLS + wx] = GROUND_SWAMP;
          continue;
        }
        // Cluster a few more
        for (let c = 0; c < 2; c++) {
          const nx = wx + Math.floor(Math.random() * 3) - 1;
          const ny = wy + Math.floor(Math.random() * 3) - 1;
          if (nx < 0 || nx >= COLS || ny < 2 || ny >= ROWS - 2) continue;
          if (ground[ny * COLS + nx] !== GROUND_SWAMP) continue;
          ground[ny * COLS + nx] = GROUND_WATER;
          if (!isTopRowReachable()) ground[ny * COLS + nx] = GROUND_SWAMP;
        }
      }
      // Add some rock outcrops (buildable islands in the swamp)
      for (let i = 0; i < 12; i++) {
        const rx = Math.floor(Math.random() * (COLS - 2)) + 1;
        const ry = 3 + Math.floor(Math.random() * (ROWS - 6));
        if (ground[ry * COLS + rx] !== GROUND_SWAMP) continue;
        ground[ry * COLS + rx] = GROUND_ROCK;
        if (!isTopRowReachable()) { ground[ry * COLS + rx] = GROUND_SWAMP; continue; }
        // Small cluster
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const nx = rx + dx, ny = ry + dy;
            if (nx >= COLS || ny >= ROWS - 2) continue;
            if (ground[ny * COLS + nx] !== GROUND_SWAMP) continue;
            ground[ny * COLS + nx] = GROUND_ROCK;
            if (!isTopRowReachable()) ground[ny * COLS + nx] = GROUND_SWAMP;
          }
        }
      }
    }
  },
];

function placeMapBarricade(x, y) {
  // Verify ground allows building on all 4 tiles
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++)
      if (!GROUND_BUILDABLE[ground[(y + dy) * COLS + (x + dx)]]) return;
  const barricadeIdx = CONFIG.towers.findIndex(t => t.barricade);
  if (barricadeIdx === -1) return;
  const type = CONFIG.towers[barricadeIdx];
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++)
      grid[(y + dy) * COLS + (x + dx)] = 1;
  state.towers.push({
    x: x, y: y,
    typeIdx: barricadeIdx,
    hp: type.hp,
    maxHp: type.hp,
    lastFire: 0,
  });
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
const grid = new Uint8Array(COLS * ROWS);    // 0=empty, 1=tower
const ground = new Uint8Array(COLS * ROWS);  // GROUND_* terrain type per tile
const state = {
  towers: [],
  monsters: [],
  effects: [],      // visual effects [{x,y,tx,ty,ttl,color}]
  cursor: { x: 12, y: 24, visible: false },
  selectedTower: 0,
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
function canPlaceTower(tx, ty) {
  if (tx < 0 || tx + 1 >= COLS || ty < 0 || ty + 1 >= ROWS) return false;
  // Don't place on spawn row (y=0) or goal row (y=ROWS-1)
  if (ty < 1 || ty + 1 >= ROWS - 1) return false;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
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
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++)
      tempGrid[(ty + dy) * COLS + (tx + dx)] = 1;

  // Check if path still exists
  const pathBlocked = !isTopRowReachable(tempGrid);

  // Commit placement
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++)
      grid[(ty + dy) * COLS + (tx + dx)] = 1;

  state.towers.push({
    x: tx, y: ty,
    typeIdx: state.selectedTower,
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
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++)
      grid[(tower.y + dy) * COLS + (tower.x + dx)] = 0;
  recomputePath();
}

function distToTower(mx, my, tower) {
  // Distance from monster to nearest tile of the 2x2 tower
  const cx = Math.max(tower.x, Math.min(tower.x + 1, Math.floor(mx)));
  const cy = Math.max(tower.y, Math.min(tower.y + 1, Math.floor(my)));
  return Math.abs(mx - cx) + Math.abs(my - cy);
}

function updateTowers() {
  for (const tower of state.towers) {
    const type = CONFIG.towers[tower.typeIdx];
    if (type.barricade) continue;
    if (state.frame - tower.lastFire < type.fireRate) continue;

    const tcx = tower.x + 1;  // center of 2x2
    const tcy = tower.y + 1;

    if (type.pierce) {
      // Find nearest monster to determine direction
      let nearest = null;
      let nearDist = Infinity;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        const d = Math.hypot(m.x - tcx, m.y - tcy);
        if (d < nearDist && d <= type.range + 1) {
          nearDist = d;
          nearest = m;
        }
      }
      if (!nearest) continue;

      // Pick cardinal direction (using 8-dir indices: 0=up, 2=right, 4=down, 6=left)
      const dx = nearest.x - tcx;
      const dy = nearest.y - tcy;
      let dir;
      if (Math.abs(dx) > Math.abs(dy)) {
        dir = dx > 0 ? 2 : 6;
      } else {
        dir = dy > 0 ? 4 : 0;
      }

      // Hit all monsters in the corridor
      let hit = false;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        const rx = m.x - tcx;
        const ry = m.y - tcy;
        let inCorridor = false;
        if (dir === 0 && Math.abs(rx) < 1 && ry >= -type.range && ry <= 0) inCorridor = true;
        if (dir === 4 && Math.abs(rx) < 1 && ry >= 0 && ry <= type.range) inCorridor = true;
        if (dir === 2 && Math.abs(ry) < 1 && rx >= 0 && rx <= type.range) inCorridor = true;
        if (dir === 6 && Math.abs(ry) < 1 && rx >= -type.range && rx <= 0) inCorridor = true;
        if (inCorridor) {
          m.hp -= type.damage;
          hit = true;
        }
      }
      if (hit) {
        tower.lastFire = state.frame;
        // Effect line
        const ex = tcx + DX[dir] * type.range;
        const ey = tcy + DY[dir] * type.range;
        state.effects.push({ x: tcx, y: tcy, tx: ex, ty: ey, ttl: 4, color: type.color });
      }

    } else if (type.dot) {
      // DOT tower: apply DOT to nearest in range
      let nearest = null;
      let nearDist = Infinity;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        const d = distToTower(m.x, m.y, tower);
        if (d < nearDist && d <= type.range + 1) {
          nearDist = d;
          nearest = m;
        }
      }
      if (!nearest) continue;
      tower.lastFire = state.frame;
      // Apply/refresh DOT (doesn't stack)
      nearest.dot = { dps: type.dot.dps, remaining: type.dot.duration };
      state.effects.push({ x: tcx, y: tcy, tx: nearest.x, ty: nearest.y, ttl: 4, color: type.color });

    } else {
      // Single-target (Melee / Range)
      let nearest = null;
      let nearDist = Infinity;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        const d = (type.range <= 1) ? distToTower(m.x, m.y, tower) : Math.hypot(m.x - tcx, m.y - tcy);
        if (d < nearDist && d <= type.range + 1) {
          nearDist = d;
          nearest = m;
        }
      }
      if (!nearest) continue;
      tower.lastFire = state.frame;
      nearest.hp -= type.damage;
      state.effects.push({ x: tcx, y: tcy, tx: nearest.x, ty: nearest.y, ttl: 4, color: type.color });
    }
  }
}

// === MONSTER LOGIC ===
function spawnMonster(typeIdx) {
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

  state.monsters.push({
    x: sx + 0.3 + Math.random() * 0.4,
    y: 0.3 + Math.random() * 0.4,
    hp: type.hp,
    maxHp: type.hp,
    speed: type.speed,
    typeIdx: typeIdx,
    reward: type.reward,
    letter: type.letter,
    color: type.color,
    attacking: null,
    dot: null,
    renderScale: 0.8 + Math.random() * 0.4,  // 0.8 to 1.2
  });
}

function updateMonsters() {
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;

    // DOT damage
    if (m.dot) {
      m.hp -= m.dot.dps / FPS;
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
    const speedMult = GROUND_SPEED_MULT[ground[idx]] || 1.0;
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
        const tcx = m.attacking.x + 1;
        const tcy = m.attacking.y + 1;
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
    for (let j = 0; j < count; j++) spawnMonster(i);
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
function setupInput() {
  // Mouse
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    state.cursor.x = Math.floor((e.clientX - rect.left) * scaleX / TILE_SIZE);
    state.cursor.y = Math.floor((e.clientY - rect.top) * scaleY / TILE_SIZE);
    state.cursor.x = Math.max(0, Math.min(COLS - 2, state.cursor.x));
    state.cursor.y = Math.max(0, Math.min(ROWS - 2, state.cursor.y));
    state.cursor.visible = true;
  });

  canvas.addEventListener('mouseleave', () => {
    state.cursor.visible = false;
  });

  // On touch devices, disable canvas click entirely (use Place button instead)
  let isTouchDevice = false;
  canvas.addEventListener('click', (e) => {
    if (isTouchDevice) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    if (state.phase === 'MAP_SELECT') {
      const boxH = TILE_SIZE * 4;
      const startY = TILE_SIZE * 6;
      for (let i = 0; i < MAPS.length; i++) {
        const y = startY + i * (boxH + TILE_SIZE);
        if (clickY >= y && clickY <= y + boxH) {
          state.selectedMap = i;
          startGame(i);
          return;
        }
      }
      // Check settings button
      const sb = state._settingsBtn;
      if (sb && clickX >= sb.x && clickX <= sb.x + sb.w && clickY >= sb.y && clickY <= sb.y + sb.h) {
        openSettings();
      }
      return;
    }

    state.cursor.x = Math.floor(clickX / TILE_SIZE);
    state.cursor.y = Math.floor(clickY / TILE_SIZE);
    state.cursor.x = Math.max(0, Math.min(COLS - 2, state.cursor.x));
    state.cursor.y = Math.max(0, Math.min(ROWS - 2, state.cursor.y));
    placeTower();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (state.phase === 'MAP_SELECT') {
      switch (e.key) {
        case 'ArrowUp': state.selectedMap = Math.max(0, state.selectedMap - 1); e.preventDefault(); break;
        case 'ArrowDown': state.selectedMap = Math.min(MAPS.length - 1, state.selectedMap + 1); e.preventDefault(); break;
        case ' ': case 'Enter': startGame(state.selectedMap); e.preventDefault(); break;
        case 's': case 'S': openSettings(); break;
        default: {
          const i = parseInt(e.key) - 1;
          if (i >= 0 && i < MAPS.length) { state.selectedMap = i; startGame(i); }
        }
      }
      return;
    }
    switch (e.key) {
      case 'ArrowUp':    state.cursor.y = Math.max(0, state.cursor.y - 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowDown':  state.cursor.y = Math.min(ROWS - 2, state.cursor.y + 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowLeft':  state.cursor.x = Math.max(0, state.cursor.x - 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowRight': state.cursor.x = Math.min(COLS - 2, state.cursor.x + 1); state.cursor.visible = true; e.preventDefault(); break;
      case ' ': case 'Enter': placeTower(); e.preventDefault(); break;
      case 'w': case 'W': startWave(); break;
      default: {
        const n = parseInt(e.key);
        if (n >= 1 && n <= CONFIG.towers.length) selectTowerType(n - 1);
      }
    }
  });

  // Touch - use touchend to allow scrolling; only set cursor if it was a tap (not a drag)
  let touchStartPos = null;
  canvas.addEventListener('touchstart', (e) => {
    isTouchDevice = true;
    const touch = e.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (!touchStartPos) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartPos.x;
    const dy = touch.clientY - touchStartPos.y;
    touchStartPos = null;
    // Ignore if it was a scroll/drag (moved more than 10px)
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const tapX = (touch.clientX - rect.left) * scaleX;
    const tapY = (touch.clientY - rect.top) * scaleY;

    if (state.phase === 'MAP_SELECT') {
      // Check which map box was tapped
      const boxH = TILE_SIZE * 4;
      const startY = TILE_SIZE * 6;
      for (let i = 0; i < MAPS.length; i++) {
        const y = startY + i * (boxH + TILE_SIZE);
        if (tapY >= y && tapY <= y + boxH) {
          state.selectedMap = i;
          startGame(i);
          return;
        }
      }
      // Check settings button
      const sb = state._settingsBtn;
      if (sb && tapX >= sb.x && tapX <= sb.x + sb.w && tapY >= sb.y && tapY <= sb.y + sb.h) {
        openSettings();
      }
      return;
    }

    const tx = Math.floor(tapX / TILE_SIZE);
    const ty = Math.floor(tapY / TILE_SIZE);
    state.cursor.x = Math.max(0, Math.min(COLS - 2, tx));
    state.cursor.y = Math.max(0, Math.min(ROWS - 2, ty));
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
    document.getElementById('ui').style.display = 'none';
    openSettings();
  });
}

function selectTowerType(idx) {
  if (idx >= 0 && idx < CONFIG.towers.length) {
    state.selectedTower = idx;
    document.querySelectorAll('#tower-buttons button').forEach((btn) => {
      btn.classList.toggle('selected', parseInt(btn.dataset.tower) === idx);
    });
  }
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

  drawGrid();
  drawTowers();
  drawMonsters();
  drawCursor();
  drawEffects();
  drawUI();
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
    const px = tower.x * TILE_SIZE;
    const py = tower.y * TILE_SIZE;

    // Background
    ctx.fillStyle = type.bg;
    ctx.fillRect(px + 1, py + 1, TILE_SIZE * 2 - 2, TILE_SIZE * 2 - 2);

    // HP bar
    if (tower.hp < tower.maxHp) {
      const hpRatio = tower.hp / tower.maxHp;
      ctx.fillStyle = '#333';
      ctx.fillRect(px + 2, py + TILE_SIZE * 2 - 4, TILE_SIZE * 2 - 4, 3);
      ctx.fillStyle = hpRatio > 0.5 ? '#4caf50' : hpRatio > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(px + 2, py + TILE_SIZE * 2 - 4, (TILE_SIZE * 2 - 4) * hpRatio, 3);
    }

    // Letter at center
    ctx.font = 'bold ' + (TILE_SIZE) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = type.color;
    ctx.fillText(type.letter, px + TILE_SIZE, py + TILE_SIZE);
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

function drawCursor() {
  if (!state.cursor.visible) return;
  const px = state.cursor.x * TILE_SIZE;
  const py = state.cursor.y * TILE_SIZE;
  const canPlace = canPlaceTower(state.cursor.x, state.cursor.y);

  // Cursor highlight (2x2)
  ctx.fillStyle = canPlace ? 'rgba(255,255,255,0.15)' : 'rgba(255,80,80,0.15)';
  ctx.fillRect(px, py, TILE_SIZE * 2, TILE_SIZE * 2);
  ctx.strokeStyle = canPlace ? 'rgba(255,255,255,0.5)' : 'rgba(255,80,80,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE * 2 - 1, TILE_SIZE * 2 - 1);

  // Show selected tower letter
  const type = CONFIG.towers[state.selectedTower];
  ctx.font = 'bold ' + TILE_SIZE + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = canPlace ? 'rgba(255,255,255,0.5)' : 'rgba(255,80,80,0.3)';
  ctx.fillText(type.letter, px + TILE_SIZE, py + TILE_SIZE);

  // Range preview
  if (canPlace) {
    const range = type.range;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5;
    const rcx = px + TILE_SIZE;
    const rcy = py + TILE_SIZE;
    const rr = (range + 1) * TILE_SIZE;
    ctx.beginPath();
    ctx.arc(rcx, rcy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawEffects() {
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = e.ttl / 4;
    ctx.beginPath();
    ctx.moveTo(e.x * TILE_SIZE, e.y * TILE_SIZE);
    ctx.lineTo(e.tx * TILE_SIZE, e.ty * TILE_SIZE);
    ctx.stroke();
    ctx.globalAlpha = 1;
    e.ttl--;
    if (e.ttl <= 0) state.effects.splice(i, 1);
  }
}

function drawMapSelect() {
  const titleSize = Math.floor(TILE_SIZE * 1.5);
  const itemSize = Math.floor(TILE_SIZE * 0.9);
  const descSize = Math.floor(TILE_SIZE * 0.6);
  const boxH = TILE_SIZE * 4;
  const boxW = COLS * TILE_SIZE * 0.8;
  const startY = TILE_SIZE * 6;
  const centerX = CANVAS_W / 2;

  // Title
  ctx.font = 'bold ' + titleSize + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#81d4fa';
  ctx.fillText('SELECT MAP', centerX, TILE_SIZE * 3);

  // Map options
  for (let i = 0; i < MAPS.length; i++) {
    const map = MAPS[i];
    const y = startY + i * (boxH + TILE_SIZE);
    const isSelected = i === state.selectedMap;

    // Box background
    ctx.fillStyle = isSelected ? '#1a2a3a' : '#111';
    ctx.fillRect(centerX - boxW / 2, y, boxW, boxH);

    // Box border
    ctx.strokeStyle = isSelected ? '#4fc3f7' : '#333';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(centerX - boxW / 2, y, boxW, boxH);

    // Map name
    ctx.font = 'bold ' + itemSize + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isSelected ? '#fff' : '#888';
    ctx.fillText((i + 1) + '. ' + map.name, centerX, y + boxH * 0.35);

    // Description
    ctx.font = descSize + 'px monospace';
    ctx.fillStyle = isSelected ? '#aaa' : '#555';
    ctx.fillText(map.desc, centerX, y + boxH * 0.7);
  }

  // Settings button
  const settingsY = startY + MAPS.length * (boxH + TILE_SIZE) + TILE_SIZE;
  const settingsBtnW = boxW * 0.4;
  const settingsBtnH = TILE_SIZE * 2.5;
  state._settingsBtn = { x: centerX - settingsBtnW / 2, y: settingsY, w: settingsBtnW, h: settingsBtnH };
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(state._settingsBtn.x, settingsY, settingsBtnW, settingsBtnH);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(state._settingsBtn.x, settingsY, settingsBtnW, settingsBtnH);
  ctx.font = 'bold ' + itemSize + 'px monospace';
  ctx.fillStyle = '#888';
  ctx.fillText('Settings (S)', centerX, settingsY + settingsBtnH / 2);

  // Instructions
  ctx.font = descSize + 'px monospace';
  ctx.fillStyle = '#444';
  const instrY = settingsY + settingsBtnH + TILE_SIZE;
  ctx.fillText('Tap a map to play, or S for settings', centerX, instrY);
}

function drawUI() {
  // Top bar - scale with tile size
  const barH = TILE_SIZE;
  const fontSize = Math.max(10, Math.floor(TILE_SIZE * 0.7));
  const pad = Math.floor(TILE_SIZE * 0.2);
  const col = Math.floor(CANVAS_W / 6);  // divide top bar into 6 columns

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, CANVAS_W, barH);

  ctx.font = fontSize + 'px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const cy = barH / 2;

  // Gold
  ctx.fillStyle = '#ffd700';
  ctx.fillText('G:' + state.gold, pad, cy);

  // Lives
  ctx.fillStyle = '#ef5350';
  ctx.fillText('L:' + state.lives, col, cy);

  // Wave
  ctx.fillStyle = '#81d4fa';
  ctx.fillText('W:' + state.wave, col * 2, cy);

  // Score
  ctx.fillStyle = '#aaa';
  ctx.fillText('S:' + state.score, col * 3, cy);

  // Version
  ctx.fillStyle = '#555';
  ctx.fillText('v' + VERSION, col * 4, cy);

  // Phase
  ctx.fillStyle = state.phase === 'WAVE' ? '#ff9800' : state.phase === 'GAMEOVER' ? '#f44336' : '#4caf50';
  ctx.textAlign = 'right';
  ctx.fillText(state.phase === 'PLACE' ? 'PLACE TOWERS' : state.phase === 'WAVE' ? 'WAVE ' + state.wave : 'GAME OVER', CANVAS_W - pad, cy);

  // Message
  if (state.messageTimer > 0) {
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
function openSettings() {
  document.getElementById('settings').style.display = 'flex';
  canvas.style.display = 'none';
  populateSettings();
}

function closeSettings() {
  readSettings();
  localStorage.setItem('td-config', JSON.stringify(CONFIG));
  document.getElementById('settings').style.display = 'none';
  canvas.style.display = 'block';
  state.phase = 'MAP_SELECT';
}

function resetSettings() {
  CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  localStorage.removeItem('td-config');
  populateSettings();
}

function populateSettings() {
  // Towers
  const towersDiv = document.getElementById('settings-towers');
  towersDiv.innerHTML = '';
  CONFIG.towers.forEach((t, i) => {
    towersDiv.appendChild(createTowerFields(t, i));
  });

  // Monsters
  const monstersDiv = document.getElementById('settings-monsters');
  monstersDiv.innerHTML = '';
  CONFIG.monsters.forEach((m, i) => {
    monstersDiv.appendChild(createMonsterFields(m, i));
  });

  // Waves
  populateWaveFields();

  // Game
  document.getElementById('cfg-startGold').value = CONFIG.game.startGold;
  document.getElementById('cfg-startLives').value = CONFIG.game.startLives;
  document.getElementById('cfg-waveBonusGold').value = CONFIG.game.waveBonusGold;
}

function createTowerFields(t, i) {
  const div = document.createElement('div');
  div.className = 'cfg-item';
  div.innerHTML =
    '<div class="cfg-item-header"><span>Tower ' + (i + 1) + '</span>' +
    '<button class="cfg-remove" onclick="removeTowerType(' + i + ')">X</button></div>' +
    '<div class="cfg-row">' +
      '<label>Name <input type="text" class="tw-name" value="' + esc(t.name) + '"></label>' +
      '<label>Letter <input type="text" class="tw-letter" maxlength="1" value="' + esc(t.letter) + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>Color <input type="color" class="tw-color" value="' + t.color + '"></label>' +
      '<label>BG <input type="color" class="tw-bg" value="' + t.bg + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>Range <input type="number" class="tw-range" min="0" value="' + t.range + '"></label>' +
      '<label>Damage <input type="number" class="tw-damage" min="0" value="' + t.damage + '"></label>' +
      '<label>Fire Rate <input type="number" class="tw-fireRate" min="1" value="' + t.fireRate + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>Cost <input type="number" class="tw-cost" min="0" value="' + t.cost + '"></label>' +
      '<label>HP <input type="number" class="tw-hp" min="1" value="' + t.hp + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label><input type="checkbox" class="tw-pierce"' + (t.pierce ? ' checked' : '') + '> Pierce</label>' +
      '<label><input type="checkbox" class="tw-barricade"' + (t.barricade ? ' checked' : '') + '> Barricade</label>' +
      '<label><input type="checkbox" class="tw-hasDot"' + (t.dot ? ' checked' : '') + '> DOT</label>' +
    '</div>' +
    '<div class="cfg-row cfg-dot-fields"' + (t.dot ? '' : ' style="display:none"') + '>' +
      '<label>DOT DPS <input type="number" class="tw-dotDps" min="0" step="0.1" value="' + (t.dot ? t.dot.dps : 1) + '"></label>' +
      '<label>DOT Duration <input type="number" class="tw-dotDur" min="1" value="' + (t.dot ? t.dot.duration : 90) + '"></label>' +
    '</div>';
  // Toggle DOT fields visibility
  div.querySelector('.tw-hasDot').addEventListener('change', function() {
    div.querySelector('.cfg-dot-fields').style.display = this.checked ? '' : 'none';
  });
  return div;
}

function createMonsterFields(m, i) {
  const div = document.createElement('div');
  div.className = 'cfg-item';
  div.innerHTML =
    '<div class="cfg-item-header"><span>Monster ' + (i + 1) + '</span>' +
    '<button class="cfg-remove" onclick="removeMonsterType(' + i + ')">X</button></div>' +
    '<div class="cfg-row">' +
      '<label>Name <input type="text" class="mo-name" value="' + esc(m.name) + '"></label>' +
      '<label>Letter <input type="text" class="mo-letter" maxlength="1" value="' + esc(m.letter) + '"></label>' +
      '<label>Color <input type="color" class="mo-color" value="' + m.color + '"></label>' +
    '</div>' +
    '<div class="cfg-row">' +
      '<label>HP <input type="number" class="mo-hp" min="1" value="' + m.hp + '"></label>' +
      '<label>Speed <input type="number" class="mo-speed" min="0.01" step="0.01" value="' + m.speed + '"></label>' +
      '<label>Reward <input type="number" class="mo-reward" min="0" value="' + m.reward + '"></label>' +
    '</div>';
  return div;
}

function populateWaveFields() {
  const wavesDiv = document.getElementById('settings-wave-monsters');
  wavesDiv.innerHTML = '';
  CONFIG.monsters.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'cfg-row';
    div.innerHTML =
      '<span style="color:' + m.color + '">' + m.name + '</span>' +
      '<label>Count <input type="number" class="wv-base" min="0" value="' + (CONFIG.waves.baseCounts[i] || 0) + '"></label>' +
      '<label>Unlock wave <input type="number" class="wv-unlock" min="1" value="' + (CONFIG.waves.unlockWave[i] || 1) + '"></label>';
    wavesDiv.appendChild(div);
  });
  document.getElementById('cfg-scaleEvery').value = CONFIG.waves.scaleEvery;
  document.getElementById('cfg-intervalStart').value = CONFIG.waves.intervalStart;
  document.getElementById('cfg-intervalDecay').value = CONFIG.waves.intervalDecay;
  document.getElementById('cfg-intervalMin').value = CONFIG.waves.intervalMin;
}

function readSettings() {
  // Read towers
  const towerItems = document.querySelectorAll('#settings-towers .cfg-item');
  CONFIG.towers = Array.from(towerItems).map(div => {
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
    if (div.querySelector('.tw-barricade').checked) t.barricade = true;
    if (div.querySelector('.tw-hasDot').checked) {
      t.dot = {
        dps: +div.querySelector('.tw-dotDps').value || 1,
        duration: +div.querySelector('.tw-dotDur').value || 90,
      };
    }
    return t;
  });

  // Read monsters
  const monsterItems = document.querySelectorAll('#settings-monsters .cfg-item');
  CONFIG.monsters = Array.from(monsterItems).map(div => ({
    name: div.querySelector('.mo-name').value,
    letter: div.querySelector('.mo-letter').value || '?',
    color: div.querySelector('.mo-color').value,
    hp: +div.querySelector('.mo-hp').value || 1,
    speed: +div.querySelector('.mo-speed').value || 0.05,
    reward: +div.querySelector('.mo-reward').value || 1,
  }));

  // Read waves
  const baseDivs = document.querySelectorAll('#settings-wave-monsters .cfg-row');
  CONFIG.waves.baseCounts = Array.from(baseDivs).map(d => +d.querySelector('.wv-base').value || 0);
  CONFIG.waves.unlockWave = Array.from(baseDivs).map(d => +d.querySelector('.wv-unlock').value || 1);
  CONFIG.waves.scaleEvery = +document.getElementById('cfg-scaleEvery').value || 2;
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
  CONFIG.towers.push({ name: 'New', letter: 'X', color: '#ffffff', bg: '#444444', range: 2, damage: 1, fireRate: 30, cost: 10, hp: 5 });
  populateSettings();
}

function removeTowerType(i) {
  readSettings();
  if (CONFIG.towers.length <= 1) return;
  CONFIG.towers.splice(i, 1);
  populateSettings();
}

function addMonsterType() {
  readSettings();
  CONFIG.monsters.push({ name: 'New', letter: '?', color: '#ffffff', hp: 10, speed: 0.08, reward: 5 });
  CONFIG.waves.baseCounts.push(1);
  CONFIG.waves.unlockWave.push(CONFIG.monsters.length);
  populateSettings();
}

function removeMonsterType(i) {
  readSettings();
  if (CONFIG.monsters.length <= 1) return;
  CONFIG.monsters.splice(i, 1);
  CONFIG.waves.baseCounts.splice(i, 1);
  CONFIG.waves.unlockWave.splice(i, 1);
  populateSettings();
}

function esc(s) { return s.replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// === INIT ===
function startGame(mapIdx) {
  // Clear grid and ground
  grid.fill(0);
  ground.fill(GROUND_GRASS);
  // Top and bottom rows are always road
  for (let x = 0; x < COLS; x++) {
    ground[x] = GROUND_ROAD;
    ground[(ROWS - 1) * COLS + x] = GROUND_ROAD;
  }
  state.towers.length = 0;
  state.monsters.length = 0;
  state.effects.length = 0;
  state.wave = 0;
  state.lives = CONFIG.game.startLives;
  state.gold = CONFIG.game.startGold;
  state.score = 0;
  state.frame = 0;
  state.cursor = { x: 12, y: 24, visible: false };
  state.selectedTower = 0;
  state.message = '';
  state.messageTimer = 0;

  // Apply map
  MAPS[mapIdx].setup();
  recomputePath();
  rebuildTowerButtons();
  state.phase = 'PLACE';
  document.getElementById('ui').style.display = 'flex';
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
  document.getElementById('ui').style.display = 'none';
  setupInput();
  requestAnimationFrame(gameLoop);
}

init();
