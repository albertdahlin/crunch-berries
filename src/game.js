// @ts-check
/** @typedef {import('./types.js').Campaign}    Campaign */
/** @typedef {import('./types.js').MapDef}      MapDef */
/** @typedef {import('./types.js').MapRuntime}  MapRuntime */
/** @typedef {import('./types.js').GameState}   GameState */
/** @typedef {import('./types.js').GamePhase}   GamePhase */
/** @typedef {import('./types.js').Tower}       Tower */
/** @typedef {import('./types.js').Monster}     Monster */
/** @typedef {import('./types.js').Renderer}    Renderer */
/** @typedef {import('./types.js').Hud}         Hud */
/** @typedef {import('./types.js').Game}        Game */
/** @typedef {import('./types.js').GameInput}   GameInput */

import {
  FPS, TICK_RATE,
  DX, DY,
  GROUND_GRASS, GROUND_ROAD, GROUND_TYPES,
} from './constants.js';
import {
  getMergedNode, getTowerSize, getTowerNode, getWaveConfig, getWaveScript, isTowerUnlocked,
} from './campaigns.js';
import {
  recomputePath, isTopRowReachable,
} from './pathfind.js';

/**
 * Build a fresh MapRuntime from a MapDef, enforcing top/bottom road rows.
 * @param {MapDef} mapDef
 * @returns {MapRuntime}
 */
export function buildMapRuntime(mapDef) {
  const cols = mapDef.cols;
  const rows = mapDef.rows;
  const ground = new Uint8Array(cols * rows);
  ground.fill(GROUND_GRASS);
  if (mapDef.data) {
    for (let i = 0; i < mapDef.data.length && i < cols * rows; i++) {
      const y = Math.floor(i / cols);
      if (y === 0 || y === rows - 1) continue;
      ground[i] = mapDef.data[i];
    }
  }
  for (let x = 0; x < cols; x++) {
    ground[x] = GROUND_ROAD;
    ground[(rows - 1) * cols + x] = GROUND_ROAD;
  }
  const grid = new Uint8Array(cols * rows);
  return { cols, rows, ground, grid, pathDist: null, pathFlow: null };
}

let activeWakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { activeWakeLock = await /** @type {any} */ (navigator).wakeLock.request('screen'); }
  catch (e) { /* denied or unsupported */ }
}
async function releaseWakeLock() {
  if (activeWakeLock) { await activeWakeLock.release(); activeWakeLock = null; }
}

/**
 * @param {{mapDef: MapDef, campaign: Campaign, renderer: Renderer, hud: Hud, onQuit?: () => void, onSave?: () => void}} opts
 * @returns {Game}
 */
