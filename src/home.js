// @ts-check
/** @typedef {import('./types.js').Campaign}  Campaign */
/** @typedef {import('./types.js').MapDef}    MapDef */
/** @typedef {import('./types.js').SavedGame} SavedGame */
/** @typedef {import('./types.js').Renderer}  Renderer */
/** @typedef {import('./types.js').Hud}       Hud */
/** @typedef {import('./types.js').Game}      Game */

import { VERSION, esc } from './constants.js';
import { createGame } from './game.js';
import {
  BUILTIN_CAMPAIGNS,
  listAllCampaigns,
  getCampaignById,
  upsertUserCampaign,
  cloneCampaignForEdit,
  deleteUserCampaign,
} from './campaigns.js';
import {
  listAllMaps,
  getMapById,
  createBlankUserMap,
  deleteUserMap,
  EMPTY_MAP_ID,
} from './maps.js';
import { loadSavedGames, saveSavedGames, newUserId } from './storage.js';
import { openMapEditor } from './edit-map.js';
import { openCampaignEditor } from './edit-campaign.js';

/**
 * @param {{canvas: HTMLCanvasElement, renderer: Renderer, hud: Hud}} opts
 */
export function createScreenManager({ canvas, renderer, hud }) {
  const homeEl     = /** @type {HTMLElement} */ (document.getElementById('home'));
  const listEl     = /** @type {HTMLElement} */ (document.getElementById('screen-list'));
  const settingsEl = /** @type {HTMLElement} */ (document.getElementById('screen-settings'));
  const editorUi   = /** @type {HTMLElement} */ (document.getElementById('editor-ui'));
  const editCamp   = /** @type {HTMLElement} */ (document.getElementById('edit-campaign'));

  /** @type {?Game} */ let currentGame = null;
  /** @type {?Campaign} */ let newGameCampaign = null;

  function hideAll() {
    homeEl.style.display = 'none';
    listEl.style.display = 'none';
    settingsEl.style.display = 'none';
    editorUi.style.display = 'none';
    editCamp.style.display = 'none';
    canvas.style.display = 'none';
    hud.hide();
  }

  function showHome() {
    stopGame();
    hideAll();
    renderHome();
    homeEl.style.display = 'flex';
  }

  function renderHome() {
    homeEl.innerHTML = '';
    const h1 = document.createElement('h1');
    h1.textContent = 'TOWER DEFENCE';
    homeEl.appendChild(h1);

    const list = document.createElement('div');
    list.className = 'ms-list';
    const items = [
      { title: 'New Game',        desc: 'Pick a campaign and a map',        go: showNewGamePickCampaign },
      { title: 'Load Game',       desc: 'Resume a saved game',              go: showLoadGame },
      { title: 'Map Editor',      desc: 'Create and edit maps',             go: showMapList },
      { title: 'Campaign Editor', desc: 'Design towers, monsters, waves',   go: showCampaignList },
      { title: 'Settings',        desc: 'Audio, video, controls',           go: showSettingsScreen },
    ];
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'ms-item';
      row.innerHTML =
        '<div class="ms-item-title">' + it.title + '</div>' +
        '<div class="ms-item-desc">' + it.desc + '</div>';
      row.addEventListener('click', it.go);
      list.appendChild(row);
    });
    homeEl.appendChild(list);

    const v = document.createElement('div');
    v.className = 'ms-version';
    v.textContent = 'v' + VERSION;
    homeEl.appendChild(v);
  }

  // --- New Game: campaign picker ---
  function showNewGamePickCampaign() {
    hideAll();
    listEl.style.display = 'flex';
    renderList('New Game — Pick Campaign', showHome, (body) => {
      listAllCampaigns().forEach(c => {
        const row = makeRow(c.name + (c.builtin ? ' [built-in]' : ''),
          c.towers.length + ' towers · ' + c.monsters.length + ' monsters',
          () => { newGameCampaign = c; showNewGamePickMap(); });
        body.appendChild(row);
      });
    });
  }

  // --- New Game: map picker (after campaign is chosen) ---
  function showNewGamePickMap() {
    hideAll();
    listEl.style.display = 'flex';
    renderList('New Game — Pick Map', showNewGamePickCampaign, (body) => {
      listAllMaps().forEach(m => {
        const dims = m.cols + 'x' + m.rows;
        const tag = m.id.indexOf('builtin:') === 0 ? ' — built-in' : '';
        const row = makeRow(m.name, dims + tag,
          () => {
            if (newGameCampaign) startGame(m, newGameCampaign);
          });
        body.appendChild(row);
      });
    });
  }

  // --- Load Game ---
  function showLoadGame() {
    hideAll();
    listEl.style.display = 'flex';
    renderList('Load Game', showHome, (body) => {
      const saves = loadSavedGames();
      if (saves.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ms-empty';
        empty.textContent = 'No saved games yet. Save from the in-game menu.';
        body.appendChild(empty);
        return;
      }
      saves.forEach(s => {
        const row = document.createElement('div');
        row.className = 'ms-item ms-saved';
        const dateStr = new Date(s.savedAt).toLocaleString();
        row.innerHTML =
          '<div class="ms-saved-top">' +
            '<span class="ms-item-title">' + esc(s.name) + '</span>' +
            '<button class="ms-btn-del" title="Delete">\u00d7</button>' +
          '</div>' +
          '<div class="ms-item-desc">' + dateStr + ' — Tap to resume</div>';
        row.addEventListener('click', (e) => {
          if (/** @type {HTMLElement} */ (e.target).closest('.ms-btn-del')) return;
          resumeSave(s);
        });
        const del = /** @type {HTMLElement} */ (row.querySelector('.ms-btn-del'));
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          const remaining = loadSavedGames().filter(x => x.id !== s.id);
          saveSavedGames(remaining);
          showLoadGame();
        });
        body.appendChild(row);
      });
    });
  }

  // --- Map Editor list ---
  function showMapList() {
    hideAll();
    listEl.style.display = 'flex';
    renderList('Map Editor', showHome, (body) => {
      const addRow = makeRow('+ New Map', 'Start with a blank grid',
        () => openMapEditorAndShow(null));
      addRow.style.borderColor = '#4caf50';
      body.appendChild(addRow);

      const maps = listAllMaps();
      maps.forEach(m => {
        if (m.id === EMPTY_MAP_ID) return; // can't edit the built-in empty
        const row = document.createElement('div');
        row.className = 'ms-item ms-saved';
        const dims = m.cols + 'x' + m.rows;
        row.innerHTML =
          '<div class="ms-saved-top">' +
            '<span class="ms-item-title">' + esc(m.name) + '</span>' +
            '<button class="ms-btn-edit" title="Edit">\u270E</button>' +
          '</div>' +
          '<div class="ms-item-desc">' + dims + ' — Tap to edit</div>';
        row.addEventListener('click', () => openMapEditorAndShow(m.id));
        body.appendChild(row);
      });
    });
  }

  function openMapEditorAndShow(mapId) {
    hideAll();
    editorUi.style.display = 'flex';
    canvas.style.display = 'block';
    openMapEditor({
      mapId,
      canvas,
      renderer,
      onExit: showMapList,
      onPlay: (mapDef) => {
        const campaign = getCampaignById(BUILTIN_CAMPAIGNS[0].id);
        if (!campaign) { showMapList(); return; }
        startGame(mapDef, campaign);
      },
    });
  }

  // --- Campaign editor list ---
  function showCampaignList() {
    hideAll();
    listEl.style.display = 'flex';
    renderList('Campaign Editor', showHome, (body) => {
      const addRow = makeRow('+ New Campaign', 'Clone Classic and customize',
        () => {
          const newC = cloneCampaignForEdit(BUILTIN_CAMPAIGNS[0]);
          newC.name = 'New Campaign';
          upsertUserCampaign(newC);
          openCampaignEditorAndShow(newC.id);
        });
      addRow.style.borderColor = '#4caf50';
      body.appendChild(addRow);

      listAllCampaigns().forEach(c => {
        const row = document.createElement('div');
        row.className = 'ms-item ms-saved';
        const badge = c.builtin ? ' [built-in]' : '';
        row.innerHTML =
          '<div class="ms-saved-top">' +
            '<span class="ms-item-title">' + esc(c.name) + badge + '</span>' +
            (c.builtin
              ? '<button class="ms-btn-edit" title="Clone">\u29C9</button>'
              : '<button class="ms-btn-del" title="Delete">\u00d7</button>') +
          '</div>' +
          '<div class="ms-item-desc">' + c.towers.length + ' towers · ' + c.monsters.length + ' monsters</div>';
        row.addEventListener('click', (e) => {
          const target = /** @type {HTMLElement} */ (e.target);
          if (target.closest('.ms-btn-del')) return;
          if (target.closest('.ms-btn-edit')) return;
          openCampaignEditorAndShow(c.id);
        });
        const del = row.querySelector('.ms-btn-del');
        if (del) del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteUserCampaign(c.id);
          showCampaignList();
        });
        const clone = row.querySelector('.ms-btn-edit');
        if (clone && c.builtin) clone.addEventListener('click', (e) => {
          e.stopPropagation();
          const copy = cloneCampaignForEdit(c);
          upsertUserCampaign(copy);
          openCampaignEditorAndShow(copy.id);
        });
        body.appendChild(row);
      });
    });
  }

  function openCampaignEditorAndShow(campaignId) {
    hideAll();
    editCamp.style.display = 'flex';
    openCampaignEditor({ campaignId, onExit: showCampaignList });
  }

  // --- Settings (empty placeholder) ---
  function showSettingsScreen() {
    hideAll();
    settingsEl.style.display = 'flex';
    settingsEl.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'screen-header';
    const back = document.createElement('button');
    back.textContent = '\u2190 Back';
    back.addEventListener('click', showHome);
    header.appendChild(back);
    const title = document.createElement('span');
    title.className = 'screen-title';
    title.textContent = 'Settings';
    header.appendChild(title);
    settingsEl.appendChild(header);

    const body = document.createElement('div');
    body.className = 'screen-body';
    body.style.textAlign = 'center';
    body.style.padding = '40px 16px';
    body.style.color = '#666';
    body.innerHTML = '<div style="font-size:18px;margin-bottom:8px">(coming soon)</div>' +
      '<div style="font-size:13px">Audio, video, and control settings will live here.</div>';
    settingsEl.appendChild(body);
  }

  // --- Play (Game) ---
  function startGame(mapDef, campaign) {
    stopGame();
    hideAll();
    canvas.style.display = 'block';
    const game = createGame({
      mapDef,
      campaign,
      renderer,
      hud,
      onQuit: showHome,
      onSave: () => saveCurrentGame(game, mapDef, campaign),
    });
    currentGame = game;
    bindCanvasInput(canvas, game);
    bindKeyInput(game);
    game.start();
  }

  function resumeSave(s) {
    const campaign = getCampaignById(s.campaignId) || BUILTIN_CAMPAIGNS[0];
    stopGame();
    hideAll();
    canvas.style.display = 'block';
    const game = createGame({
      mapDef: s.map,
      campaign,
      renderer,
      hud,
      onQuit: showHome,
      onSave: () => saveCurrentGame(game, s.map, campaign),
    });
    currentGame = game;
    bindCanvasInput(canvas, game);
    bindKeyInput(game);
    game.restore(s.snapshot);
    game.start();
  }

  function saveCurrentGame(game, mapDef, campaign) {
    const snapshot = game.serialize();
    /** @type {SavedGame} */
    const s = {
      id: newUserId('save'),
      name: mapDef.name + ' — W' + game.state.wave,
      campaignId: campaign.id,
      map: mapDef,
      snapshot,
      savedAt: new Date().toISOString(),
    };
    const saves = loadSavedGames();
    saves.unshift(s);
    saveSavedGames(saves.slice(0, 20));
    hud.flash('Game saved');
  }

  function stopGame() {
    if (currentGame) {
      currentGame.stop();
      unbindCanvasInput(canvas);
      currentGame = null;
    }
    unbindKeyInput();
  }

  // --- List screen helpers ---
  function renderList(title, onBack, fillBody) {
    listEl.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'screen-header';
    const back = document.createElement('button');
    back.textContent = '\u2190 Back';
    back.addEventListener('click', onBack);
    header.appendChild(back);
    const titleEl = document.createElement('span');
    titleEl.className = 'screen-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);
    listEl.appendChild(header);
    const body = document.createElement('div');
    body.className = 'ms-list';
    fillBody(body);
    listEl.appendChild(body);
  }

  function makeRow(title, desc, onClick) {
    const row = document.createElement('div');
    row.className = 'ms-item';
    row.innerHTML =
      '<div class="ms-item-title">' + esc(title) + '</div>' +
      (desc ? '<div class="ms-item-desc">' + esc(desc) + '</div>' : '');
    row.addEventListener('click', onClick);
    return row;
  }

  return {
    showHome,
    showNewGame: showNewGamePickCampaign,
    showLoadGame,
    showMapList,
    showCampaignList,
    showSettings: showSettingsScreen,
    showPlay: startGame,
    resumePlay: resumeSave,
    showMapEditor: openMapEditorAndShow,
    showCampaignEditor: openCampaignEditorAndShow,
  };
}

