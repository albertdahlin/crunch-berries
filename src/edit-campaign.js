// @ts-check
/** @typedef {import('./types.js').Campaign} Campaign */
/** @typedef {import('./types.js').TowerDef} TowerDef */

import {
  DAMAGE_TYPES, FPS, framesToSec, secToFrames, esc,
} from './constants.js';
import {
  getCampaignById, upsertUserCampaign, deleteUserCampaign, cloneCampaignForEdit,
  getConfigNode, getMergedNode,
} from './campaigns.js';

let activeController = null;

/**
 * @param {{campaignId: string, onExit: () => void}} opts
 */
export function openCampaignEditor(opts) {
  if (activeController) activeController.destroy();

  const { campaignId, onExit } = opts;
  const source = getCampaignById(campaignId);
  if (!source) { onExit(); return; }

  // Built-ins are read-only — editing them requires cloning first.
  let campaign = source.builtin ? cloneCampaignForEdit(source) : source;

  const rootEl = /** @type {HTMLElement} */ (document.getElementById('edit-campaign'));
  const listView   = /** @type {HTMLElement} */ (document.getElementById('settings-list'));
  const detailView = /** @type {HTMLElement} */ (document.getElementById('settings-detail'));
  const detailTitle = /** @type {HTMLElement} */ (document.getElementById('settings-detail-title'));
  const detailBody  = /** @type {HTMLElement} */ (document.getElementById('settings-detail-body'));
  const nameInput   = /** @type {HTMLInputElement} */ (document.getElementById('edit-campaign-name'));

  const towersDiv   = /** @type {HTMLElement} */ (document.getElementById('settings-towers'));
  const monstersDiv = /** @type {HTMLElement} */ (document.getElementById('settings-monsters'));
  const wavesDiv    = /** @type {HTMLElement} */ (document.getElementById('settings-wave-monsters'));

  // Mode tracking for detail view
  /** @type {{type: ?('tower'|'monster'), index: number}} */
  let detailState = { type: null, index: -1 };
  let treePath = /** @type {number[]} */ ([]);

  nameInput.value = campaign.name;
  nameInput.readOnly = source.builtin && campaign === source;

  showList();

  // ==== List view ====
  function showList() {
    detailState = { type: null, index: -1 };
    treePath = [];
    listView.style.display = '';
    detailView.style.display = 'none';
    populateList();
  }

  function populateList() {
    towersDiv.innerHTML = '';
    campaign.towers.forEach((t, i) => {
      towersDiv.appendChild(listItem(t.color, t.letter, t.name, () => openDetail('tower', i)));
    });
    monstersDiv.innerHTML = '';
    campaign.monsters.forEach((m, i) => {
      monstersDiv.appendChild(listItem(m.color, m.letter, m.name, () => openDetail('monster', i)));
    });
    populateWaveFields();
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-startGold')).value = String(campaign.game.startGold);
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-startLives')).value = String(campaign.game.startLives);
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-waveBonusGold')).value = String(campaign.game.waveBonusGold);
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-sellRefundPercent')).value = String(campaign.game.sellRefundPercent);
  }

  function populateWaveFields() {
    wavesDiv.innerHTML = '';
    campaign.monsters.forEach((m, i) => {
      const div = document.createElement('div');
      div.className = 'cfg-row';
      div.innerHTML =
        '<span style="color:' + m.color + '">' + esc(m.name) + '</span>' +
        '<label>Count ' + helpBtn('Base spawns per wave. Doubled every N waves') +
          ' <input type="number" class="wv-base" min="0" value="' + (campaign.waves.baseCounts[i] || 0) + '"></label>' +
        '<label>Unlock ' + helpBtn('First wave this monster appears') +
          ' <input type="number" class="wv-unlock" min="1" value="' + (campaign.waves.unlockWave[i] || 1) + '"></label>';
      wavesDiv.appendChild(div);
    });
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-scaleEvery')).value = String(campaign.waves.scaleEvery);
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-hpScale')).value = String(campaign.waves.hpScale ?? 20);
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-intervalStart')).value = String(framesToSec(campaign.waves.intervalStart));
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-intervalDecay')).value = String(framesToSec(campaign.waves.intervalDecay));
    /** @type {HTMLInputElement} */ (document.getElementById('cfg-intervalMin')).value = String(framesToSec(campaign.waves.intervalMin));
  }

  function listItem(color, letter, name, onClick) {
    const div = document.createElement('div');
    div.className = 'cfg-list-item';
    div.innerHTML =
      '<div class="cfg-swatch" style="background:' + color + '">' + esc(letter) + '</div>' +
      '<span class="cfg-list-name">' + esc(name) + '</span>' +
      '<span class="cfg-list-arrow">&#9654;</span>';
    div.addEventListener('click', onClick);
    return div;
  }

  // ==== Detail view ====
  function openDetail(type, index) {
    readCampaignFromForm();
    detailState = { type, index };
    listView.style.display = 'none';
    detailView.style.display = 'flex';
    detailBody.innerHTML = '';
    if (type === 'tower') {
      treePath = [];
      renderTowerTreeNode(index, []);
    } else {
      detailTitle.textContent = 'Monster: ' + campaign.monsters[index].name;
      detailBody.appendChild(createMonsterFields(campaign.monsters[index]));
    }
  }

  function renderTowerTreeNode(towerIdx, path) {
    const root = campaign.towers[towerIdx];
    const node = getConfigNode(root, path);
    let titleText = 'Tower: ' + root.name;
    let cur = root;
    for (const idx of path) {
      cur = cur.upgrades[idx];
      titleText += ' \u203a ' + cur.name;
    }
    detailTitle.textContent = titleText;
    const isRoot = path.length === 0;
    const parent = isRoot ? null : getMergedNode(root, path.slice(0, -1));
    detailBody.innerHTML = '';
    detailBody.appendChild(createTowerFields(node, isRoot, parent));

    if (path.length > 0) {
      const nav = document.createElement('div');
      nav.className = 'tree-nav';
      let crumbNode = root;
      const crumb0 = document.createElement('span');
      crumb0.className = 'tree-crumb';
      crumb0.textContent = root.name;
      crumb0.addEventListener('click', () => { saveTowerFormToNode(); treePath = []; renderTowerTreeNode(towerIdx, []); });
      nav.appendChild(crumb0);
      for (let d = 0; d < path.length; d++) {
        nav.appendChild(document.createTextNode(' \u203a '));
        crumbNode = crumbNode.upgrades[path[d]];
        const span = document.createElement('span');
        span.textContent = crumbNode.name;
        if (d < path.length - 1) {
          span.className = 'tree-crumb';
          const targetPath = path.slice(0, d + 1);
          span.addEventListener('click', () => { saveTowerFormToNode(); treePath = targetPath; renderTowerTreeNode(towerIdx, targetPath); });
        } else {
          span.className = 'tree-crumb current';
        }
        nav.appendChild(span);
      }
      detailBody.insertBefore(nav, detailBody.firstChild);
    }

    const fieldset = document.createElement('fieldset');
    fieldset.innerHTML = '<legend>Upgrades</legend>';
    const listDiv = document.createElement('div');
    listDiv.className = 'tree-upgrade-list';
    const upgrades = node.upgrades || [];
    upgrades.forEach((_upg, i) => {
      const em = getMergedNode(root, path.concat(i));
      const row = document.createElement('div');
      row.className = 'cfg-list-item';
      row.innerHTML =
        '<div class="cfg-swatch" style="background:' + (em.bg || em.color) + '">' + esc(em.letter) + '</div>' +
        '<span class="cfg-list-name">' + esc(em.name) + ' <span style="color:#888;font-size:11px">(' + em.cost + 'g)</span></span>';
      const rm = document.createElement('button');
      rm.textContent = '\u00d7';
      rm.className = 'tree-child-rm';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        saveTowerFormToNode();
        node.upgrades.splice(i, 1);
        if (node.upgrades.length === 0) delete node.upgrades;
        renderTowerTreeNode(towerIdx, path);
      });
      row.appendChild(rm);
      row.addEventListener('click', () => {
        saveTowerFormToNode();
        treePath = path.concat(i);
        renderTowerTreeNode(towerIdx, treePath);
      });
      listDiv.appendChild(row);
    });
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add';
    addBtn.className = 'tree-child-add';
    addBtn.addEventListener('click', () => {
      saveTowerFormToNode();
      if (!node.upgrades) node.upgrades = [];
      const merged = getMergedNode(root, path);
      const clone = { name: 'New', letter: merged.letter, color: merged.color, bg: merged.bg, cost: 10 };
      node.upgrades.push(clone);
      treePath = path.concat(node.upgrades.length - 1);
      renderTowerTreeNode(towerIdx, treePath);
    });
    listDiv.appendChild(addBtn);
    fieldset.appendChild(listDiv);
    detailBody.appendChild(fieldset);
  }

  function saveTowerFormToNode() {
    if (detailState.type !== 'tower') return;
    const div = detailBody.querySelector('.cfg-item');
    if (!div) return;
    const root = campaign.towers[detailState.index];
    const node = getConfigNode(root, treePath);
    const isChild = treePath.length > 0;
    const parent = isChild ? getMergedNode(root, treePath.slice(0, -1)) : null;
    const formData = readTowerFromForm(/** @type {HTMLElement} */ (div), parent);
    const upgrades = node.upgrades;
    for (const key in node) delete node[key];
    Object.assign(node, formData);
    if (upgrades) node.upgrades = upgrades;
  }

  function closeDetail() {
    const { type, index } = detailState;
    if (type === 'tower') saveTowerFormToNode();
    else if (type === 'monster') {
      const div = detailBody.querySelector('.cfg-item');
      if (div) campaign.monsters[index] = readMonsterFromForm(/** @type {HTMLElement} */ (div));
    }
    treePath = [];
    showList();
  }

  function deleteDetailItem() {
    const { type, index } = detailState;
    if (type === 'tower') {
      if (campaign.towers.length <= 1) return;
      campaign.towers.splice(index, 1);
    } else if (type === 'monster') {
      if (campaign.monsters.length <= 1) return;
      campaign.monsters.splice(index, 1);
      campaign.waves.baseCounts.splice(index, 1);
      campaign.waves.unlockWave.splice(index, 1);
    }
    showList();
  }

  function readCampaignFromForm() {
    const baseDivs = wavesDiv.querySelectorAll('.cfg-row');
    campaign.waves.baseCounts = Array.from(baseDivs).map(d =>
      +(/** @type {HTMLInputElement} */(d.querySelector('.wv-base'))).value || 0);
    campaign.waves.unlockWave = Array.from(baseDivs).map(d =>
      +(/** @type {HTMLInputElement} */(d.querySelector('.wv-unlock'))).value || 1);
    campaign.waves.scaleEvery = +/** @type {HTMLInputElement} */ (document.getElementById('cfg-scaleEvery')).value || 2;
    campaign.waves.hpScale = +/** @type {HTMLInputElement} */ (document.getElementById('cfg-hpScale')).value || 0;
    campaign.waves.intervalStart = secToFrames(+/** @type {HTMLInputElement} */ (document.getElementById('cfg-intervalStart')).value || 1.33);
    campaign.waves.intervalDecay = secToFrames(+/** @type {HTMLInputElement} */ (document.getElementById('cfg-intervalDecay')).value || 0.1);
    campaign.waves.intervalMin = secToFrames(+/** @type {HTMLInputElement} */ (document.getElementById('cfg-intervalMin')).value || 0.33);

    campaign.game.startGold = +/** @type {HTMLInputElement} */ (document.getElementById('cfg-startGold')).value || 50;
    campaign.game.startLives = +/** @type {HTMLInputElement} */ (document.getElementById('cfg-startLives')).value || 20;
    campaign.game.waveBonusGold = +/** @type {HTMLInputElement} */ (document.getElementById('cfg-waveBonusGold')).value || 10;
    campaign.game.sellRefundPercent = +/** @type {HTMLInputElement} */ (document.getElementById('cfg-sellRefundPercent')).value || 50;

    campaign.name = (nameInput.value || '').trim() || 'Untitled';
  }

  function saveAndExit() {
    readCampaignFromForm();
    if (source.builtin) {
      // First save of a freshly-cloned builtin — persist as new user campaign.
      upsertUserCampaign(campaign);
    } else {
      upsertUserCampaign(campaign);
    }
    destroy();
    onExit();
  }

  function resetToDefaults() {
    // For builtins this would re-clone the source; for user campaigns, reset name stays.
    if (!confirm('Reset this campaign to the Classic defaults?')) return;
    const fresh = cloneCampaignForEdit(getCampaignById('builtin:classic'));
    fresh.id = campaign.id;
    fresh.name = campaign.name;
    fresh.builtin = false;
    campaign = fresh;
    populateList();
  }

  function exportCampaign() {
    readCampaignFromForm();
    const data = JSON.stringify({ campaign }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (campaign.name || 'campaign').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importCampaign() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          const imported = parsed.campaign || parsed.config || parsed;
          if (!imported.towers || !imported.monsters || !imported.waves || !imported.game) throw new Error();
          campaign.towers = imported.towers;
          campaign.monsters = imported.monsters;
          campaign.waves = imported.waves;
          campaign.game = imported.game;
          if (imported.name) campaign.name = imported.name;
          populateList();
        } catch (e) {
          alert('Invalid campaign file');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // === Listeners ===
  const addTowerBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('btn-add-tower'));
  const addMonsterBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-add-monster'));
  const backBtn       = /** @type {HTMLButtonElement} */ (document.getElementById('btn-campaign-back'));
  const saveBtn       = /** @type {HTMLButtonElement} */ (document.getElementById('btn-campaign-save'));
  const resetBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('btn-campaign-reset'));
  const exportBtn     = /** @type {HTMLButtonElement} */ (document.getElementById('btn-campaign-export'));
  const importBtn     = /** @type {HTMLButtonElement} */ (document.getElementById('btn-campaign-import'));
  const detailBack    = /** @type {HTMLButtonElement} */ (document.getElementById('btn-detail-back'));
  const detailDelete  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-detail-delete'));

  const onAddTower = () => {
    readCampaignFromForm();
    campaign.towers.push({ name: 'New', letter: 'X', color: '#ffffff', bg: '#444444', range: 2, damage: 1, fireRate: 30, cost: 10, hp: 5, damageType: 'physical', sizeW: 2, sizeH: 2 });
    openDetail('tower', campaign.towers.length - 1);
  };
  const onAddMonster = () => {
    readCampaignFromForm();
    campaign.monsters.push({ name: 'New', letter: '?', color: '#ffffff', hp: 10, speed: 0.08, reward: 5 });
    campaign.waves.baseCounts.push(1);
    campaign.waves.unlockWave.push(campaign.monsters.length);
    openDetail('monster', campaign.monsters.length - 1);
  };
  const onBackBtn = () => { destroy(); onExit(); };
  const onSaveBtn = saveAndExit;
  const onResetBtn = resetToDefaults;
  const onExportBtn = exportCampaign;
  const onImportBtn = importCampaign;
  const onDetailBack = closeDetail;
  const onDetailDelete = deleteDetailItem;

  const onHelpClick = (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.classList.contains('cfg-help')) {
      showHelpOverlay(target.getAttribute('data-help') || '');
    }
  };

  addTowerBtn.addEventListener('click', onAddTower);
  addMonsterBtn.addEventListener('click', onAddMonster);
  backBtn.addEventListener('click', onBackBtn);
  saveBtn.addEventListener('click', onSaveBtn);
  resetBtn.addEventListener('click', onResetBtn);
  exportBtn.addEventListener('click', onExportBtn);
  importBtn.addEventListener('click', onImportBtn);
  detailBack.addEventListener('click', onDetailBack);
  detailDelete.addEventListener('click', onDetailDelete);
  rootEl.addEventListener('click', onHelpClick);

  function destroy() {
    addTowerBtn.removeEventListener('click', onAddTower);
    addMonsterBtn.removeEventListener('click', onAddMonster);
    backBtn.removeEventListener('click', onBackBtn);
    saveBtn.removeEventListener('click', onSaveBtn);
    resetBtn.removeEventListener('click', onResetBtn);
    exportBtn.removeEventListener('click', onExportBtn);
    importBtn.removeEventListener('click', onImportBtn);
    detailBack.removeEventListener('click', onDetailBack);
    detailDelete.removeEventListener('click', onDetailDelete);
    rootEl.removeEventListener('click', onHelpClick);
    activeController = null;
  }

  activeController = { destroy };
}

