// @ts-check
/** @typedef {import('./types.js').Renderer}    Renderer */
/** @typedef {import('./types.js').MapRuntime}  MapRuntime */
/** @typedef {import('./types.js').GameState}   GameState */
/** @typedef {import('./types.js').Campaign}    Campaign */
/** @typedef {import('./types.js').Cursor}      Cursor */
/** @typedef {import('./types.js').EditorOverlay} EditorOverlay */

import { DX, DY, GROUND_TYPES } from './constants.js';
import { getMergedNode, getTowerSize, getTowerNode } from './campaigns.js';

/**
 * Create a 2D canvas renderer.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Renderer}
 */
export function createCanvasRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let TILE_SIZE = 30;
  let CANVAS_W = 0;
  let CANVAS_H = 0;
  let COLS = 15;
  let ROWS = 15;

  function setGridSize(cols, rows) {
    COLS = cols;
    ROWS = rows;
    resize();
  }

  function resize() {
    TILE_SIZE = Math.floor(window.innerWidth / COLS);
    CANVAS_W = COLS * TILE_SIZE;
    CANVAS_H = ROWS * TILE_SIZE;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = CANVAS_W + 'px';
    canvas.style.height = CANVAS_H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clear() {
    ctx.fillStyle = '#0e0e1a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  function clientToTile(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top) * scaleY;
    return {
      px, py,
      x: Math.floor(px / TILE_SIZE),
      y: Math.floor(py / TILE_SIZE),
    };
  }

  function getDimensions() {
    return { tile: TILE_SIZE, canvasW: CANVAS_W, canvasH: CANVAS_H };
  }

  /** @param {MapRuntime} map */
  function drawGrid(map) {
    const { cols, rows, ground } = map;
    ctx.font = (TILE_SIZE - 4) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const gt = GROUND_TYPES[ground[y * cols + x]];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        ctx.fillStyle = gt.bg;
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        if (gt.char) {
          ctx.fillStyle = gt.charColor;
          ctx.fillText(gt.char, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
        }
      }
    }

    ctx.strokeStyle = '#1a1a2a';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE, 0);
      ctx.lineTo(x * TILE_SIZE, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * TILE_SIZE);
      ctx.lineTo(CANVAS_W, y * TILE_SIZE);
      ctx.stroke();
    }

    ctx.fillStyle = '#2a4a2a';
    for (let x = 0; x < cols; x++) {
      if (GROUND_TYPES[ground[x]].walkable)
        ctx.fillText('v', x * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 2);
    }
    ctx.fillStyle = '#2a2a4a';
    for (let x = 0; x < cols; x++) {
      if (GROUND_TYPES[ground[(rows - 1) * cols + x]].walkable)
        ctx.fillText('=', x * TILE_SIZE + TILE_SIZE / 2, (rows - 1) * TILE_SIZE + TILE_SIZE / 2);
    }
  }

  /** @param {GameState} state @param {Campaign} campaign */
  function drawTowers(state, campaign) {
    for (const tower of state.towers) {
      const node = getTowerNode(campaign, tower);
      const size = getTowerSize(campaign, tower.typeIdx, tower.rotation);
      const px = tower.x * TILE_SIZE;
      const py = tower.y * TILE_SIZE;
      const tw = size.w * TILE_SIZE;
      const th = size.h * TILE_SIZE;

      ctx.fillStyle = node.bg;
      ctx.fillRect(px + 1, py + 1, tw - 2, th - 2);

      if (tower.hp < tower.maxHp) {
        const hpRatio = tower.hp / tower.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(px + 2, py + th - 4, tw - 4, 3);
        ctx.fillStyle = hpRatio > 0.5 ? '#4caf50' : hpRatio > 0.25 ? '#ff9800' : '#f44336';
        ctx.fillRect(px + 2, py + th - 4, (tw - 4) * hpRatio, 3);
      }

      ctx.font = 'bold ' + TILE_SIZE + 'px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = node.color;
      ctx.fillText(node.letter, px + tw / 2, py + th / 2);

      if (node.attackDir === 'fixed') {
        const as = TILE_SIZE * 0.3;
        ctx.fillStyle = node.color;
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

      if (tower === state.selectedPlacedTower) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, tw - 2, th - 2);
        const tcx = (tower.x + size.w / 2) * TILE_SIZE;
        const tcy = (tower.y + size.h / 2) * TILE_SIZE;
        const eRange = node.range || 0;
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
        ctx.beginPath();
        ctx.arc(tcx, tcy, (eRange + Math.min(size.w, size.h) / 2) * TILE_SIZE, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }

  /** @param {GameState} state */
  function drawMonsters(state) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const m of state.monsters) {
      if (m.hp <= 0) continue;
      const px = m.x * TILE_SIZE;
      const py = m.y * TILE_SIZE;
      const fontSize = Math.round((TILE_SIZE - 2) * (m.renderScale || 1));

      if (m.speedMod) {
        ctx.fillStyle = m.speedMod.factor < 1
          ? 'rgba(100, 181, 246, 0.3)'
          : 'rgba(255, 235, 59, 0.3)';
        ctx.beginPath();
        ctx.arc(px, py, TILE_SIZE / 2 + 4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (m.dot) {
        ctx.fillStyle = 'rgba(129, 199, 132, 0.3)';
        ctx.beginPath();
        ctx.arc(px, py, TILE_SIZE / 2 + 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.font = 'bold ' + fontSize + 'px monospace';
      ctx.fillStyle = m.color;
      ctx.fillText(m.letter, px, py);

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

  /** @param {GameState} state */
  function drawProjectiles(state) {
    for (const p of state.projectiles) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * TILE_SIZE, p.y * TILE_SIZE, TILE_SIZE * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** @param {GameState} state @param {MapRuntime} map @param {Campaign} campaign */
  function drawCursor(state, map, campaign) {
    if (!state.cursor.visible) return;
    const type = campaign.towers[state.selectedTower];
    if (!type) return;
    const size = getTowerSize(campaign, state.selectedTower, state.placeRotation);
    const px = state.cursor.x * TILE_SIZE;
    const py = state.cursor.y * TILE_SIZE;
    const tw = size.w * TILE_SIZE;
    const th = size.h * TILE_SIZE;
    const canPlace = canPlaceAt(state.cursor.x, state.cursor.y, state.selectedTower, state.placeRotation, campaign, map);

    ctx.fillStyle = canPlace ? 'rgba(255,255,255,0.15)' : 'rgba(255,80,80,0.15)';
    ctx.fillRect(px, py, tw, th);
    ctx.strokeStyle = canPlace ? 'rgba(255,255,255,0.5)' : 'rgba(255,80,80,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, tw - 1, th - 1);

    ctx.font = 'bold ' + TILE_SIZE + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = canPlace ? 'rgba(255,255,255,0.5)' : 'rgba(255,80,80,0.3)';
    ctx.fillText(type.letter, px + tw / 2, py + th / 2);

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

    if (canPlace) {
      const range = type.range || 0;
      if (type.pierce) {
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

  /** @param {GameState} state */
  function drawEffects(state) {
    for (let i = state.effects.length - 1; i >= 0; i--) {
      const e = state.effects[i];

      if (e.type === 'circle') {
        const progress = 1 - (e.ttl / 8);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = e.ttl / 8;
        ctx.beginPath();
        ctx.arc(e.x * TILE_SIZE, e.y * TILE_SIZE, (e.radius || 0) * TILE_SIZE * progress, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.wide ? Math.max(4, TILE_SIZE * 0.4) : 2;
        ctx.globalAlpha = e.ttl / 4;
        ctx.beginPath();
        ctx.moveTo(e.x * TILE_SIZE, e.y * TILE_SIZE);
        ctx.lineTo((e.tx || 0) * TILE_SIZE, (e.ty || 0) * TILE_SIZE);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      e.ttl--;
      if (e.ttl <= 0) state.effects.splice(i, 1);
    }
  }

  /** @param {GameState} state */
  function drawMessage(state) {
    // Rendered via a shared HTML overlay (#game-message) so both renderers
    // behave identically and text scales with the viewport.
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

  /** @param {GameState} state */
  function drawGameOver(state) {
    // Game-over is rendered via a shared HTML overlay (#game-over) so both
    // renderers behave identically and text scales with the viewport.
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

  /** @param {Cursor} cursor @param {EditorOverlay} overlay */
  function drawEditorCursor(cursor, overlay) {
    if (!cursor.visible) return;
    const px = cursor.x * TILE_SIZE;
    const py = cursor.y * TILE_SIZE;
    const sz = overlay.brushSize;

    ctx.fillStyle = GROUND_TYPES[overlay.brush].bg;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(px, py, TILE_SIZE * sz, TILE_SIZE * sz);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE * sz - 1, TILE_SIZE * sz - 1);

    const name = GROUND_TYPES[overlay.brush].name;
    if (name) {
      ctx.font = Math.floor(TILE_SIZE * 0.5) + 'px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(name, px + TILE_SIZE * sz / 2, py + TILE_SIZE * sz / 2);
    }
  }

  /** Local placement feasibility: same rules as game.js canPlaceTower. */
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

  /** @param {GameState} state @param {MapRuntime} map @param {Campaign} campaign */
  function renderGame(state, map, campaign) {
    if (map.cols !== COLS || map.rows !== ROWS) setGridSize(map.cols, map.rows);
    clear();
    drawGrid(map);
    drawTowers(state, campaign);
    drawMonsters(state);
    drawProjectiles(state);
    drawCursor(state, map, campaign);
    drawEffects(state);
    drawMessage(state);
    drawGameOver(state);
  }

  /** @param {MapRuntime} map @param {Cursor} cursor @param {EditorOverlay} overlay */
  function renderEditor(map, cursor, overlay) {
    if (map.cols !== COLS || map.rows !== ROWS) setGridSize(map.cols, map.rows);
    clear();
    drawGrid(map);
    drawEditorCursor(cursor, overlay);
  }

  window.addEventListener('resize', resize);

  return {
    renderGame,
    renderEditor,
    resize,
    clientToTile,
    getDimensions,
    clear,
    setGridSize,
  };
}
