// @ts-check
/** @typedef {import('./types.js').Hud}         Hud */
/** @typedef {import('./types.js').HudHandlers} HudHandlers */
/** @typedef {import('./types.js').GameState}   GameState */
/** @typedef {import('./types.js').Campaign}    Campaign */
/** @typedef {import('./types.js').TowerDef}    TowerDef */

import { VERSION, FPS, DAMAGE_TYPES, ROT_NAMES, framesToSec } from './constants.js';
import { getMergedNode, getTowerNode, getTowerSize, getWaveConfig, isTowerUnlocked } from './campaigns.js';
import { div, span, button } from './html.js';
import { icon } from './icons.js';

/** @returns {Hud} */
export function createHud() {
  const hudEl    = /** @type {HTMLElement} */ (document.getElementById('hud'));
  const uiEl     = /** @type {HTMLElement} */ (document.getElementById('ui'));
  const goldEl   = /** @type {HTMLElement} */ (document.getElementById('hud-gold'));
  const livesEl  = /** @type {HTMLElement} */ (document.getElementById('hud-lives'));
  const verEl    = /** @type {HTMLElement} */ (document.getElementById('hud-version'));
  const phaseEl  = /** @type {HTMLElement} */ (document.getElementById('hud-phase'));
  const waveEyebrow = /** @type {HTMLElement} */ (document.getElementById('hud-wave-eyebrow'));
  const waveFill = /** @type {HTMLElement} */ (document.getElementById('hud-wave-fill'));
  const waveMetaLeft = /** @type {HTMLElement} */ (document.getElementById('hud-wave-meta-left'));
  const btnWave  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-wave'));
  const btnPlace = /** @type {HTMLButtonElement} */ (document.getElementById('btn-place'));
  const btnSell  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-sell'));
  const btnRotate = /** @type {HTMLButtonElement} */ (document.getElementById('btn-rotate'));
  const btnBestiary = /** @type {HTMLButtonElement} */ (document.getElementById('btn-bestiary'));
  const btnSpeed = /** @type {HTMLButtonElement} */ (document.getElementById('btn-speed'));
  const btnSave  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-save'));
  const btnHome  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-home'));
  const towerBtns = /** @type {HTMLElement} */ (document.getElementById('tower-buttons'));
  const upgBtns  = /** @type {HTMLElement} */ (document.getElementById('upgrade-buttons'));
  const towerInfo = /** @type {HTMLElement} */ (document.getElementById('tower-info'));
  const towerName = /** @type {HTMLElement} */ (document.getElementById('tower-info-name'));
  const towerDesc = /** @type {HTMLElement} */ (document.getElementById('tower-desc'));
  const towerStats = /** @type {HTMLElement} */ (document.getElementById('tower-stats'));

  // Inject icons into stat panels and action buttons (one-time)
  setupStatIcon(livesEl, 'heart');
  setupStatIcon(goldEl,  'coin');
  if (btnBestiary && !btnBestiary.firstChild) btnBestiary.appendChild(icon('eye', { size: 16 }));
  if (btnSave     && !btnSave.firstChild)     btnSave.appendChild(icon('save', { size: 16 }));
  if (btnHome     && !btnHome.firstChild)     btnHome.appendChild(icon('home', { size: 16 }));

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
  let currentSpeed = 1;
  btnSpeed.addEventListener('click', () => {
    currentSpeed = currentSpeed === 1 ? 5 : 1;
    btnSpeed.textContent = currentSpeed + 'x';
    handlers.onSetSpeed(currentSpeed);
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
    currentSpeed = 1;
    btnSpeed.textContent = '1x';
    closeBestiary();
  }

  /** @param {GameState} state @param {Campaign} campaign */
  function update(state, campaign) {
    lastState = state;
    lastCampaign = campaign;
    setStatValue(goldEl,  state.gold);
    setStatValue(livesEl, state.lives);
    verEl.textContent = 'v' + VERSION;
    waveEyebrow.textContent = 'Wave ' + Math.max(1, state.wave) + (campaign.waves.list ? ' / ' + campaign.waves.list.length : '');
    phaseEl.textContent =
      state.phase === 'PLACE'    ? 'Place Towers' :
      state.phase === 'WAVE'     ? 'Wave ' + state.wave + ' Incoming' :
                                    'Game Over';
    phaseEl.style.color =
      state.phase === 'WAVE'     ? 'var(--ember-bright)' :
      state.phase === 'GAMEOVER' ? 'var(--ember-bright)' :
                                    'var(--verdant)';
    waveMetaLeft.textContent = 'Score ' + state.score;

    // Wave progress bar
    const waveNum = Math.max(1, state.wave);
    const w = state.phase === 'WAVE' ? getWaveConfig(campaign.waves, campaign.monsters, waveNum) : null;
    const total = w ? w.counts.reduce((a, b) => a + b, 0) : 0;
    const remaining = state.monsters.length;
    const progress = total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;
    waveFill.style.width = (progress * 100).toFixed(1) + '%';
    waveFill.style.opacity = state.phase === 'WAVE' ? '1' : '0.25';
  }

  /** @param {GameState} state @param {Campaign} campaign */
  function rebuildTowerButtons(state, campaign) {
    lastState = state;
    lastCampaign = campaign;
    towerBtns.innerHTML = '';
    campaign.towers.forEach((t, i) => {
      if (!isTowerUnlocked(campaign.waves, t, state.wave)) return;
      const isSelected = i === state.selectedTower;
      let rot = '';
      if (t.attackDir === 'fixed') {
        rot = ROT_NAMES[isSelected ? state.placeRotation : 0];
      } else {
        const sw = t.sizeW || 2, sh = t.sizeH || 2;
        if (isSelected && sw !== sh) rot = ROT_NAMES[state.placeRotation];
      }
      towerBtns.appendChild(button({
        'data-tower': i,
        className: 'build-slot' + (isSelected ? ' selected' : ''),
        onClick: () => handlers.onSelectTowerType(i),
      }, [
        span({ className: 'build-slot-index' }, [String(i + 1)]),
        span({ className: 'build-slot-cost' }, [String(t.cost) + 'g']),
        span({
          className: 'build-slot-thumb',
          style: { background: t.bg || 'var(--ink-700)', color: t.color || 'var(--parchment)' },
        }, [t.letter || '?']),
        span({ className: 'build-slot-name' }, [t.name]),
        rot ? span({ className: 'build-slot-rot' }, [rot]) : null,
      ]));
    });
    if (state.selectedTower >= 0 && !isTowerUnlocked(campaign.waves, campaign.towers[state.selectedTower], state.wave)) {
      for (let i = 0; i < campaign.towers.length; i++) {
        if (isTowerUnlocked(campaign.waves, campaign.towers[i], state.wave)) {
          handlers.onSelectTowerType(i);
          return;
        }
      }
    }
    if (!state.selectedPlacedTower) showTowerPreview(campaign.towers[state.selectedTower]);
  }

  /** Show description + stats for a tower def/node in the centre tray slot. */
  function showTowerPreview(node) {
    if (!node) {
      towerName.textContent = '—';
      towerDesc.style.display = 'none';
      towerStats.style.display = 'none';
      return;
    }
    towerName.textContent = node.name || 'Tower';
    towerDesc.textContent = node.desc || '';
    towerDesc.style.display = node.desc ? '' : 'none';
    towerStats.textContent = towerStatSummary(node);
    towerStats.style.display = towerStats.textContent ? '' : 'none';
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

    upgBtns.innerHTML = '';

    if (hasSel) {
      const tower = /** @type {import('./types.js').Tower} */ (state.selectedPlacedTower);
      const node = getTowerNode(campaign, tower);
      const refund = getSellRefund(state, campaign, tower);
      btnSell.textContent = 'Sell (+' + refund + 'g)';
      btnSell.style.display = '';

      const parts = [];
      if (tower.kills)       parts.push(tower.kills + ' kills');
      if (tower.damageDealt) parts.push(Math.round(tower.damageDealt) + ' dmg');
      if (tower.goldStolen)  parts.push(tower.goldStolen + 'g stolen');
      towerName.textContent = node.name || 'Tower';
      towerDesc.textContent = node.desc || '';
      towerDesc.style.display = node.desc ? '' : 'none';
      if (parts.length) {
        towerStats.textContent = parts.join('  ·  ');
        towerStats.style.display = '';
      } else {
        towerStats.textContent = towerStatSummary(node);
        towerStats.style.display = towerStats.textContent ? '' : 'none';
      }

      if (node.upgrades && node.upgrades.length > 0) {
        const base = campaign.towers[tower.typeIdx];
        const basePath = tower.upgradePath || [];
        node.upgrades.forEach((_upg, i) => {
          const em = getMergedNode(base, basePath.concat(i));
          upgBtns.appendChild(button({
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

function setupStatIcon(el, iconName) {
  if (!el || el.dataset.statReady === '1') return;
  const slot = el.querySelector('.hud-stat-icon');
  if (slot) {
    slot.innerHTML = '';
    slot.appendChild(icon(iconName, { size: 18 }));
  }
  el.dataset.statReady = '1';
}

function setStatValue(el, n) {
  const v = el && el.querySelector('.hud-stat-value');
  if (v) v.textContent = String(n);
}

function emptyHandlers() {
  const noop = () => {};
  return {
    onStartWave: noop,
    onRotate: noop,
    onSell: noop,
    onPlace: noop,
    onBestiary: noop,
    onSetSpeed: noop,
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

  const list = campaign.waves.list || [];
  const rows = campaign.monsters.map((m, i) => {
    const visible = list.slice(0, nextWave).some(e => e.monsters && e.monsters[m.id] > 0);
    if (!visible) return null;

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
    div({ className: 'bestiary-box panel panel-ornate' }, [
      div({ className: 'bestiary-title' }, ['Bestiary']),
      div({ className: 'divider-ornate', style: { margin: '12px 0 14px' } }, [span({}, ['✦'])]),
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
