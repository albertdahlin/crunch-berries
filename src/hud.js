// @ts-check
/** @typedef {import('./types.js').Hud}         Hud */
/** @typedef {import('./types.js').HudHandlers} HudHandlers */
/** @typedef {import('./types.js').GameState}   GameState */
/** @typedef {import('./types.js').Campaign}    Campaign */
/** @typedef {import('./types.js').TowerDef}    TowerDef */

import { VERSION, FPS, DAMAGE_TYPES, ROT_NAMES, framesToSec } from './constants.js';
import { getMergedNode, getTowerNode, getTowerSize } from './campaigns.js';
import { div, span, button } from './html.js';

/** @returns {Hud} */
export function createHud() {
  const hudEl    = /** @type {HTMLElement} */ (document.getElementById('hud'));
  const uiEl     = /** @type {HTMLElement} */ (document.getElementById('ui'));
  const goldEl   = /** @type {HTMLElement} */ (document.getElementById('hud-gold'));
  const livesEl  = /** @type {HTMLElement} */ (document.getElementById('hud-lives'));
  const waveEl   = /** @type {HTMLElement} */ (document.getElementById('hud-wave'));
  const scoreEl  = /** @type {HTMLElement} */ (document.getElementById('hud-score'));
  const verEl    = /** @type {HTMLElement} */ (document.getElementById('hud-version'));
  const phaseEl  = /** @type {HTMLElement} */ (document.getElementById('hud-phase'));
  const btnWave  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-wave'));
  const btnPlace = /** @type {HTMLButtonElement} */ (document.getElementById('btn-place'));
  const btnSell  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-sell'));
  const btnRotate = /** @type {HTMLButtonElement} */ (document.getElementById('btn-rotate'));
  const btnBestiary = /** @type {HTMLButtonElement} */ (document.getElementById('btn-bestiary'));
  const btnSave  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-save'));
  const btnHome  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-home'));
  const towerBtns = /** @type {HTMLElement} */ (document.getElementById('tower-buttons'));
  const upgBtns  = /** @type {HTMLElement} */ (document.getElementById('upgrade-buttons'));
  const towerInfo = /** @type {HTMLElement} */ (document.getElementById('tower-info'));
  const towerDesc = /** @type {HTMLElement} */ (document.getElementById('tower-desc'));
  const towerStats = /** @type {HTMLElement} */ (document.getElementById('tower-stats'));

  /** @type {HudHandlers} */
  let handlers = emptyHandlers();

  // Latest state/campaign for listeners that need them lazily.
  /** @type {?GameState} */ let lastState = null;
  /** @type {?Campaign} */  let lastCampaign = null;

  btnWave.addEventListener('click', () => handlers.onStartWave());
  btnPlace.addEventListener('click', () => handlers.onPlace());
  btnSell.addEventListener('click', () => handlers.onSell());
  btnRotate.addEventListener('click', () => handlers.onRotate());
  btnBestiary.addEventListener('click', () => {
    if (!lastState || !lastCampaign) return;
    toggleBestiary(lastState, lastCampaign);
  });
  if (btnSave) btnSave.addEventListener('click', () => handlers.onSave());
  if (btnHome) btnHome.addEventListener('click', () => handlers.onQuit());

  function show() {
    hudEl.style.display = 'flex';
    uiEl.style.display = 'flex';
  }
  function hide() {
    hudEl.style.display = 'none';
    uiEl.style.display = 'none';
    closeBestiary();
  }

  /** @param {GameState} state @param {Campaign} campaign */
  function update(state, campaign) {
    lastState = state;
    lastCampaign = campaign;
    goldEl.textContent  = 'G:' + state.gold;
    livesEl.textContent = 'L:' + state.lives;
    waveEl.textContent  = 'W:' + state.wave;
    scoreEl.textContent = 'S:' + state.score;
    verEl.textContent   = 'v' + VERSION;
    phaseEl.textContent =
      state.phase === 'PLACE' ? 'PLACE TOWERS' :
      state.phase === 'WAVE'  ? 'WAVE ' + state.wave :
                                 'GAME OVER';
    phaseEl.style.color =
      state.phase === 'WAVE'     ? '#ff9800' :
      state.phase === 'GAMEOVER' ? '#f44336' :
                                    '#4caf50';
  }

  /** @param {GameState} state @param {Campaign} campaign */
  function rebuildTowerButtons(state, campaign) {
    lastState = state;
    lastCampaign = campaign;
    towerBtns.innerHTML = '';
    campaign.towers.forEach((t, i) => {
      let label = (i + 1) + ': ' + t.name + ' (' + t.cost + 'g)';
      if (t.attackDir === 'fixed') {
        label += ' ' + ROT_NAMES[state.selectedTower === i ? state.placeRotation : 0];
      } else {
        const sw = t.sizeW || 2, sh = t.sizeH || 2;
        if (state.selectedTower === i && sw !== sh) label += ' ' + ROT_NAMES[state.placeRotation];
      }
      towerBtns.appendChild(button({
        'data-tower': i,
        className: i === state.selectedTower ? 'selected' : '',
        onClick: () => handlers.onSelectTowerType(i),
      }, [label]));
    });
    if (!state.selectedPlacedTower) showTowerPreview(campaign.towers[state.selectedTower]);
  }

  /** Show description + stats for a tower def/node. */
  function showTowerPreview(node) {
    if (!node) { towerInfo.style.display = 'none'; return; }
    towerDesc.textContent = node.desc || '';
    towerDesc.style.display = node.desc ? '' : 'none';
    towerStats.textContent = towerStatSummary(node);
    towerStats.style.display = '';
    towerInfo.style.display = '';
  }

  /**
   * Keep the selection / upgrade / sell UI in sync with state.selectedPlacedTower.
   * @param {GameState} state @param {Campaign} campaign
   */
  function refreshSelection(state, campaign) {
    lastState = state;
    lastCampaign = campaign;
    const hasSel = !!state.selectedPlacedTower;
    towerBtns.style.display = hasSel ? 'none' : '';
    btnPlace.style.display  = hasSel ? 'none' : '';
    btnWave.style.display   = hasSel ? 'none' : '';
    btnBestiary.style.display = hasSel ? 'none' : '';
    if (btnSave) btnSave.style.display = hasSel ? 'none' : '';
    if (btnHome) btnHome.style.display = hasSel ? 'none' : '';

    upgBtns.innerHTML = '';

    if (hasSel) {
      const tower = /** @type {import('./types.js').Tower} */ (state.selectedPlacedTower);
      const node = getTowerNode(campaign, tower);
      const refund = getSellRefund(state, campaign, tower);
      btnSell.textContent = 'Sell ' + (node.name || '?') + ' (+' + refund + 'g)';
      btnSell.style.display = '';

      const parts = [];
      if (tower.kills)      parts.push(tower.kills + ' kills');
      if (tower.damageDealt) parts.push(Math.round(tower.damageDealt) + ' dmg');
      if (tower.goldStolen) parts.push(tower.goldStolen + 'g stolen');
      towerDesc.textContent = node.desc || '';
      towerDesc.style.display = node.desc ? '' : 'none';
      if (parts.length) {
        towerStats.textContent = parts.join('  ·  ');
        towerStats.style.display = '';
      } else {
        towerStats.style.display = 'none';
      }
      towerInfo.style.display = (node.desc || parts.length) ? '' : 'none';

      if (node.upgrades && node.upgrades.length > 0) {
        const base = campaign.towers[tower.typeIdx];
        const basePath = tower.upgradePath || [];
        node.upgrades.forEach((_upg, i) => {
          const em = getMergedNode(base, basePath.concat(i));
          upgBtns.appendChild(button({
            style: { background: '#1b5e20', borderColor: '#4caf50', color: '#fff' },
            onClick:      () => handlers.onUpgrade(i),
            onMouseEnter: () => showTowerPreview(em),
            onMouseLeave: () => refreshSelection(state, campaign),
          }, [(i + 1) + '. ' + em.name + ' (' + em.cost + 'g)']));
        });
      }

      if (state.phase === 'PLACE' && (node.attackDir === 'fixed' || node.pierce)) {
        btnRotate.style.display = '';
      } else {
        btnRotate.style.display = 'none';
      }
    } else {
      btnSell.style.display = 'none';
      btnRotate.style.display = 'none';
      showTowerPreview(campaign.towers[state.selectedTower]);
    }
  }

  function flash(_msg) { /* canvas renders the message via state; no DOM flash */ }

  /** @param {HudHandlers} h */
  function bind(h) {
    handlers = { ...emptyHandlers(), ...h };
  }

  return {
    show, hide, update, rebuildTowerButtons, refreshSelection, flash, bind,
  };
}