export function createGame(opts) {
  const { mapDef, campaign, renderer, hud } = opts;
  const onQuit = opts.onQuit || (() => {});
  const onSave = opts.onSave || (() => {});

  const mapRuntime = buildMapRuntime(mapDef);

  /** @type {GameState} */
  const state = {
    towers: [],
    monsters: [],
    effects: [],
    projectiles: [],
    cursor: { x: Math.floor(mapRuntime.cols / 2), y: Math.floor(mapRuntime.rows / 2), visible: false },
    selectedTower: 0,
    placeRotation: 0,
    wave: 0,
    lives: campaign.game.startLives,
    gold: campaign.game.startGold,
    score: 0,
    frame: 0,
    phase: 'PLACE',
    message: '',
    messageTimer: 0,
    selectedPlacedTower: null,
  };

  function showMessage(msg, duration) {
    state.message = msg;
    state.messageTimer = duration || FPS * 2;
    hud.flash(msg);
  }

  // === Damage helpers ===
  function getDamageModifier(monster, damageType) {
    const mCfg = campaign.monsters[monster.typeIdx];
    const mods = mCfg && mCfg.damageModifiers;
    return (mods && mods[damageType] !== undefined) ? mods[damageType] : 1.0;
  }

  function applyDamage(monster, baseDamage, damageType, tower) {
    const mod = getDamageModifier(monster, damageType || 'physical');
    const dealt = baseDamage * mod;
    const wasAlive = monster.hp > 0;
    monster.hp -= dealt;
    if (tower) tower.damageDealt = (tower.damageDealt || 0) + dealt;
    const killed = wasAlive && monster.hp <= 0;
    if (killed && tower) tower.kills = (tower.kills || 0) + 1;
    return killed;
  }

  function applySpeedMod(monster, factor, duration) {
    if (factor === 1) return;
    monster.speedMod = { factor, remaining: duration || 60 };
  }

  function applySplash(cx, cy, radius, towerNode, excludeMonster, tower) {
    const dmgType = towerNode.damageType || 'physical';
    for (const m of state.monsters) {
      if (m.hp <= 0 || m === excludeMonster) continue;
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d <= radius) {
        applyDamage(m, towerNode.damage, dmgType, tower);
        if (towerNode.speedFactor && towerNode.speedFactor !== 1) {
          applySpeedMod(m, towerNode.speedFactor, towerNode.speedDuration);
        }
        if (towerNode.dot) {
          m.dot = { dps: towerNode.dot.dps, remaining: towerNode.dot.duration, damageType: dmgType };
        }
      }
    }
    state.effects.push({ type: 'circle', x: cx, y: cy, radius, ttl: 8, color: towerNode.color });
  }

  // === Line of sight ===
  // Returns false if any blocks-sight tile (e.g. mountain) lies on the line
  // segment between two world-space tile points. Endpoints themselves are
  // not tested (the tower's own footprint and the target's tile are ignored).
  function hasLineOfSight(x1, y1, x2, y2) {
    const { cols, rows, ground } = mapRuntime;
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return true;
    const steps = Math.max(2, Math.ceil(dist * 4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor(x1 + dx * t);
      const ty = Math.floor(y1 + dy * t);
      if (tx < 0 || tx >= cols || ty < 0 || ty >= rows) continue;
      if (GROUND_TYPES[ground[ty * cols + tx]].blocksSight) return false;
    }
    return true;
  }

  // === Tower helpers ===
  function distToTower(mx, my, tower) {
    const size = getTowerSize(campaign, tower.typeIdx, tower.rotation);
    const cx = Math.max(tower.x, Math.min(tower.x + size.w, mx));
    const cy = Math.max(tower.y, Math.min(tower.y + size.h, my));
    return Math.hypot(mx - cx, my - cy);
  }

  function canPlaceTower(tx, ty, typeIdx, rotation) {
    if (typeIdx === undefined) typeIdx = state.selectedTower;
    if (rotation === undefined) rotation = state.placeRotation;
    const size = getTowerSize(campaign, typeIdx, rotation);
    const { cols, rows, grid, ground } = mapRuntime;
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

  function getTowerAt(tx, ty) {
    for (const tower of state.towers) {
      const size = getTowerSize(campaign, tower.typeIdx, tower.rotation);
      if (tx >= tower.x && tx < tower.x + size.w &&
          ty >= tower.y && ty < tower.y + size.h) return tower;
    }
    return null;
  }

  function getSellRefund(tower) {
    const type = campaign.towers[tower.typeIdx];
    if (!type) return 0;
    const total = tower.totalCost || type.cost || 0;
    const path = tower.upgradePath || [];
    if (state.phase === 'PLACE' && tower.placedAtWave === state.wave && path.length === 0) return total;
    return Math.floor(total * campaign.game.sellRefundPercent / 100);
  }

  function placeTower() {
    if (state.phase === 'GAMEOVER') return;
    const tx = state.cursor.x;
    const ty = state.cursor.y;
    const type = campaign.towers[state.selectedTower];
    if (!type) return;
    const size = getTowerSize(campaign, state.selectedTower, state.placeRotation);
    const cost = type.cost || 0;

    if (state.gold < cost) { showMessage('Not enough gold!'); return; }
    if (!canPlaceTower(tx, ty)) { showMessage("Can't place here!"); return; }

    const tempGrid = new Uint8Array(mapRuntime.grid);
    for (let dy = 0; dy < size.h; dy++)
      for (let dx = 0; dx < size.w; dx++)
        tempGrid[(ty + dy) * mapRuntime.cols + (tx + dx)] = 1;
    const pathBlocked = !isTopRowReachable(mapRuntime, tempGrid);

    for (let dy = 0; dy < size.h; dy++)
      for (let dx = 0; dx < size.w; dx++)
        mapRuntime.grid[(ty + dy) * mapRuntime.cols + (tx + dx)] = 1;

    state.towers.push({
      x: tx, y: ty,
      typeIdx: state.selectedTower,
      rotation: state.placeRotation,
      hp: type.hp || 1,
      maxHp: type.hp || 1,
      lastFire: 0,
      placedAtWave: state.wave,
      upgradePath: [],
      totalCost: cost,
      kills: 0,
      damageDealt: 0,
      goldStolen: 0,
    });

    state.gold -= cost;
    state.selectedPlacedTower = null;
    recomputePath(mapRuntime);
    hud.refreshSelection(state, campaign);
    if (pathBlocked) showMessage('Path blocked! Monsters will attack!');
  }

  function removeTower(tower) {
    const idx = state.towers.indexOf(tower);
    if (idx === -1) return;
    state.towers.splice(idx, 1);
    const size = getTowerSize(campaign, tower.typeIdx, tower.rotation);
    for (let dy = 0; dy < size.h; dy++)
      for (let dx = 0; dx < size.w; dx++)
        mapRuntime.grid[(tower.y + dy) * mapRuntime.cols + (tower.x + dx)] = 0;
    recomputePath(mapRuntime);
  }

  function rotatePlacedTower() {
    if (!state.selectedPlacedTower || state.phase !== 'PLACE') return;
    state.selectedPlacedTower.rotation = (state.selectedPlacedTower.rotation + 1) % 4;
  }

  function upgradeTower(choiceIndex) {
    if (!state.selectedPlacedTower || state.phase === 'GAMEOVER') return;
    const tower = state.selectedPlacedTower;
    const node = getTowerNode(campaign, tower);
    if (!node.upgrades || !node.upgrades[choiceIndex]) return;
    const newPath = (tower.upgradePath || []).concat(choiceIndex);
    const upgrade = getMergedNode(campaign.towers[tower.typeIdx], newPath);
    const cost = upgrade.cost || 0;
    if (state.gold < cost) { showMessage('Not enough gold!'); return; }
    state.gold -= cost;
    tower.upgradePath = newPath;
    tower.totalCost = (tower.totalCost || campaign.towers[tower.typeIdx].cost || 0) + cost;
    const ratio = tower.hp / tower.maxHp;
    tower.maxHp = upgrade.hp || tower.maxHp;
    tower.hp = Math.max(1, Math.round(tower.maxHp * ratio));
    hud.refreshSelection(state, campaign);
    showMessage('Upgraded to ' + upgrade.name + '!');
  }

  function sellTower() {
    if (!state.selectedPlacedTower || state.phase === 'GAMEOVER') return;
    const tower = state.selectedPlacedTower;
    const refund = getSellRefund(tower);
    state.gold += refund;
    state.selectedPlacedTower = null;
    removeTower(tower);
    hud.refreshSelection(state, campaign);
    showMessage('Sold! +' + refund + 'g');
  }

  function selectTowerType(idx) {
    if (idx < 0 || idx >= campaign.towers.length || !isTowerUnlocked(campaign.waves, idx, state.wave)) return;
    const t = campaign.towers[idx];
    const sw = t.sizeW || 2, sh = t.sizeH || 2;
    if (state.selectedTower === idx && (sw !== sh || t.attackDir === 'fixed')) {
      rotatePlacement();
      return;
    }
    state.selectedTower = idx;
    hud.rebuildTowerButtons(state, campaign);
  }

  function rotatePlacement() {
    state.placeRotation = (state.placeRotation + 1) % 4;
    const size = getTowerSize(campaign, state.selectedTower, state.placeRotation);
    state.cursor.x = Math.min(state.cursor.x, mapRuntime.cols - size.w);
    state.cursor.y = Math.min(state.cursor.y, mapRuntime.rows - size.h);
    hud.rebuildTowerButtons(state, campaign);
  }

  // === Simulation ===
  function updateTowers() {
    for (const tower of state.towers) {
      const node = getTowerNode(campaign, tower);
      const eDmg = node.damage || 0;
      const eRange = node.range || 0;
      const eRate = node.fireRate || 9999;
      if (eRange <= 0 || (eDmg <= 0 && !node.dot)) continue;
      if (state.frame - tower.lastFire < eRate) continue;

      const tSize = getTowerSize(campaign, tower.typeIdx, tower.rotation);
      const tcx = tower.x + tSize.w / 2;
      const tcy = tower.y + tSize.h / 2;

      const isFixed = node.attackDir === 'fixed';
      const fdx = [0, 1, 0, -1][tower.rotation];
      const fdy = [-1, 0, 1, 0][tower.rotation];

      let ox = tcx, oy = tcy;
      if (isFixed) {
        if (tower.rotation === 0) { ox = tower.x + tSize.w / 2; oy = tower.y; }
        else if (tower.rotation === 1) { ox = tower.x + tSize.w; oy = tower.y + tSize.h / 2; }
        else if (tower.rotation === 2) { ox = tower.x + tSize.w / 2; oy = tower.y + tSize.h; }
        else { ox = tower.x; oy = tower.y + tSize.h / 2; }
      }

      if (node.pierce) {
        const dir = tower.rotation * 2;
        const corridorW = Math.max(tSize.w, tSize.h) === tSize.w ? tSize.h : tSize.w;
        let hit = false;
        for (const m of state.monsters) {
          if (m.hp <= 0) continue;
          const rx = m.x - ox;
          const ry = m.y - oy;
          let inCorridor = false;
          if (dir === 0 && Math.abs(rx) < corridorW && ry >= -eRange && ry <= 0) inCorridor = true;
          if (dir === 4 && Math.abs(rx) < corridorW && ry >= 0 && ry <= eRange) inCorridor = true;
          if (dir === 2 && Math.abs(ry) < corridorW && rx >= 0 && rx <= eRange) inCorridor = true;
          if (dir === 6 && Math.abs(ry) < corridorW && rx >= -eRange && rx <= 0) inCorridor = true;
          if (inCorridor && hasLineOfSight(ox, oy, m.x, m.y)) {
            applyDamage(m, eDmg, node.damageType, tower);
            if (node.speedFactor && node.speedFactor !== 1) applySpeedMod(m, node.speedFactor, node.speedDuration);
            hit = true;
          }
        }
        if (!hit) continue;
        tower.lastFire = state.frame;
        const ex = ox + DX[dir] * eRange;
        const ey = oy + DY[dir] * eRange;
        state.effects.push({ x: ox, y: oy, tx: ex, ty: ey, ttl: 4, color: node.color, wide: true });

      } else if (node.dot) {
        let nearest = null, nearDist = Infinity, nearestHasDot = true;
        for (const m of state.monsters) {
          if (m.hp <= 0) continue;
          if (isFixed) {
            const dx = m.x - tcx, dy = m.y - tcy;
            if (dx * fdx + dy * fdy <= 0) continue;
          }
          const d = distToTower(m.x, m.y, tower);
          if (d > eRange) continue;
          if (!hasLineOfSight(ox, oy, m.x, m.y)) continue;
          const hasDot = !!m.dot;
          if ((!hasDot && nearestHasDot) || (hasDot === nearestHasDot && d < nearDist)) {
            nearDist = d; nearest = m; nearestHasDot = hasDot;
          }
        }
        if (!nearest) continue;
        tower.lastFire = state.frame;
        nearest.dot = { dps: node.dot.dps, remaining: node.dot.duration, damageType: node.damageType || 'physical' };
        if (node.speedFactor && node.speedFactor !== 1) applySpeedMod(nearest, node.speedFactor, node.speedDuration);
        state.effects.push({ x: ox, y: oy, tx: nearest.x, ty: nearest.y, ttl: 4, color: node.color });

      } else {
        let nearest = null, nearDist = Infinity;
        for (const m of state.monsters) {
          if (m.hp <= 0) continue;
          if (isFixed) {
            const dx = m.x - tcx, dy = m.y - tcy;
            if (dx * fdx + dy * fdy <= 0) continue;
          }
          const d = distToTower(m.x, m.y, tower);
          if (d >= nearDist || d > eRange) continue;
          if (!hasLineOfSight(ox, oy, m.x, m.y)) continue;
          nearDist = d; nearest = m;
        }
        if (!nearest) continue;
        tower.lastFire = state.frame;

        if (node.projectileSpeed && node.projectileSpeed > 0) {
          const dx = nearest.x - ox;
          const dy = nearest.y - oy;
          const dist = Math.hypot(dx, dy) || 1;
          state.projectiles.push({
            x: ox, y: oy,
            tx: nearest.x, ty: nearest.y,
            vx: (dx / dist) * node.projectileSpeed,
            vy: (dy / dist) * node.projectileSpeed,
            damage: eDmg,
            towerNode: node,
            tower,
            color: node.color,
          });
        } else {
          const dmgType = node.damageType || 'physical';
          applyDamage(nearest, eDmg, dmgType, tower);
          if (node.speedFactor && node.speedFactor !== 1) applySpeedMod(nearest, node.speedFactor, node.speedDuration);
          if (node.splashRadius && node.splashRadius > 0) applySplash(nearest.x, nearest.y, node.splashRadius, node, nearest, tower);
          state.effects.push({ x: ox, y: oy, tx: nearest.x, ty: nearest.y, ttl: 4, color: node.color });
        }
      }
    }
  }

  function updateProjectiles() {
    const { cols, rows, ground } = mapRuntime;
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      p.x += p.vx;
      p.y += p.vy;

      // Detonate on a blocks-sight tile (e.g. mountain).
      const ptx = Math.floor(p.x);
      const pty = Math.floor(p.y);
      if (ptx >= 0 && ptx < cols && pty >= 0 && pty < rows &&
          GROUND_TYPES[ground[pty * cols + ptx]].blocksSight) {
        const tn = p.towerNode;
        if (tn.splashRadius && tn.splashRadius > 0) {
          applySplash(p.x, p.y, tn.splashRadius, tn, null, p.tower);
        }
        state.projectiles.splice(i, 1);
        continue;
      }

      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dot = dx * p.vx + dy * p.vy;

      if (dot <= 0) {
        p.x = p.tx; p.y = p.ty;
        const tn = p.towerNode;
        const dmgType = tn.damageType || 'physical';
        let hitMonster = null, hitDist = 1.0;
        for (const m of state.monsters) {
          if (m.hp <= 0) continue;
          const d = Math.hypot(m.x - p.x, m.y - p.y);
          if (d < hitDist) { hitDist = d; hitMonster = m; }
        }
        if (hitMonster) {
          applyDamage(hitMonster, p.damage, dmgType, p.tower);
          if (tn.speedFactor && tn.speedFactor !== 1) applySpeedMod(hitMonster, tn.speedFactor, tn.speedDuration);
          if (tn.dot) hitMonster.dot = { dps: tn.dot.dps, remaining: tn.dot.duration, damageType: dmgType };
        }
        if (tn.splashRadius && tn.splashRadius > 0) applySplash(p.x, p.y, tn.splashRadius, tn, hitMonster, p.tower);
        state.projectiles.splice(i, 1);
      }
    }
  }

  function spawnMonster(typeIdx, hpMult) {
    const type = campaign.monsters[typeIdx];
    const { cols, ground, pathDist } = mapRuntime;
    const candidates = [];
    for (let x = 0; x < cols; x++) {
      if (pathDist && pathDist[x] !== -1 && GROUND_TYPES[ground[x]].walkable) candidates.push(x);
    }
    if (candidates.length === 0) {
      for (let x = 0; x < cols; x++) if (GROUND_TYPES[ground[x]].walkable) candidates.push(x);
    }
    const sx = candidates[Math.floor(Math.random() * candidates.length)];

    const scaledHp = Math.round(type.hp * (hpMult || 1));
    state.monsters.push({
      x: sx + 0.3 + Math.random() * 0.4,
      y: 0.3 + Math.random() * 0.4,
      hp: scaledHp,
      maxHp: scaledHp,
      speed: type.speed,
      typeIdx,
      reward: type.reward,
      letter: type.letter,
      color: type.color,
      attacking: null,
      dot: null,
      speedMod: null,
      renderScale: 0.8 + Math.random() * 0.4,
    });
  }

  function updateMonsters() {
    const { cols, rows, ground, pathFlow } = mapRuntime;
    for (const m of state.monsters) {
      if (m.hp <= 0) continue;
      if (m.dot) {
        const dotMod = getDamageModifier(m, m.dot.damageType || 'physical');
        m.hp -= (m.dot.dps / FPS) * dotMod;
        m.dot.remaining--;
        if (m.dot.remaining <= 0) m.dot = null;
      }
      if (m.hp <= 0) continue;

      const tileX = Math.floor(m.x);
      const tileY = Math.floor(m.y);

      if (tileY >= rows - 1) {
        m.hp = 0;
        state.lives--;
        if (state.lives <= 0) { state.phase = 'GAMEOVER'; releaseWakeLock(); }
        continue;
      }

      const idx = tileY * cols + tileX;
      const flow = pathFlow ? pathFlow[idx] : -1;
      let speedMult = GROUND_TYPES[ground[idx]].speedMult || 1.0;
      if (m.speedMod) {
        speedMult *= m.speedMod.factor;
        m.speedMod.remaining--;
        if (m.speedMod.remaining <= 0) m.speedMod = null;
      }
      const mspd = m.speed * speedMult;

      if (flow === -1) {
        if (!m.attacking || m.attacking.hp <= 0) {
          let best = null, bestD = Infinity;
          for (const t of state.towers) {
            const d = distToTower(m.x, m.y, t);
            if (d < bestD) { bestD = d; best = t; }
          }
          m.attacking = best;
        }
        if (m.attacking) {
          const aSize = getTowerSize(campaign, m.attacking.typeIdx, m.attacking.rotation);
          const tcx = m.attacking.x + aSize.w / 2;
          const tcy = m.attacking.y + aSize.h / 2;
          const dx = tcx - m.x, dy = tcy - m.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1.5) {
            m.attacking.hp -= 2 / FPS;
            if (m.attacking.hp <= 0) {
              if (state.selectedPlacedTower === m.attacking) {
                state.selectedPlacedTower = null;
                hud.refreshSelection(state, campaign);
              }
              removeTower(m.attacking);
              m.attacking = null;
            }
          } else {
            m.x += (dx / dist) * mspd;
            m.y += (dy / dist) * mspd;
          }
        }
      } else {
        m.attacking = null;
        const fdx = DX[flow];
        const fdy = DY[flow];
        const isDiag = fdx !== 0 && fdy !== 0;
        const spd = isDiag ? mspd * 0.707 : mspd;
        if (isDiag) {
          m.x += fdx * spd;
          m.y += fdy * spd;
        } else if (fdx !== 0) {
          const centerY = tileY + 0.5;
          const diffY = centerY - m.y;
          if (Math.abs(diffY) > 0.01) m.y += Math.sign(diffY) * Math.min(Math.abs(diffY), mspd);
          m.x += fdx * mspd;
        } else {
          const centerX = tileX + 0.5;
          const diffX = centerX - m.x;
          if (Math.abs(diffX) > 0.01) m.x += Math.sign(diffX) * Math.min(Math.abs(diffX), mspd);
          m.y += fdy * mspd;
        }
      }
    }

    for (let i = state.monsters.length - 1; i >= 0; i--) {
      if (state.monsters[i].hp <= 0) {
        const m = state.monsters[i];
        const tileY = Math.floor(m.y);
        const killed = tileY < rows - 1;
        if (killed && state.lives > 0) {
          state.gold += m.reward;
          state.score += m.reward;
          for (const tower of state.towers) {
            const node = getTowerNode(campaign, tower);
            if (!node.goldSteal) continue;
            if (distToTower(m.x, m.y, tower) <= (node.range || 1)) {
              state.gold += node.goldSteal;
              state.score += node.goldSteal;
              tower.goldStolen = (tower.goldStolen || 0) + node.goldSteal;
            }
          }
        }
        state.monsters.splice(i, 1);
      }
    }
  }

  function startWave() {
    if (state.phase !== 'PLACE') return;
    state.selectedPlacedTower = null;
    hud.refreshSelection(state, campaign);
    state.wave++;
    const w = getWaveConfig(campaign.waves, campaign.monsters, state.wave);
    if (w.lore) showMessage(w.lore, FPS * 4);
    w.counts.forEach((count, i) => {
      for (let j = 0; j < count; j++) spawnMonster(i, w.hpMult);
    });
    state.phase = 'WAVE';
    hud.rebuildTowerButtons(state, campaign);
    requestWakeLock();
  }

  function updateSpawning() {
    if (state.phase !== 'WAVE') return;
    if (state.monsters.length === 0) {
      state.phase = 'PLACE';
      releaseWakeLock();
      var bonus = campaign.game.waveBonusGold;
      const script = getWaveScript(campaign.waves, state.wave);
      if (script && script.bonus) bonus += script.bonus;
      state.gold += bonus;
      showMessage('Wave ' + state.wave + ' complete! +' + bonus + 'g');
      hud.rebuildTowerButtons(state, campaign);
    }
  }

  function update() {
    if (state.phase === 'GAMEOVER') return;
    state.frame++;
    updateSpawning();
    updateMonsters();
    updateTowers();
    updateProjectiles();
  }

  // === Input ===
  const { cols, rows } = mapRuntime;

  let pointerDragged = false;
  /** @type {GameInput} */
  const input = {
    onPointerMove(clientX, clientY) {
      const t = renderer.clientToTile(clientX, clientY);
      state.cursor.x = Math.max(0, Math.min(mapRuntime.cols - 2, t.x));
      state.cursor.y = Math.max(0, Math.min(mapRuntime.rows - 2, t.y));
      state.cursor.visible = true;
    },
    onPointerLeave() {
      state.cursor.visible = false;
    },
    onPointerDown(_cx, _cy) {
      pointerDragged = false;
    },
    onPointerTap(clientX, clientY, wasDrag) {
      if (wasDrag) return;
      const t = renderer.clientToTile(clientX, clientY);
      const clickedTower = getTowerAt(t.x, t.y);
      if (clickedTower) {
        state.selectedPlacedTower = (state.selectedPlacedTower === clickedTower) ? null : clickedTower;
        hud.refreshSelection(state, campaign);
        return;
      }
      state.selectedPlacedTower = null;
      hud.refreshSelection(state, campaign);
      state.cursor.x = Math.max(0, Math.min(mapRuntime.cols - 2, t.x));
      state.cursor.y = Math.max(0, Math.min(mapRuntime.rows - 2, t.y));
      state.cursor.visible = true;
      placeTower();
    },
    onKey(key) {
      const pSize = getTowerSize(campaign, state.selectedTower, state.placeRotation);
      switch (key) {
        case 'ArrowUp':    state.cursor.y = Math.max(0, state.cursor.y - 1); state.cursor.visible = true; return true;
        case 'ArrowDown':  state.cursor.y = Math.min(mapRuntime.rows - pSize.h, state.cursor.y + 1); state.cursor.visible = true; return true;
        case 'ArrowLeft':  state.cursor.x = Math.max(0, state.cursor.x - 1); state.cursor.visible = true; return true;
        case 'ArrowRight': state.cursor.x = Math.min(mapRuntime.cols - pSize.w, state.cursor.x + 1); state.cursor.visible = true; return true;
        case ' ':
        case 'Enter':      placeTower(); return true;
        case 'w': case 'W': startWave(); return true;
        case 'r': case 'R': rotatePlacedTower(); return true;
        case 'x': case 'X': case 'Delete': sellTower(); return true;
        case 'Escape':     state.selectedPlacedTower = null; hud.refreshSelection(state, campaign); return true;
      }
      const n = parseInt(key);
      if (!isNaN(n) && n >= 1) {
        if (state.selectedPlacedTower) {
          const nd = getTowerNode(campaign, state.selectedPlacedTower);
          if (nd.upgrades && n <= nd.upgrades.length) { upgradeTower(n - 1); return true; }
        } else if (n <= campaign.towers.length) {
          selectTowerType(n - 1); return true;
        }
      }
      return false;
    },
  };

  // === Loop ===
  let running = false;
  let lastTime = 0;
  let accumulator = 0;
  let rafId = 0;
  function loop(ts) {
    if (!running) return;
    const dt = ts - lastTime;
    lastTime = ts;
    accumulator += dt;
    while (accumulator >= TICK_RATE) {
      update();
      accumulator -= TICK_RATE;
    }
    renderer.renderGame(state, mapRuntime, campaign);
    hud.update(state, campaign);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    renderer.setGridSize(mapRuntime.cols, mapRuntime.rows);
    recomputePath(mapRuntime);
    hud.bind({
      onStartWave: startWave,
      onRotate: rotatePlacedTower,
      onSell: sellTower,
      onPlace: () => { state.cursor.visible = true; placeTower(); },
      onBestiary: () => {},
      onSelectTowerType: selectTowerType,
      onUpgrade: upgradeTower,
      onHoverUpgrade: () => {},
      onLeaveUpgrade: () => {},
      onSave,
      onQuit: () => { stop(); onQuit(); },
    });
    hud.rebuildTowerButtons(state, campaign);
    hud.refreshSelection(state, campaign);
    hud.show();
    running = true;
    lastTime = performance.now();
    accumulator = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    hud.hide();
    releaseWakeLock();
  }

  function serialize() {
    return {
      state: cloneJson(state),
      grid: Array.from(mapRuntime.grid),
    };
  }

  function restore(snap) {
    if (!snap || !snap.state) return;
    Object.assign(state, cloneJson(snap.state));
    if (Array.isArray(snap.grid) && snap.grid.length === mapRuntime.grid.length) {
      for (let i = 0; i < snap.grid.length; i++) mapRuntime.grid[i] = snap.grid[i];
    }
    state.selectedPlacedTower = null;
    recomputePath(mapRuntime);
  }

  return {
    state,
    campaign,
    mapRuntime,
    mapDef,
    input,
    start,
    stop,
    serialize,
    restore,
  };
}

function cloneJson(v) { return JSON.parse(JSON.stringify(v)); }
