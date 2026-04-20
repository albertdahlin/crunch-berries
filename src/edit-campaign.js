// @ts-check
/** @typedef {import('./types.js').Campaign} Campaign */
/** @typedef {import('./types.js').TowerDef} TowerDef */

import {
  DAMAGE_TYPES, FPS, framesToSec, secToFrames,
} from './constants.js';
import {
  getCampaignById, upsertUserCampaign, deleteUserCampaign, cloneCampaignForEdit,
  getConfigNode, getMergedNode, ensureCampaignIds,
} from './campaigns.js';
import {
  div, span, button, label, input, select, option, fieldset, legend, textarea,
} from './html.js';

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

  const rootEl      = /** @type {HTMLElement} */ (document.getElementById('edit-campaign'));
  const listView    = /** @type {HTMLElement} */ (document.getElementById('settings-list'));
  const detailView  = /** @type {HTMLElement} */ (document.getElementById('settings-detail'));
  const detailTitle = /** @type {HTMLElement} */ (document.getElementById('settings-detail-title'));
  const detailBody  = /** @type {HTMLElement} */ (document.getElementById('settings-detail-body'));
  const nameInput   = /** @type {HTMLInputElement} */ (document.getElementById('edit-campaign-name'));

  const towersDiv   = /** @type {HTMLElement} */ (document.getElementById('settings-towers'));
  const monstersDiv = /** @type {HTMLElement} */ (document.getElementById('settings-monsters'));
  const wavesDiv    = /** @type {HTMLElement} */ (document.getElementById('settings-waves'));

  /** @type {{type: ?('tower'|'monster'|'wave'), index: number}} */
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
    populateWaveList();
    setInputValue('cfg-scaleEvery',    campaign.waves.scaleEvery);
    setInputValue('cfg-hpScale',       campaign.waves.hpScale ?? 20);
    setInputValue('cfg-intervalStart', framesToSec(campaign.waves.intervalStart));
    setInputValue('cfg-intervalDecay', framesToSec(campaign.waves.intervalDecay));
    setInputValue('cfg-intervalMin',   framesToSec(campaign.waves.intervalMin));
    setInputValue('cfg-startGold',         campaign.game.startGold);
    setInputValue('cfg-startLives',        campaign.game.startLives);
    setInputValue('cfg-waveBonusGold',     campaign.game.waveBonusGold);
    setInputValue('cfg-sellRefundPercent', campaign.game.sellRefundPercent);
  }

  function populateWaveList() {
    wavesDiv.innerHTML = '';
    const list = campaign.waves.list || [];
    list.forEach((w, i) => {
      const summary = summarizeWave(w);
      wavesDiv.appendChild(listItem('#888', String(i + 1), 'Wave ' + (i + 1) + ': ' + summary, () => openDetail('wave', i)));
    });
  }

  function summarizeWave(entry) {
    const parts = [];
    if (entry.monsters) {
      for (const [id, count] of Object.entries(entry.monsters)) {
        if (count > 0) {
          const m = campaign.monsters.find(m => m.id === id);
          parts.push(count + ' ' + (m ? m.name : id));
        }
      }
    }
    return parts.length > 0 ? parts.join(', ') : '(empty)';
  }

  function listItem(color, letter, name, onClick) {
    return div({ className: 'cfg-list-item', onClick }, [
      div({ className: 'cfg-swatch', style: { background: color } }, [letter]),
      span({ className: 'cfg-list-name' }, [name]),
      span({ className: 'cfg-list-arrow', textContent: '\u25B6' }),
    ]);
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
    } else if (type === 'monster') {
      detailTitle.textContent = 'Monster: ' + campaign.monsters[index].name;
      detailBody.appendChild(createMonsterFields(campaign.monsters[index]));
    } else if (type === 'wave') {
      const entry = campaign.waves.list[index];
      detailTitle.textContent = 'Wave ' + (index + 1);
      detailBody.appendChild(createWaveFields(entry, index, campaign));
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
      const crumbs = [
        span({
          className: 'tree-crumb',
          onClick: () => { saveTowerFormToNode(); treePath = []; renderTowerTreeNode(towerIdx, []); },
        }, [root.name]),
      ];
      let crumbNode = root;
      for (let d = 0; d < path.length; d++) {
        crumbs.push(document.createTextNode(' \u203a '));
        crumbNode = crumbNode.upgrades[path[d]];
        if (d < path.length - 1) {
          const targetPath = path.slice(0, d + 1);
          crumbs.push(span({
            className: 'tree-crumb',
            onClick: () => { saveTowerFormToNode(); treePath = targetPath; renderTowerTreeNode(towerIdx, targetPath); },
          }, [crumbNode.name]));
        } else {
          crumbs.push(span({ className: 'tree-crumb current' }, [crumbNode.name]));
        }
      }
      detailBody.insertBefore(div({ className: 'tree-nav' }, crumbs), detailBody.firstChild);
    }

    const upgrades = node.upgrades || [];
    const upgradeRows = upgrades.map((_upg, i) => {
      const em = getMergedNode(root, path.concat(i));
      return div({
        className: 'cfg-list-item',
        onClick: () => {
          saveTowerFormToNode();
          treePath = path.concat(i);
          renderTowerTreeNode(towerIdx, treePath);
        },
      }, [
        div({ className: 'cfg-swatch', style: { background: em.bg || em.color } }, [em.letter]),
        span({ className: 'cfg-list-name' }, [
          em.name + ' ',
          span({ style: { color: '#888', fontSize: '11px' } }, ['(' + em.cost + 'g)']),
        ]),
        button({
          className: 'tree-child-rm',
          onClick: (/** @type {MouseEvent} */ e) => {
            e.stopPropagation();
            saveTowerFormToNode();
            node.upgrades.splice(i, 1);
            if (node.upgrades.length === 0) delete node.upgrades;
            renderTowerTreeNode(towerIdx, path);
          },
        }, ['\u00d7']),
      ]);
    });

    const addBtn = button({
      className: 'tree-child-add',
      onClick: () => {
        saveTowerFormToNode();
        if (!node.upgrades) node.upgrades = [];
        const merged = getMergedNode(root, path);
        node.upgrades.push({ name: 'New', letter: merged.letter, color: merged.color, bg: merged.bg, cost: 10 });
        treePath = path.concat(node.upgrades.length - 1);
        renderTowerTreeNode(towerIdx, treePath);
      },
    }, ['+ Add']);

    detailBody.appendChild(fieldset({}, [
      legend({}, ['Upgrades']),
      div({ className: 'tree-upgrade-list' }, [...upgradeRows, addBtn]),
    ]));
  }

  function saveTowerFormToNode() {
    if (detailState.type !== 'tower') return;
    const formDiv = detailBody.querySelector('.cfg-item');
    if (!formDiv) return;
    const root = campaign.towers[detailState.index];
    const node = getConfigNode(root, treePath);
    const isChild = treePath.length > 0;
    const parent = isChild ? getMergedNode(root, treePath.slice(0, -1)) : null;
    const formData = readTowerFromForm(/** @type {HTMLElement} */ (formDiv), parent);
    const upgrades = node.upgrades;
    for (const key in node) delete node[key];
    Object.assign(node, formData);
    if (upgrades) node.upgrades = upgrades;
  }

  function saveWaveFormToEntry(index) {
    const formDiv = detailBody.querySelector('.cfg-item');
    if (!formDiv) return;
    campaign.waves.list[index] = readWaveFromForm(/** @type {HTMLElement} */ (formDiv));
  }

  function closeDetail() {
    const { type, index } = detailState;
    if (type === 'tower') saveTowerFormToNode();
    else if (type === 'monster') {
      const formDiv = detailBody.querySelector('.cfg-item');
      if (formDiv) campaign.monsters[index] = readMonsterFromForm(/** @type {HTMLElement} */ (formDiv));
    } else if (type === 'wave') {
      saveWaveFormToEntry(index);
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
    } else if (type === 'wave') {
      if (campaign.waves.list.length <= 1) return;
      campaign.waves.list.splice(index, 1);
    }
    showList();
  }

  function readCampaignFromForm() {
    campaign.waves.scaleEvery    = getInputNumber('cfg-scaleEvery', 2);
    campaign.waves.hpScale       = getInputNumber('cfg-hpScale', 0);
    campaign.waves.intervalStart = secToFrames(getInputNumber('cfg-intervalStart', 1.33));
    campaign.waves.intervalDecay = secToFrames(getInputNumber('cfg-intervalDecay', 0.1));
    campaign.waves.intervalMin   = secToFrames(getInputNumber('cfg-intervalMin', 0.33));

    campaign.game.startGold         = getInputNumber('cfg-startGold', 50);
    campaign.game.startLives        = getInputNumber('cfg-startLives', 20);
    campaign.game.waveBonusGold     = getInputNumber('cfg-waveBonusGold', 10);
    campaign.game.sellRefundPercent = getInputNumber('cfg-sellRefundPercent', 50);

    campaign.name = (nameInput.value || '').trim() || 'Untitled';
  }

  function commitPendingDetail() {
    if (detailState.type === 'tower') {
      saveTowerFormToNode();
    } else if (detailState.type === 'monster') {
      const formDiv = detailBody.querySelector('.cfg-item');
      if (formDiv) campaign.monsters[detailState.index] = readMonsterFromForm(/** @type {HTMLElement} */ (formDiv));
    } else if (detailState.type === 'wave') {
      saveWaveFormToEntry(detailState.index);
    }
  }

  function saveAndExit() {
    commitPendingDetail();
    readCampaignFromForm();
    upsertUserCampaign(campaign);
    destroy();
    onExit();
  }

  function resetToDefaults() {
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
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.json';
    picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
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
          if (imported.nextId) campaign.nextId = imported.nextId;
          ensureCampaignIds(campaign);
          populateList();
        } catch (e) {
          alert('Invalid campaign file');
        }
      };
      reader.readAsText(file);
    });
    picker.click();
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
    if (!campaign.nextId) campaign.nextId = 0;
    campaign.towers.push({ id: 't' + campaign.nextId++, name: 'New', letter: 'X', color: '#ffffff', bg: '#444444', range: 2, damage: 1, fireRate: 30, cost: 10, hp: 5, damageType: 'physical', sizeW: 2, sizeH: 2 });
    openDetail('tower', campaign.towers.length - 1);
  };
  const onAddMonster = () => {
    readCampaignFromForm();
    if (!campaign.nextId) campaign.nextId = 0;
    campaign.monsters.push({ id: 'm' + campaign.nextId++, name: 'New', letter: '?', color: '#ffffff', hp: 10, speed: 0.08, reward: 5 });
    openDetail('monster', campaign.monsters.length - 1);
  };
  const onAddWave = () => {
    readCampaignFromForm();
    const towers = {};
    campaign.towers.forEach(t => { towers[t.id] = true; });
    const monsters = {};
    campaign.monsters.forEach(m => { monsters[m.id] = 0; });
    if (!campaign.waves.list) campaign.waves.list = [];
    campaign.waves.list.push({ monsters, towers });
    openDetail('wave', campaign.waves.list.length - 1);
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

  const addWaveBtn    = /** @type {HTMLButtonElement} */ (document.getElementById('btn-add-wave'));

  addTowerBtn.addEventListener('click', onAddTower);
  addMonsterBtn.addEventListener('click', onAddMonster);
  addWaveBtn.addEventListener('click', onAddWave);
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
    addWaveBtn.removeEventListener('click', onAddWave);
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
  return span({ className: 'cfg-help', 'data-help': text }, ['?']);
}