// === Form builders ===

function helpBtn(text) {
  return '<span class="cfg-help" data-help="' + esc(text) + '">?</span>';
}

function showHelpOverlay(text) {
  const ov = document.createElement('div');
  ov.className = 'help-overlay';
  const box = document.createElement('div');
  box.className = 'help-overlay-text';
  box.textContent = text;
  ov.appendChild(box);
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
}

function createTowerFields(t, isRoot, parent) {
  const div = document.createElement('div');
  div.className = 'cfg-item';
  const H = helpBtn;
  function fv(key, fallback, xform) {
    const fn = xform || ((x) => x);
    if (!parent || Object.prototype.hasOwnProperty.call(t, key)) {
      const v = t[key] !== undefined ? fn(t[key]) : fn(fallback);
      return 'value="' + esc(String(v)) + '"';
    }
    const p = parent[key] !== undefined ? fn(parent[key]) : fn(fallback);
    return 'placeholder="' + esc(String(p)) + '"';
  }
  const toSec = framesToSec;
  const toTps = (v) => +(v * FPS).toFixed(1);
  const effectiveColor = t.color || (parent ? parent.color : '#ffffff');
  const effectiveBg = t.bg || (parent ? parent.bg : '#000000');
  const effectivePierce = Object.prototype.hasOwnProperty.call(t, 'pierce') ? t.pierce : (parent ? parent.pierce : false);
  const effectiveDot = Object.prototype.hasOwnProperty.call(t, 'dot') ? t.dot : (parent ? parent.dot : null);
  const hasDot = effectiveDot && effectiveDot !== false;
  const dotDps = hasDot ? effectiveDot.dps : 1;
  const dotDur = hasDot ? framesToSec(effectiveDot.duration) : 3;
  const dtVal = Object.prototype.hasOwnProperty.call(t, 'damageType') ? t.damageType : (parent ? '' : 'physical');
  let dtOpts = '';
  if (parent) {
    const pdt = parent.damageType || 'physical';
    dtOpts = '<option value=""' + (dtVal === '' ? ' selected' : '') + '>Inherit (' + pdt.charAt(0).toUpperCase() + pdt.slice(1) + ')</option>';
  }
  for (const dt of DAMAGE_TYPES) {
    dtOpts += '<option value="' + dt + '"' + (dt === dtVal ? ' selected' : '') + '>' + dt.charAt(0).toUpperCase() + dt.slice(1) + '</option>';
  }
  const adVal = t.attackDir || 'any';
  let html =
    '<fieldset><legend>Identity</legend>' +
      '<div class="cfg-row">' +
        '<label>Name ' + H('Display name shown in UI') + ' <input type="text" class="tw-name" ' + fv('name', '') + '></label>' +
        '<label>Letter ' + H('Single character drawn on the tower') + ' <input type="text" class="tw-letter" maxlength="1" ' + fv('letter', '?') + '></label>' +
        '<label>Color ' + H('Text and letter color') + ' <input type="color" class="tw-color" value="' + effectiveColor + '"></label>' +
        '<label>BG ' + H('Background fill color') + ' <input type="color" class="tw-bg" value="' + effectiveBg + '"></label>' +
      '</div>' +
      '<div class="cfg-row">' +
        '<label style="flex:1">Desc ' + H('Description shown when the tower is selected in-game') + ' <input type="text" class="tw-desc" style="width:100%" ' + fv('desc', '') + '></label>' +
      '</div>' +
    '</fieldset>';
  if (isRoot) {
    html +=
    '<fieldset><legend>Placement</legend>' +
      '<div class="cfg-row">' +
        '<label>W ' + H('Tower width in tiles') + ' <input type="number" class="tw-sizeW" min="1" max="4" value="' + (t.sizeW || 2) + '"></label>' +
        '<label>H ' + H('Tower height in tiles') + ' <input type="number" class="tw-sizeH" min="1" max="4" value="' + (t.sizeH || 2) + '"></label>' +
        '<label>Attack dir ' + H('Any: targets nearest in range. Fixed: attacks only in facing direction, can be rotated') + ' <select class="tw-attackDir">' +
          '<option value="any"' + (adVal === 'any' ? ' selected' : '') + '>Any</option>' +
          '<option value="fixed"' + (adVal === 'fixed' ? ' selected' : '') + '>Fixed</option>' +
        '</select></label>' +
      '</div>' +
    '</fieldset>';
  }
  html +=
    '<fieldset><legend>Stats</legend>' +
      '<div class="cfg-row">' +
        '<label>Cost ' + H('Gold cost to place or upgrade to this tower') + ' <input type="number" class="tw-cost" min="0" ' + fv('cost', 0) + '></label>' +
        '<label>HP ' + H('Hit points. Monsters attack towers when their path is blocked') + ' <input type="number" class="tw-hp" min="1" ' + fv('hp', 1) + '></label>' +
        '<label>Range ' + H('Attack reach in tiles from tower edge. 0 = no attack') + ' <input type="number" class="tw-range" min="0" ' + fv('range', 0) + '></label>' +
      '</div>' +
      '<div class="cfg-row">' +
        '<label>Damage ' + H('Damage dealt per hit before modifiers') + ' <input type="number" class="tw-damage" min="0" ' + fv('damage', 0) + '></label>' +
        '<label>Cooldown ' + H('Seconds between attacks. Lower = faster') + ' <input type="number" class="tw-fireRate" min="0.03" step="0.1" ' + fv('fireRate', 1, toSec) + '>s</label>' +
        '<label>Dmg Type ' + H('Damage element. Monsters can resist or be weak to specific types') + ' <select class="tw-damageType">' + dtOpts + '</select></label>' +
      '</div>' +
      '<div class="cfg-row">' +
        '<label><input type="checkbox" class="tw-pierce"' + (effectivePierce ? ' checked' : '') + '> Pierce ' + H('Attacks all enemies in a line instead of one target') + '</label>' +
        '<label>Splash ' + H('Area damage radius around the target in tiles') + ' <input type="number" class="tw-splashRadius" min="0" step="0.5" ' + fv('splashRadius', 0) + '></label>' +
        '<label>Proj Spd ' + H('Projectile travel speed in tiles/sec. 0 = instant hit') + ' <input type="number" class="tw-projectileSpeed" min="0" step="0.5" ' + fv('projectileSpeed', 0, toTps) + '></label>' +
      '</div>' +
    '</fieldset>' +
    '<fieldset><legend>Effects</legend>' +
      '<div class="cfg-row">' +
        '<label><input type="checkbox" class="tw-hasDot"' + (hasDot ? ' checked' : '') + '> DOT ' + H('Applies damage over time to hit targets') + '</label>' +
      '</div>' +
      '<div class="cfg-row cfg-dot-fields"' + (hasDot ? '' : ' style="display:none"') + '>' +
        '<label>DPS ' + H('Damage dealt per second while DOT is active') + ' <input type="number" class="tw-dotDps" min="0" step="0.1" value="' + dotDps + '"></label>' +
        '<label>Duration ' + H('How long DOT lasts in seconds') + ' <input type="number" class="tw-dotDur" min="0.1" step="0.1" value="' + dotDur + '">s</label>' +
      '</div>' +
      '<div class="cfg-row">' +
        '<label>Slow Factor ' + H('Speed multiplier on hit. 0.5 = half speed, 1 = no slow') + ' <input type="number" class="tw-speedFactor" min="0" step="0.1" ' + fv('speedFactor', 1) + '></label>' +
        '<label>Slow Dur ' + H('How long slow lasts in seconds') + ' <input type="number" class="tw-speedDuration" min="0.1" step="0.1" ' + fv('speedDuration', 60, toSec) + '>s</label>' +
      '</div>' +
      '<div class="cfg-row">' +
        '<label>Gold Steal ' + H('Bonus gold when enemies die in range') + ' <input type="number" class="tw-goldSteal" min="0" ' + fv('goldSteal', 0) + '></label>' +
      '</div>' +
    '</fieldset>';
  div.innerHTML = html;
  const dotCb = /** @type {HTMLInputElement} */ (div.querySelector('.tw-hasDot'));
  dotCb.addEventListener('change', () => {
    const fields = /** @type {HTMLElement} */ (div.querySelector('.cfg-dot-fields'));
    fields.style.display = dotCb.checked ? '' : 'none';
  });
  return div;
}