// === Canvas + key input wiring (active only during play) ===

let boundCanvas = null;
let boundMove = null, boundLeave = null, boundDown = null, boundUp = null, boundTouchStart = null, boundTouchMove = null, boundTouchEnd = null;
let boundKey = null;
let pointerDownPos = null;

function bindCanvasInput(canvas, /** @type {Game} */ game) {
  boundCanvas = canvas;

  boundMove = (e) => game.input.onPointerMove(e.clientX, e.clientY);
  boundLeave = () => game.input.onPointerLeave();
  boundDown = (e) => { pointerDownPos = { x: e.clientX, y: e.clientY }; game.input.onPointerDown(e.clientX, e.clientY); };
  boundUp = (e) => {
    const start = pointerDownPos;
    pointerDownPos = null;
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const dragged = Math.abs(dx) > 10 || Math.abs(dy) > 10;
    game.input.onPointerTap(e.clientX, e.clientY, dragged);
  };
  boundTouchStart = (e) => {
    const t = e.touches[0];
    pointerDownPos = { x: t.clientX, y: t.clientY };
    game.input.onPointerDown(t.clientX, t.clientY);
  };
  boundTouchMove = (e) => {
    const t = e.touches[0];
    game.input.onPointerMove(t.clientX, t.clientY);
  };
  boundTouchEnd = (e) => {
    const start = pointerDownPos;
    pointerDownPos = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    const dragged = Math.abs(dx) > 10 || Math.abs(dy) > 10;
    game.input.onPointerTap(t.clientX, t.clientY, dragged);
  };

  canvas.addEventListener('mousemove', boundMove);
  canvas.addEventListener('mouseleave', boundLeave);
  canvas.addEventListener('mousedown', boundDown);
  canvas.addEventListener('mouseup', boundUp);
  canvas.addEventListener('touchstart', boundTouchStart, { passive: true });
  canvas.addEventListener('touchmove',  boundTouchMove,  { passive: true });
  canvas.addEventListener('touchend',   boundTouchEnd);
}

function unbindCanvasInput(canvas) {
  if (!boundCanvas || !boundMove) return;
  boundCanvas.removeEventListener('mousemove', boundMove);
  boundCanvas.removeEventListener('mouseleave', boundLeave);
  boundCanvas.removeEventListener('mousedown', boundDown);
  boundCanvas.removeEventListener('mouseup', boundUp);
  boundCanvas.removeEventListener('touchstart', boundTouchStart);
  boundCanvas.removeEventListener('touchmove',  boundTouchMove);
  boundCanvas.removeEventListener('touchend',   boundTouchEnd);
  boundCanvas = null;
}

function bindKeyInput(/** @type {Game} */ game) {
  boundKey = (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (game.input.onKey(e.key)) e.preventDefault();
  };
  document.addEventListener('keydown', boundKey);
}

function unbindKeyInput() {
  if (boundKey) document.removeEventListener('keydown', boundKey);
  boundKey = null;
}