function showHelpOverlay(text) {
  const ov = div({
    className: 'help-overlay',
    onClick: () => ov.remove(),
  }, [
    div({ className: 'help-overlay-text', textContent: text }),
  ]);
  document.body.appendChild(ov);
}

function createTowerFields(t, isRoot, parent) {
  // Returns either {value: X} (explicit) or {placeholder: X} (inherited from parent).
  // For a root node every field is explicit, so value is always set.
  function fvAttrs(key, fallback, xform) {
    const fn = xform || ((x) => x);
    if (!parent || Object.prototype.hasOwnProperty.call(t, key)) {
      const v = t[key] !== undefined ? fn(t[key]) : fn(fallback);
      return { value: String(v) };
    }
    const p = parent[key] !== undefined ? fn(parent[key]) : fn(fallback);
    return { placeholder: String(p) };
  }
  const toSec = framesToSec;
  const toTps = (v) => +(v * FPS).toFixed(1);

  const effectiveColor  = t.color || (parent ? parent.color : '#ffffff');
  const effectiveBg     = t.bg    || (parent ? parent.bg    : '#000000');
  const effectivePierce = Object.prototype.hasOwnProperty.call(t, 'pierce') ? t.pierce : (parent ? parent.pierce : false);
  const effectiveDot    = Object.prototype.hasOwnProperty.call(t, 'dot')    ? t.dot    : (parent ? parent.dot    : null);
  const hasDot = effectiveDot && effectiveDot !== false;
  const dotDps = hasDot ? effectiveDot.dps : 1;
  const dotDur = hasDot ? framesToSec(effectiveDot.duration) : 3;

  const dtVal = Object.prototype.hasOwnProperty.call(t, 'damageType') ? t.damageType : (parent ? '' : 'physical');
  const damageTypeOptions = [];
  if (parent) {
    const pdt = parent.damageType || 'physical';
    damageTypeOptions.push(option({ value: '', selected: dtVal === '' },
      ['Inherit (' + pdt.charAt(0).toUpperCase() + pdt.slice(1) + ')']));
  }
  for (const dt of DAMAGE_TYPES) {
    damageTypeOptions.push(option({ value: dt, selected: dt === dtVal },
      [dt.charAt(0).toUpperCase() + dt.slice(1)]));
  }
  const adVal = t.attackDir || 'any';

  const identity = fieldset({}, [
    legend({}, ['Identity']),
    div({ className: 'cfg-row' }, [
      label({}, ['Name ', helpBtn('Display name shown in UI'), ' ',
        input({ type: 'text', className: 'tw-name', ...fvAttrs('name', '') })]),
      label({}, ['Letter ', helpBtn('Single character drawn on the tower'), ' ',
        input({ type: 'text', className: 'tw-letter', maxlength: 1, ...fvAttrs('letter', '?') })]),
      label({}, ['Color ', helpBtn('Text and letter color'), ' ',
        input({ type: 'color', className: 'tw-color', value: effectiveColor })]),
      label({}, ['BG ', helpBtn('Background fill color'), ' ',
        input({ type: 'color', className: 'tw-bg', value: effectiveBg })]),
    ]),
    div({ className: 'cfg-row' }, [
      label({ style: { flex: '1' } }, [
        'Desc ', helpBtn('Description shown when the tower is selected in-game'), ' ',
        input({ type: 'text', className: 'tw-desc', style: { width: '100%' }, ...fvAttrs('desc', '') }),
      ]),
    ]),
  ]);

  const placement = isRoot ? fieldset({}, [
    legend({}, ['Placement']),
    div({ className: 'cfg-row' }, [
      label({}, ['W ', helpBtn('Tower width in tiles'), ' ',
        input({ type: 'number', className: 'tw-sizeW', min: 1, max: 4, value: t.sizeW || 2 })]),
      label({}, ['H ', helpBtn('Tower height in tiles'), ' ',
        input({ type: 'number', className: 'tw-sizeH', min: 1, max: 4, value: t.sizeH || 2 })]),
      label({}, ['Attack dir ', helpBtn('Any: targets nearest in range. Fixed: attacks only in facing direction, can be rotated'), ' ',
        select({ className: 'tw-attackDir' }, [
          option({ value: 'any',   selected: adVal === 'any'   }, ['Any']),
          option({ value: 'fixed', selected: adVal === 'fixed' }, ['Fixed']),
        ]),
      ]),
    ]),
  ]) : null;

  const dotRow = div({
    className: 'cfg-row cfg-dot-fields',
    style: { display: hasDot ? '' : 'none' },
  }, [
    label({}, ['DPS ', helpBtn('Damage dealt per second while DOT is active'), ' ',
      input({ type: 'number', className: 'tw-dotDps', min: 0, step: 0.1, value: dotDps })]),
    label({}, ['Duration ', helpBtn('How long DOT lasts in seconds'), ' ',
      input({ type: 'number', className: 'tw-dotDur', min: 0.1, step: 0.1, value: dotDur }), 's']),
  ]);
  const dotCb = input({
    type: 'checkbox', className: 'tw-hasDot', checked: hasDot,
    onChange: () => { dotRow.style.display = dotCb.checked ? '' : 'none'; },
  });

  const stats = fieldset({}, [
    legend({}, ['Stats']),
    div({ className: 'cfg-row' }, [
      label({}, ['Cost ', helpBtn('Gold cost to place or upgrade to this tower'), ' ',
        input({ type: 'number', className: 'tw-cost', min: 0, ...fvAttrs('cost', 0) })]),
      label({}, ['HP ', helpBtn('Hit points. Monsters attack towers when their path is blocked'), ' ',
        input({ type: 'number', className: 'tw-hp', min: 1, ...fvAttrs('hp', 1) })]),
      label({}, ['Range ', helpBtn('Attack reach in tiles from tower edge. 0 = no attack'), ' ',
        input({ type: 'number', className: 'tw-range', min: 0, ...fvAttrs('range', 0) })]),
    ]),
    div({ className: 'cfg-row' }, [
      label({}, ['Damage ', helpBtn('Damage dealt per hit before modifiers'), ' ',
        input({ type: 'number', className: 'tw-damage', min: 0, ...fvAttrs('damage', 0) })]),
      label({}, ['Cooldown ', helpBtn('Seconds between attacks. Lower = faster'), ' ',
        input({ type: 'number', className: 'tw-fireRate', min: 0.03, step: 0.1, ...fvAttrs('fireRate', 1, toSec) }), 's']),
      label({}, ['Dmg Type ', helpBtn('Damage element. Monsters can resist or be weak to specific types'), ' ',
        select({ className: 'tw-damageType' }, damageTypeOptions)]),
    ]),
    div({ className: 'cfg-row' }, [
      label({}, [
        input({ type: 'checkbox', className: 'tw-pierce', checked: effectivePierce }),
        ' Pierce ', helpBtn('Attacks all enemies in a line instead of one target'),
      ]),
      label({}, ['Splash ', helpBtn('Area damage radius around the target in tiles'), ' ',
        input({ type: 'number', className: 'tw-splashRadius', min: 0, step: 0.5, ...fvAttrs('splashRadius', 0) })]),
      label({}, ['Proj Spd ', helpBtn('Projectile travel speed in tiles/sec. 0 = instant hit'), ' ',
        input({ type: 'number', className: 'tw-projectileSpeed', min: 0, step: 0.5, ...fvAttrs('projectileSpeed', 0, toTps) })]),
    ]),
  ]);

  const effects = fieldset({}, [
    legend({}, ['Effects']),
    div({ className: 'cfg-row' }, [
      label({}, [dotCb, ' DOT ', helpBtn('Applies damage over time to hit targets')]),
    ]),
    dotRow,
    div({ className: 'cfg-row' }, [
      label({}, ['Slow Factor ', helpBtn('Speed multiplier on hit. 0.5 = half speed, 1 = no slow'), ' ',
        input({ type: 'number', className: 'tw-speedFactor', min: 0, step: 0.1, ...fvAttrs('speedFactor', 1) })]),
      label({}, ['Slow Dur ', helpBtn('How long slow lasts in seconds'), ' ',
        input({ type: 'number', className: 'tw-speedDuration', min: 0.1, step: 0.1, ...fvAttrs('speedDuration', 60, toSec) }), 's']),
    ]),
    div({ className: 'cfg-row' }, [
      label({}, ['Gold Steal ', helpBtn('Bonus gold when enemies die in range'), ' ',
        input({ type: 'number', className: 'tw-goldSteal', min: 0, ...fvAttrs('goldSteal', 0) })]),
    ]),
  ]);

  return div({ className: 'cfg-item' }, [identity, placement, stats, effects]);
}