function createMonsterFields(m) {
  const div = document.createElement('div');
  div.className = 'cfg-item';
  const H = helpBtn;
  let modInputs = '';
  const mods = m.damageModifiers || {};
  for (const dt of DAMAGE_TYPES) {
    const val = mods[dt] ?? 1;
    const label = dt.charAt(0).toUpperCase() + dt.slice(1, 4);
    modInputs += '<label>' + label + ' x<input type="number" class="mo-mod-' + dt + '" min="0" step="0.1" value="' + val + '"></label>';
  }
  div.innerHTML =
    '<fieldset><legend>Identity</legend>' +
      '<div class="cfg-row">' +
        '<label>Name ' + H('Display name') + ' <input type="text" class="mo-name" value="' + esc(m.name) + '"></label>' +
        '<label>Letter ' + H('Character drawn on the monster') + ' <input type="text" class="mo-letter" maxlength="1" value="' + esc(m.letter) + '"></label>' +
        '<label>Color ' + H('Monster color') + ' <input type="color" class="mo-color" value="' + m.color + '"></label>' +
      '</div>' +
      '<div class="cfg-row"><label>Desc ' + H('Description shown in bestiary') + ' <input type="text" class="mo-desc" style="width:200px" value="' + esc(m.desc || '') + '"></label></div>' +
    '</fieldset>' +
    '<fieldset><legend>Stats</legend>' +
      '<div class="cfg-row">' +
        '<label>HP ' + H('Base hit points. Scaled each wave by HP% setting') + ' <input type="number" class="mo-hp" min="1" value="' + m.hp + '"></label>' +
        '<label>Speed ' + H('Movement speed in tiles per second') + ' <input type="number" class="mo-speed" min="0.1" step="0.1" value="' + +(m.speed * FPS).toFixed(1) + '"></label>' +
        '<label>Reward ' + H('Gold earned on kill') + ' <input type="number" class="mo-reward" min="0" value="' + m.reward + '"></label>' +
      '</div>' +
    '</fieldset>' +
    '<fieldset><legend>Damage Modifiers ' + H('Multiplier for each damage type. 2 = double damage, 0.5 = half, 1 = normal') + '</legend>' +
      '<div class="cfg-row">' + modInputs + '</div>' +
    '</fieldset>';
  return div;
}