function emptyHandlers() {
  const noop = () => {};
  return {
    onStartWave: noop,
    onRotate: noop,
    onSell: noop,
    onPlace: noop,
    onBestiary: noop,
    onSave: noop,
    onQuit: noop,
    onSelectTowerType: noop,
    onUpgrade: noop,
    onHoverUpgrade: noop,
    onLeaveUpgrade: noop,
  };
}

/** @param {TowerDef} node */
function towerStatSummary(node) {
  const p = [];
  if (node.range && node.range > 0) {
    p.push('Dmg:' + node.damage);
    p.push('Rate:' + framesToSec(node.fireRate || 0) + 's');
    p.push('Range:' + node.range);
  }
  p.push('HP:' + node.hp);
  if (node.damageType && node.damageType !== 'physical') p.push(node.damageType);
  if (node.splashRadius && node.splashRadius > 0) p.push('Splash:' + node.splashRadius);
  if (node.pierce) p.push('Pierce');
  if (node.dot) p.push('DOT:' + node.dot.dps + '/s');
  if (node.speedFactor && node.speedFactor < 1) p.push('Slow:' + Math.round((1 - node.speedFactor) * 100) + '%');
  if (node.goldSteal && node.goldSteal > 0) p.push('+' + node.goldSteal + 'g/nearby kill');
  return p.join('  ');
}