function createMonsterFields(m) {
  const mods = m.damageModifiers || {};
  const modInputs = DAMAGE_TYPES.map(dt => label({}, [
    dt.charAt(0).toUpperCase() + dt.slice(1, 4) + ' x',
    input({ type: 'number', className: 'mo-mod-' + dt, min: 0, step: 0.1, value: mods[dt] ?? 1 }),
  ]));

  return div({ className: 'cfg-item' }, [
    fieldset({}, [
      legend({}, ['Identity']),
      div({ className: 'cfg-row' }, [
        label({}, ['Name ', helpBtn('Display name'), ' ',
          input({ type: 'text', className: 'mo-name', value: m.name })]),
        label({}, ['Letter ', helpBtn('Character drawn on the monster'), ' ',
          input({ type: 'text', className: 'mo-letter', maxlength: 1, value: m.letter })]),
        label({}, ['Color ', helpBtn('Monster color'), ' ',
          input({ type: 'color', className: 'mo-color', value: m.color })]),
      ]),
      div({ className: 'cfg-row' }, [
        label({}, ['Desc ', helpBtn('Description shown in bestiary'), ' ',
          input({ type: 'text', className: 'mo-desc', style: { width: '200px' }, value: m.desc || '' })]),
      ]),
    ]),
    fieldset({}, [
      legend({}, ['Stats']),
      div({ className: 'cfg-row' }, [
        label({}, ['HP ', helpBtn('Base hit points. Scaled each wave by HP% setting'), ' ',
          input({ type: 'number', className: 'mo-hp', min: 1, value: m.hp })]),
        label({}, ['Speed ', helpBtn('Movement speed in tiles per second'), ' ',
          input({ type: 'number', className: 'mo-speed', min: 0.1, step: 0.1, value: +(m.speed * FPS).toFixed(1) })]),
        label({}, ['Reward ', helpBtn('Gold earned on kill'), ' ',
          input({ type: 'number', className: 'mo-reward', min: 0, value: m.reward })]),
      ]),
    ]),
    fieldset({}, [
      legend({}, [
        'Damage Modifiers ',
        helpBtn('Multiplier for each damage type. 2 = double damage, 0.5 = half, 1 = normal'),
      ]),
      div({ className: 'cfg-row' }, modInputs),
    ]),
  ]);
}