function readTowerFromForm(div, parent) {
  const t = {};
  const isChild = !!parent;
  const num = (sel) => {
    const v = /** @type {HTMLInputElement} */ (div.querySelector(sel)).value;
    return (isChild && v === '') ? undefined : +v;
  };
  const name = /** @type {HTMLInputElement} */ (div.querySelector('.tw-name')).value;
  if (name || !isChild) t.name = name;
  const letter = /** @type {HTMLInputElement} */ (div.querySelector('.tw-letter')).value;
  if (letter || !isChild) t.letter = letter || '?';
  const desc = /** @type {HTMLInputElement} */ (div.querySelector('.tw-desc')).value;
  if (desc || !isChild) t.desc = desc;
  t.color = /** @type {HTMLInputElement} */ (div.querySelector('.tw-color')).value;
  t.bg = /** @type {HTMLInputElement} */ (div.querySelector('.tw-bg')).value;
  let v;
  v = num('.tw-cost'); if (v !== undefined) t.cost = v;
  v = num('.tw-hp'); if (v !== undefined) t.hp = v || 1;
  v = num('.tw-range'); if (v !== undefined) t.range = v;
  v = num('.tw-damage'); if (v !== undefined) t.damage = v;
  v = num('.tw-fireRate'); if (v !== undefined) t.fireRate = secToFrames(v) || 1;
  const pierceChecked = /** @type {HTMLInputElement} */ (div.querySelector('.tw-pierce')).checked;
  if (isChild) {
    if (pierceChecked !== !!parent.pierce) t.pierce = pierceChecked;
  } else {
    if (pierceChecked) t.pierce = true;
  }
  const hasDot = /** @type {HTMLInputElement} */ (div.querySelector('.tw-hasDot')).checked;
  if (isChild) {
    const parentHasDot = !!(parent.dot && parent.dot !== false);
    if (hasDot !== parentHasDot) {
      if (hasDot) {
        t.dot = {
          dps: +(/** @type {HTMLInputElement} */ (div.querySelector('.tw-dotDps')).value) || 1,
          duration: secToFrames(+(/** @type {HTMLInputElement} */ (div.querySelector('.tw-dotDur')).value) || 3),
        };
      } else {
        t.dot = false;
      }
    }
  } else if (hasDot) {
    t.dot = {
      dps: +(/** @type {HTMLInputElement} */ (div.querySelector('.tw-dotDps')).value) || 1,
      duration: secToFrames(+(/** @type {HTMLInputElement} */ (div.querySelector('.tw-dotDur')).value) || 3),
    };
  }
  const dtVal = /** @type {HTMLInputElement} */ (div.querySelector('.tw-damageType')).value;
  if (dtVal || !isChild) t.damageType = dtVal || 'physical';
  const sf = num('.tw-speedFactor');
  if (isChild) { if (sf !== undefined) t.speedFactor = sf; }
  else { if (sf && sf !== 1) t.speedFactor = sf; }
  const sd = num('.tw-speedDuration');
  if (isChild) { if (sd !== undefined) t.speedDuration = secToFrames(sd); }
  else { if (sd && sd !== 2) t.speedDuration = secToFrames(sd); }
  v = num('.tw-splashRadius');
  if (v !== undefined) t.splashRadius = v > 0 ? v : 0;
  else if (!isChild) t.splashRadius = 0;
  v = num('.tw-projectileSpeed');
  if (v !== undefined) t.projectileSpeed = v > 0 ? +(v / FPS).toFixed(4) : 0;
  else if (!isChild) t.projectileSpeed = 0;
  v = num('.tw-goldSteal');
  if (isChild) { if (v !== undefined) t.goldSteal = v; }
  else { if (v > 0) t.goldSteal = v; }
  const sizeW = /** @type {HTMLInputElement} */ (div.querySelector('.tw-sizeW'));
  if (sizeW) t.sizeW = +sizeW.value || 2;
  const sizeH = /** @type {HTMLInputElement} */ (div.querySelector('.tw-sizeH'));
  if (sizeH) t.sizeH = +sizeH.value || 2;
  const attackDir = /** @type {HTMLInputElement} */ (div.querySelector('.tw-attackDir'));
  if (attackDir && attackDir.value === 'fixed') t.attackDir = 'fixed';
  return t;
}