function getSellRefund(state, campaign, tower) {
  const type = campaign.towers[tower.typeIdx];
  if (!type) return 0;
  const total = tower.totalCost || type.cost || 0;
  const path = tower.upgradePath || [];
  if (state.phase === 'PLACE' && tower.placedAtWave === state.wave && path.length === 0) return total;
  return Math.floor(total * campaign.game.sellRefundPercent / 100);
}

// === Bestiary overlay ===

function toggleBestiary(state, campaign) {
  const existing = document.querySelector('.bestiary-overlay');
  if (existing) { existing.remove(); return; }

  const waveNum = Math.max(1, state.wave || 1);
  const nextWave = state.phase === 'PLACE' ? waveNum + 1 : waveNum;
  const hpMult = 1 + (waveNum - 1) * (campaign.waves.hpScale || 0) / 100;

  const rows = campaign.monsters.map((m, i) => {
    const unlock = (campaign.waves.unlockWave[i] || 1);
    if (nextWave < unlock) return null;

    const scaledHp = Math.round(m.hp * hpMult);
    const spd = +(m.speed * FPS).toFixed(1);
    let statsText = 'HP: ' + scaledHp + ' (base ' + m.hp + ')  ·  Speed: ' + spd + ' t/s  ·  Reward: ' + m.reward + 'g';
    if (m.damageModifiers) {
      const parts = [];
      for (const dt of DAMAGE_TYPES) {
        const v = m.damageModifiers[dt];
        if (v !== undefined && v !== 1) {
          parts.push(dt.charAt(0).toUpperCase() + dt.slice(1) + ' x' + v);
        }
      }
      if (parts.length) statsText += '\nModifiers: ' + parts.join(', ');
    }
    const stats = div({ className: 'bestiary-stats', textContent: statsText });

    return div({
      className: 'bestiary-row',
      onClick: (/** @type {MouseEvent} */ e) => {
        e.stopPropagation();
        const wasOpen = stats.style.display === 'block';
        if (stats.parentElement && stats.parentElement.parentElement) {
          stats.parentElement.parentElement.querySelectorAll('.bestiary-stats')
            .forEach(s => { /** @type {HTMLElement} */ (s).style.display = 'none'; });
        }
        if (!wasOpen) stats.style.display = 'block';
      },
    }, [
      span({
        className: 'bestiary-icon',
        style: { background: m.color, color: '#000' },
      }, [m.letter]),
      span({ className: 'bestiary-info' }, [
        span({ className: 'bestiary-name' }, [m.name]),
        m.desc ? span({ className: 'bestiary-desc' }, [m.desc]) : null,
      ]),
      stats,
    ]);
  });

  const ov = div({
    className: 'bestiary-overlay',
    onClick: (/** @type {MouseEvent} */ e) => { if (e.target === ov) ov.remove(); },
  }, [
    div({ className: 'bestiary-box' }, [
      div({ className: 'bestiary-title' }, ['Bestiary']),
      ...rows,
      div({
        className: 'bestiary-close',
        onClick: () => ov.remove(),
      }, ['Close']),
    ]),
  ]);
  document.body.appendChild(ov);
}

function closeBestiary() {
  const ov = document.querySelector('.bestiary-overlay');
  if (ov) ov.remove();
}