function createWaveFields(entry, waveIdx, campaign) {
  const monsterInputs = campaign.monsters.map(m => {
    const count = (entry.monsters && entry.monsters[m.id]) || 0;
    return div({ className: 'cfg-row' }, [
      span({ style: { color: m.color, minWidth: '70px' } }, [m.name]),
      input({ type: 'number', className: 'wv-count', 'data-id': m.id, min: 0, value: count }),
    ]);
  });

  const towerChecks = campaign.towers.map(t => {
    const available = entry.towers && entry.towers[t.id];
    return label({}, [
      input({ type: 'checkbox', className: 'wv-tower', 'data-id': t.id, checked: !!available }),
      span({ style: { color: t.color } }, [' ' + t.name]),
    ]);
  });

  return div({ className: 'cfg-item' }, [
    fieldset({}, [
      legend({}, ['Monsters']),
      ...monsterInputs,
    ]),
    fieldset({}, [
      legend({}, ['Available Towers']),
      div({ className: 'cfg-row', style: { flexWrap: 'wrap' } }, towerChecks),
    ]),
    fieldset({}, [
      legend({}, ['Lore']),
      textarea({
        className: 'wv-lore',
        rows: 3,
        style: { width: '100%', padding: '6px', background: '#1a1a2a', color: '#ccc', border: '1px solid #444', borderRadius: '3px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' },
      }, [entry.lore || '']),
    ]),
    fieldset({}, [
      legend({}, ['Bonus Gold']),
      div({ className: 'cfg-row' }, [
        label({}, [
          'Bonus ', helpBtn('Extra gold awarded when this wave is completed'), ' ',
          input({ type: 'number', className: 'wv-bonus', min: 0, value: entry.bonus || 0 }),
        ]),
      ]),
    ]),
  ]);
}