function readMonsterFromForm(div) {
  const m = {
    name:   /** @type {HTMLInputElement} */ (div.querySelector('.mo-name')).value,
    letter: /** @type {HTMLInputElement} */ (div.querySelector('.mo-letter')).value || '?',
    color:  /** @type {HTMLInputElement} */ (div.querySelector('.mo-color')).value,
    hp:     +/** @type {HTMLInputElement} */ (div.querySelector('.mo-hp')).value || 1,
    speed:  (+/** @type {HTMLInputElement} */ (div.querySelector('.mo-speed')).value || 1.5) / FPS,
    reward: +/** @type {HTMLInputElement} */ (div.querySelector('.mo-reward')).value || 1,
  };
  const desc = /** @type {HTMLInputElement} */ (div.querySelector('.mo-desc')).value;
  if (desc) m.desc = desc;
  const mods = {};
  let hasNonDefault = false;
  for (const dt of DAMAGE_TYPES) {
    const el = /** @type {HTMLInputElement} */ (div.querySelector('.mo-mod-' + dt));
    if (el) {
      const val = +el.value;
      if (!isNaN(val) && val !== 1) { mods[dt] = val; hasNonDefault = true; }
    }
  }
  if (hasNonDefault) m.damageModifiers = mods;
  return m;
}
