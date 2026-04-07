// === CONSTANTS ===
const COLS = 24;
const ROWS = 48;
const FPS = 30;
const TICK_RATE = 1000 / FPS;

// Tile size derived from viewport width so the board fills the screen width
let TILE_SIZE, CANVAS_W, CANVAS_H;

const TOWER_TYPES = [
  { name: 'Melee',     letter: 'M', color: '#4fc3f7', bg: '#1565c0', range: 1, damage: 3, fireRate: 15, cost: 10, hp: 10 },
  { name: 'Range',     letter: 'R', color: '#fff176', bg: '#f57f17', range: 4, damage: 2, fireRate: 30, cost: 15, hp: 5  },
  { name: 'DOT',       letter: 'D', color: '#81c784', bg: '#2e7d32', range: 1, damage: 0, fireRate: 30, cost: 20, hp: 8, dot: { dps: 1, duration: 3 * FPS } },
  { name: 'Pierce',    letter: 'P', color: '#ce93d8', bg: '#6a1b9a', range: 5, damage: 1, fireRate: 45, cost: 25, hp: 5, pierce: true },
  { name: 'Barricade', letter: 'B', color: '#90a4ae', bg: '#455a64', range: 0, damage: 0, fireRate: 9999, cost: 3, hp: 15, barricade: true },
];

const MONSTER_TYPES = [
  { name: 'Normal', letter: 'N', color: '#ef5350', hp: 12, speed: 0.08, reward: 5  },
  { name: 'Fast',   letter: 'F', color: '#ff8a65', hp: 6,  speed: 0.16, reward: 7  },
  { name: 'Tank',   letter: 'H', color: '#ab47bc', hp: 30, speed: 0.05, reward: 12 },
];

// Wave generation: monsters double every 2 waves
// Wave 1: 6 Normal. Fast from wave 2, Tanks from wave 3.
function getWaveConfig(waveNum) {
  // Doubling factor: 2^(floor((wave-1)/2))  → wave 1-2: x1, 3-4: x2, 5-6: x4, 7-8: x8...
  const scale = Math.pow(2, Math.floor((waveNum - 1) / 2));
  const normal = Math.round(6 * scale);
  const fast = waveNum >= 2 ? Math.round(3 * scale) : 0;
  const tank = waveNum >= 3 ? Math.round(2 * scale) : 0;
  const interval = Math.max(10, 40 - (waveNum - 1) * 3);
  return { counts: [normal, fast, tank], interval };
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
const grid = new Uint8Array(COLS * ROWS);  // 0=empty, 1=tower
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
  phase: 'PLACE',   // PLACE | WAVE | GAMEOVER
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

  // Seed: all bottom-row cells that are not towers
  for (let x = 0; x < COLS; x++) {
    const idx = (ROWS - 1) * COLS + x;
    if (g[idx] === 0) {
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
      if (g[ni] !== 0) continue;
      // Diagonal: require both adjacent cardinal cells to be free (no corner-cutting)
      if (dir % 2 === 1) {
        const adj1 = g[cy * COLS + nx];  // horizontal neighbor
        const adj2 = g[ny * COLS + cx];  // vertical neighbor
        if (adj1 !== 0 || adj2 !== 0) continue;
      }
      const nd = d + DIR_COST[dir];
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
      if (grid[(ty + dy) * COLS + (tx + dx)] !== 0) return false;
    }
  }
  return true;
}