function readWaveFromForm(formDiv) {
  const monsters = {};
  formDiv.querySelectorAll('.wv-count').forEach(el => {
    const inp = /** @type {HTMLInputElement} */ (el);
    const count = +inp.value || 0;
    if (count > 0) monsters[inp.getAttribute('data-id')] = count;
  });
  const towers = {};
  formDiv.querySelectorAll('.wv-tower').forEach(el => {
    const inp = /** @type {HTMLInputElement} */ (el);
    if (inp.checked) towers[inp.getAttribute('data-id')] = true;
  });
  const lore = /** @type {HTMLTextAreaElement} */ (formDiv.querySelector('.wv-lore')).value.trim();
  const bonus = +(/** @type {HTMLInputElement} */ (formDiv.querySelector('.wv-bonus'))).value || 0;
  const entry = { monsters, towers };
  if (lore) entry.lore = lore;
  if (bonus) entry.bonus = bonus;
  return entry;
}

function readTowerFromForm(formDiv, parent) {
  const t = {};
  const isChild = !!parent;
  const num = (sel) => {
    const v = /** @type {HTMLInputElement} */ (formDiv.querySelector(sel)).value;
    return (isChild && v === '') ? undefined : +v;
  };
  const name = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-name')).value;
  if (name || !isChild) t.name = name;
  const letter = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-letter')).value;
  if (letter || !isChild) t.letter = letter || '?';
  const desc = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-desc')).value;
  if (desc || !isChild) t.desc = desc;
  t.color = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-color')).value;
  t.bg    = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-bg')).value;
  let v;
  v = num('.tw-cost');     if (v !== undefined) t.cost = v;
  v = num('.tw-hp');       if (v !== undefined) t.hp = v || 1;
  v = num('.tw-range');    if (v !== undefined) t.range = v;
  v = num('.tw-damage');   if (v !== undefined) t.damage = v;
  v = num('.tw-fireRate'); if (v !== undefined) t.fireRate = secToFrames(v) || 1;
  const pierceChecked = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-pierce')).checked;
  if (isChild) {
    if (pierceChecked !== !!parent.pierce) t.pierce = pierceChecked;
  } else if (pierceChecked) t.pierce = true;
  const hasDot = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-hasDot')).checked;
  if (isChild) {
    const parentHasDot = !!(parent.dot && parent.dot !== false);
    if (hasDot !== parentHasDot) {
      if (hasDot) {
        t.dot = {
          dps: +(/** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-dotDps')).value) || 1,
          duration: secToFrames(+(/** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-dotDur')).value) || 3),
        };
      } else t.dot = false;
    }
  } else if (hasDot) {
    t.dot = {
      dps: +(/** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-dotDps')).value) || 1,
      duration: secToFrames(+(/** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-dotDur')).value) || 3),
    };
  }
  const dtVal = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-damageType')).value;
  if (dtVal || !isChild) t.damageType = dtVal || 'physical';
  const sf = num('.tw-speedFactor');
  if (isChild) { if (sf !== undefined) t.speedFactor = sf; }
  else if (sf && sf !== 1) t.speedFactor = sf;
  const sd = num('.tw-speedDuration');
  if (isChild) { if (sd !== undefined) t.speedDuration = secToFrames(sd); }
  else if (sd && sd !== 2) t.speedDuration = secToFrames(sd);
  v = num('.tw-splashRadius');
  if (v !== undefined) t.splashRadius = v > 0 ? v : 0;
  else if (!isChild) t.splashRadius = 0;
  v = num('.tw-projectileSpeed');
  if (v !== undefined) t.projectileSpeed = v > 0 ? +(v / FPS).toFixed(4) : 0;
  else if (!isChild) t.projectileSpeed = 0;
  v = num('.tw-goldSteal');
  if (isChild) { if (v !== undefined) t.goldSteal = v; }
  else if (v > 0) t.goldSteal = v;
  const sizeW = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-sizeW'));
  if (sizeW) t.sizeW = +sizeW.value || 2;
  const sizeH = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-sizeH'));
  if (sizeH) t.sizeH = +sizeH.value || 2;
  const attackDir = /** @type {HTMLInputElement} */ (formDiv.querySelector('.tw-attackDir'));
  if (attackDir && attackDir.value === 'fixed') t.attackDir = 'fixed';
  return t;
}

function readMonsterFromForm(formDiv) {
  const m = {
    name:   /** @type {HTMLInputElement} */ (formDiv.querySelector('.mo-name')).value,
    letter: /** @type {HTMLInputElement} */ (formDiv.querySelector('.mo-letter')).value || '?',
    color:  /** @type {HTMLInputElement} */ (formDiv.querySelector('.mo-color')).value,
    hp:     +/** @type {HTMLInputElement} */ (formDiv.querySelector('.mo-hp')).value || 1,
    speed:  (+/** @type {HTMLInputElement} */ (formDiv.querySelector('.mo-speed')).value || 1.5) / FPS,
    reward: +/** @type {HTMLInputElement} */ (formDiv.querySelector('.mo-reward')).value || 1,
  };
  const desc = /** @type {HTMLInputElement} */ (formDiv.querySelector('.mo-desc')).value;
  if (desc) m.desc = desc;
  const mods = {};
  let hasNonDefault = false;
  for (const dt of DAMAGE_TYPES) {
    const el = /** @type {HTMLInputElement} */ (formDiv.querySelector('.mo-mod-' + dt));
    if (el) {
      const val = +el.value;
      if (!isNaN(val) && val !== 1) { mods[dt] = val; hasNonDefault = true; }
    }
  }
  if (hasNonDefault) m.damageModifiers = mods;
  return m;
}

// Tiny form-DOM helpers.
function setInputValue(id, v) {
  const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
  if (el) el.value = String(v);
}
function getInputNumber(id, fallback) {
  const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
  return +(el && el.value) || fallback;
}