function placeTower() {
  if (state.phase === 'GAMEOVER') return;
  const tx = state.cursor.x;
  const ty = state.cursor.y;
  const type = TOWER_TYPES[state.selectedTower];

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
    const type = TOWER_TYPES[tower.typeIdx];
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

      // Pick cardinal direction
      const dx = nearest.x - tcx;
      const dy = nearest.y - tcy;
      let dir;
      if (Math.abs(dx) > Math.abs(dy)) {
        dir = dx > 0 ? 1 : 3;
      } else {
        dir = dy > 0 ? 2 : 0;
      }

      // Hit all monsters in the corridor
      let hit = false;
      for (const m of state.monsters) {
        if (m.hp <= 0) continue;
        const rx = m.x - tcx;
        const ry = m.y - tcy;
        let inCorridor = false;
        if (dir === 0 && Math.abs(rx) < 1 && ry >= -type.range && ry <= 0) inCorridor = true;
        if (dir === 2 && Math.abs(rx) < 1 && ry >= 0 && ry <= type.range) inCorridor = true;
        if (dir === 1 && Math.abs(ry) < 1 && rx >= 0 && rx <= type.range) inCorridor = true;
        if (dir === 3 && Math.abs(ry) < 1 && rx >= -type.range && rx <= 0) inCorridor = true;
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
  const type = MONSTER_TYPES[typeIdx];
  // Find a reachable spawn column
  const candidates = [];
  for (let x = 0; x < COLS; x++) {
    if (pathDist && pathDist[x] !== -1) candidates.push(x);
  }
  if (candidates.length === 0) {
    // No reachable column, pick random
    for (let x = 0; x < COLS; x++) candidates.push(x);
  }
  const sx = candidates[Math.floor(Math.random() * candidates.length)];

  state.monsters.push({
    x: sx + 0.5,
    y: 0.5,
    hp: type.hp,
    maxHp: type.hp,
    speed: type.speed,
    typeIdx: typeIdx,
    reward: type.reward,
    letter: type.letter,
    color: type.color,
    attacking: null,
    dot: null,
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
      if (state.lives <= 0) state.phase = 'GAMEOVER';
      continue;
    }

    const idx = tileY * COLS + tileX;
    const flow = pathFlow ? pathFlow[idx] : -1;

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
          m.x += (dx / dist) * m.speed;
          m.y += (dy / dist) * m.speed;
        }
      }
    } else {
      // Follow flow map
      m.attacking = null;
      const fdx = DX[flow];
      const fdy = DY[flow];
      const isDiag = fdx !== 0 && fdy !== 0;
      // Diagonal movement: normalize speed so diagonal isn't faster
      const spd = isDiag ? m.speed * 0.707 : m.speed;
      if (isDiag) {
        // Diagonal: move both axes
        m.x += fdx * spd;
        m.y += fdy * spd;
      } else if (fdx !== 0) {
        // Horizontal: snap y toward tile center
        const centerY = tileY + 0.5;
        const diffY = centerY - m.y;
        if (Math.abs(diffY) > 0.01) {
          m.y += Math.sign(diffY) * Math.min(Math.abs(diffY), m.speed);
        }
        m.x += fdx * m.speed;
      } else {
        // Vertical: snap x toward tile center
        const centerX = tileX + 0.5;
        const diffX = centerX - m.x;
        if (Math.abs(diffX) > 0.01) {
          m.x += Math.sign(diffX) * Math.min(Math.abs(diffX), m.speed);
        }
        m.y += fdy * m.speed;
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
}

function updateSpawning() {
  if (state.phase !== 'WAVE') return;
  if (state.monsters.length === 0) {
    // Wave complete
    state.phase = 'PLACE';
    state.gold += 10;  // wave completion bonus
    showMessage('Wave ' + (state.wave) + ' complete! +10g');
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

  let lastTouchTime = 0;
  canvas.addEventListener('click', (e) => {
    // Ignore click events generated by touch (they fire ~300ms after touchend)
    if (Date.now() - lastTouchTime < 500) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    state.cursor.x = Math.floor((e.clientX - rect.left) * scaleX / TILE_SIZE);
    state.cursor.y = Math.floor((e.clientY - rect.top) * scaleY / TILE_SIZE);
    state.cursor.x = Math.max(0, Math.min(COLS - 2, state.cursor.x));
    state.cursor.y = Math.max(0, Math.min(ROWS - 2, state.cursor.y));
    placeTower();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowUp':    state.cursor.y = Math.max(0, state.cursor.y - 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowDown':  state.cursor.y = Math.min(ROWS - 2, state.cursor.y + 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowLeft':  state.cursor.x = Math.max(0, state.cursor.x - 1); state.cursor.visible = true; e.preventDefault(); break;
      case 'ArrowRight': state.cursor.x = Math.min(COLS - 2, state.cursor.x + 1); state.cursor.visible = true; e.preventDefault(); break;
      case ' ': case 'Enter': placeTower(); e.preventDefault(); break;
      case 'w': case 'W': startWave(); break;
      case '1': selectTowerType(0); break;
      case '2': selectTowerType(1); break;
      case '3': selectTowerType(2); break;
      case '4': selectTowerType(3); break;
      case '5': selectTowerType(4); break;
    }
  });

  // Touch - use touchend to allow scrolling; only set cursor if it was a tap (not a drag)
  let touchStartPos = null;
  canvas.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    lastTouchTime = Date.now();
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
    const tx = Math.floor((touch.clientX - rect.left) * scaleX / TILE_SIZE);
    const ty = Math.floor((touch.clientY - rect.top) * scaleY / TILE_SIZE);
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
  document.querySelectorAll('#ui button[data-tower]').forEach((btn) => {
    btn.addEventListener('click', () => selectTowerType(parseInt(btn.dataset.tower)));
  });
}

function selectTowerType(idx) {
  if (idx >= 0 && idx < TOWER_TYPES.length) {
    state.selectedTower = idx;
    document.querySelectorAll('#ui button[data-tower]').forEach((btn) => {
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

  drawGrid();
  drawTowers();
  drawMonsters();
  drawCursor();
  drawEffects();
  drawUI();
}

function drawGrid() {
  // Spawn row
  ctx.fillStyle = '#1a2a1a';
  ctx.fillRect(0, 0, CANVAS_W, TILE_SIZE);

  // Goal row
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, (ROWS - 1) * TILE_SIZE, CANVAS_W, TILE_SIZE);

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

  // Spawn markers
  ctx.font = (TILE_SIZE - 4) + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2a4a2a';
  for (let x = 0; x < COLS; x++) {
    ctx.fillText('v', x * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 2);
  }
  // Goal markers
  ctx.fillStyle = '#2a2a4a';
  for (let x = 0; x < COLS; x++) {
    ctx.fillText('=', x * TILE_SIZE + TILE_SIZE / 2, (ROWS - 1) * TILE_SIZE + TILE_SIZE / 2);
  }
}

function drawTowers() {
  for (const tower of state.towers) {
    const type = TOWER_TYPES[tower.typeIdx];
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
  ctx.font = 'bold ' + (TILE_SIZE - 2) + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const px = m.x * TILE_SIZE;
    const py = m.y * TILE_SIZE;

    // DOT indicator
    if (m.dot) {
      ctx.fillStyle = 'rgba(129, 199, 132, 0.3)';
      ctx.beginPath();
      ctx.arc(px, py, TILE_SIZE / 2 + 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Monster letter
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
  const type = TOWER_TYPES[state.selectedTower];
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

function drawUI() {
  // Top bar background
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, CANVAS_W, 14);

  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // Gold
  ctx.fillStyle = '#ffd700';
  ctx.fillText('G:' + state.gold, 4, 2);

  // Lives
  ctx.fillStyle = '#ef5350';
  ctx.fillText('L:' + state.lives, 60, 2);

  // Wave
  ctx.fillStyle = '#81d4fa';
  ctx.fillText('W:' + state.wave, 110, 2);

  // Score
  ctx.fillStyle = '#aaa';
  ctx.fillText('S:' + state.score, 160, 2);

  // Phase
  ctx.fillStyle = state.phase === 'WAVE' ? '#ff9800' : state.phase === 'GAMEOVER' ? '#f44336' : '#4caf50';
  ctx.textAlign = 'right';
  ctx.fillText(state.phase === 'PLACE' ? 'PLACE TOWERS' : state.phase === 'WAVE' ? 'WAVE ' + state.wave : 'GAME OVER', CANVAS_W - 4, 2);

  // Message
  if (state.messageTimer > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, CANVAS_H / 2 - 12, CANVAS_W, 24);
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(state.message, CANVAS_W / 2, CANVAS_H / 2);
    state.messageTimer--;
  }

  // Game over overlay
  if (state.phase === 'GAMEOVER') {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f44336';
    ctx.fillText('GAME OVER', CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#ccc';
    ctx.fillText('Score: ' + state.score, CANVAS_W / 2, CANVAS_H / 2 + 10);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('Refresh to restart', CANVAS_W / 2, CANVAS_H / 2 + 30);
  }
}

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
    if (state.phase !== 'GAMEOVER') {
      update();
    }
    accumulator -= TICK_RATE;
  }

  render();
  requestAnimationFrame(gameLoop);
}

// === INIT ===
function init() {
  recomputePath();
  setupInput();
  requestAnimationFrame(gameLoop);
}

init();
