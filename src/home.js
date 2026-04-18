// @ts-check
/** @typedef {import('./types.js').Campaign}  Campaign */
/** @typedef {import('./types.js').MapDef}    MapDef */
/** @typedef {import('./types.js').SavedGame} SavedGame */
/** @typedef {import('./types.js').Renderer}  Renderer */
/** @typedef {import('./types.js').Hud}       Hud */
/** @typedef {import('./types.js').Game}      Game */

import { VERSION } from './constants.js';
import { div, span, button, h1, h2 } from './html.js';
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
  cloneMapForEdit,
  upsertUserMap,
} from './maps.js';
import { loadSavedGames, saveSavedGames, newUserId, clearAllStorage } from './storage.js';
import { openMapEditor } from './edit-map.js';
import { openCampaignEditor } from './edit-campaign.js';
import { createRouter } from './router.js';

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
  /** @type {?string} */ let currentGameKey = null;
  /** @type {?{mapDef: MapDef, campaign: Campaign}} */ let pendingMapEditorPlay = null;

  /** @type {ReturnType<typeof createRouter>} */
  const router = createRouter([
    { pattern: '/',                         handler: renderHome },
    { pattern: '/new-game',                 handler: renderPickCampaign },
    { pattern: '/new-game/:campaignId',     handler: (p) => renderPickMap(p.campaignId) },
    { pattern: '/load-game',                handler: renderLoadGame },
    { pattern: '/maps',                     handler: renderMapList },
    { pattern: '/maps/new',                 handler: renderMapEditorNew },
    { pattern: '/maps/:mapId',              handler: (p) => renderMapEditor(p.mapId) },
    { pattern: '/campaigns',                handler: renderCampaignList },
    { pattern: '/campaigns/new',            handler: renderCampaignEditorNew },
    { pattern: '/campaigns/:campaignId',    handler: (p) => renderCampaignEditor(p.campaignId) },
    { pattern: '/settings',                 handler: renderSettingsScreen },
    { pattern: '/play/:campaignId/:mapId',  handler: (p) => renderPlay(p.campaignId, p.mapId) },
    { pattern: '/resume/:saveId',           handler: (p) => renderResume(p.saveId) },
  ]);

  function hideAll() {
    homeEl.style.display = 'none';
    listEl.style.display = 'none';
    settingsEl.style.display = 'none';
    editorUi.style.display = 'none';
    editCamp.style.display = 'none';
    canvas.style.display = 'none';
    hud.hide();
  }

  // --- Home ---
  function renderHome() {
    stopGame();
    hideAll();
    homeEl.innerHTML = '';
    homeEl.appendChild(h1({}, ['TOWER DEFENCE']));

    const items = [
      { title: 'New Game',        desc: 'Pick a campaign and a map',       to: '/new-game'  },
      { title: 'Load Game',       desc: 'Resume a saved game',             to: '/load-game' },
      { title: 'Map Editor',      desc: 'Create and edit maps',            to: '/maps'      },
      { title: 'Campaign Editor', desc: 'Design towers, monsters, waves',  to: '/campaigns' },
      { title: 'Settings',        desc: 'Audio, video, controls',          to: '/settings'  },
    ];
    homeEl.appendChild(div({ className: 'ms-list' }, items.map(it =>
      div({ className: 'ms-item', onClick: () => router.navigate(it.to) }, [
        div({ className: 'ms-item-title' }, [it.title]),
        div({ className: 'ms-item-desc'  }, [it.desc]),
      ]),
    )));
    homeEl.appendChild(div({ className: 'ms-version' }, ['v' + VERSION]));
    homeEl.style.display = 'flex';
  }

  // --- New Game: campaign picker ---
  function renderPickCampaign() {
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('New Game — Pick Campaign', '/', (body) => {
      listAllCampaigns().forEach(c => {
        const row = makeRow(c.name + (c.builtin ? ' [built-in]' : ''),
          c.towers.length + ' towers · ' + c.monsters.length + ' monsters',
          () => router.navigate('/new-game/' + c.id));
        body.appendChild(row);
      });
    });
  }

  // --- New Game: map picker ---
  function renderPickMap(campaignId) {
    const campaign = getCampaignById(campaignId);
    if (!campaign) { router.navigate('/new-game', { replace: true }); return; }
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('New Game — Pick Map', '/new-game', (body) => {
      listAllMaps().forEach(m => {
        const dims = m.cols + 'x' + m.rows;
        const tag = m.id.indexOf('builtin:') === 0 ? ' — built-in' : '';
        const row = makeRow(m.name, dims + tag,
          () => router.navigate('/play/' + campaign.id + '/' + m.id));
        body.appendChild(row);
      });
    });
  }

  // --- Load Game ---
  function renderLoadGame() {
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('Load Game', '/', (body) => {
      const saves = loadSavedGames();
      if (saves.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ms-empty';
        empty.textContent = 'No saved games yet. Save from the in-game menu.';
        body.appendChild(empty);
        return;
      }
      saves.forEach(s => {
        const dateStr = new Date(s.savedAt).toLocaleString();
        body.appendChild(div({
          className: 'ms-item ms-saved',
          onClick: () => router.navigate('/resume/' + s.id),
        }, [
          div({ className: 'ms-saved-top' }, [
            span({ className: 'ms-item-title' }, [s.name]),
            button({
              className: 'ms-btn-del',
              title: 'Delete',
              onClick: (/** @type {MouseEvent} */ e) => {
                e.stopPropagation();
                saveSavedGames(loadSavedGames().filter(x => x.id !== s.id));
                renderLoadGame();
              },
            }, ['\u00d7']),
          ]),
          div({ className: 'ms-item-desc' }, [dateStr + ' — Tap to resume']),
        ]));
      });
    });
  }

  // --- Map Editor list ---
  function renderMapList() {
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('Map Editor', '/', (body) => {
      const addRow = makeRow('+ New Map', 'Start with a blank grid',
        () => router.navigate('/maps/new'));
      addRow.style.borderColor = '#4caf50';
      body.appendChild(addRow);

      listAllMaps().forEach(m => {
        const isBuiltin = m.id.indexOf('builtin:') === 0;
        const dims = m.cols + 'x' + m.rows;
        const onOpen = () => {
          if (isBuiltin) {
            const copy = cloneMapForEdit(m);
            upsertUserMap(copy);
            router.navigate('/maps/' + copy.id);
          } else {
            router.navigate('/maps/' + m.id);
          }
        };
        body.appendChild(div({ className: 'ms-item ms-saved', onClick: onOpen }, [
          div({ className: 'ms-saved-top' }, [
            span({ className: 'ms-item-title' }, [m.name + (isBuiltin ? ' [built-in]' : '')]),
            button({
              className: 'ms-btn-edit',
              title: isBuiltin ? 'Clone' : 'Edit',
            }, [isBuiltin ? '\u29C9' : '\u270E']),
          ]),
          div({ className: 'ms-item-desc' }, [
            dims + (isBuiltin ? ' — Tap to clone' : ' — Tap to edit'),
          ]),
        ]));
      });
    });
  }

  function renderMapEditorNew() {
    stopGame();
    hideAll();
    editorUi.style.display = 'flex';
    canvas.style.display = 'block';
    openMapEditor({
      mapId: null,
      canvas,
      renderer,
      onExit: () => router.navigate('/maps'),
      onPlay: launchMapEditorPlay,
    });
  }

  function renderMapEditor(mapId) {
    // Built-in maps are read-only; editing one clones it into a user map.
    if (mapId.indexOf('builtin:') === 0) {
      const src = getMapById(mapId);
      if (!src) { router.navigate('/maps', { replace: true }); return; }
      const copy = cloneMapForEdit(src);
      upsertUserMap(copy);
      router.navigate('/maps/' + copy.id, { replace: true });
      return;
    }
    stopGame();
    hideAll();
    editorUi.style.display = 'flex';
    canvas.style.display = 'block';
    openMapEditor({
      mapId,
      canvas,
      renderer,
      onExit: () => router.navigate('/maps'),
      onPlay: launchMapEditorPlay,
    });
  }

  function launchMapEditorPlay(mapDef) {
    const campaign = getCampaignById(BUILTIN_CAMPAIGNS[0].id) || BUILTIN_CAMPAIGNS[0];
    // Stash so the /play route can look up the fresh unsaved mapDef by id.
    pendingMapEditorPlay = { mapDef, campaign };
    router.navigate('/play/' + campaign.id + '/' + mapDef.id);
  }

  // --- Campaign editor list ---
  function renderCampaignList() {
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('Campaign Editor', '/', (body) => {
      const addRow = makeRow('+ New Campaign', 'Clone Classic and customize',
        () => router.navigate('/campaigns/new'));
      addRow.style.borderColor = '#4caf50';
      body.appendChild(addRow);

      listAllCampaigns().forEach(c => {
        const actionBtn = c.builtin
          ? button({
              className: 'ms-btn-edit',
              title: 'Clone',
              onClick: (/** @type {MouseEvent} */ e) => {
                e.stopPropagation();
                const copy = cloneCampaignForEdit(c);
                upsertUserCampaign(copy);
                router.navigate('/campaigns/' + copy.id);
              },
            }, ['\u29C9'])
          : button({
              className: 'ms-btn-del',
              title: 'Delete',
              onClick: (/** @type {MouseEvent} */ e) => {
                e.stopPropagation();
                deleteUserCampaign(c.id);
                renderCampaignList();
              },
            }, ['\u00d7']);
        body.appendChild(div({
          className: 'ms-item ms-saved',
          onClick: () => router.navigate('/campaigns/' + c.id),
        }, [
          div({ className: 'ms-saved-top' }, [
            span({ className: 'ms-item-title' },
              [c.name + (c.builtin ? ' [built-in]' : '')]),
            actionBtn,
          ]),
          div({ className: 'ms-item-desc' },
            [c.towers.length + ' towers · ' + c.monsters.length + ' monsters']),
        ]));
      });
    });
  }

  function renderCampaignEditorNew() {
    const newC = cloneCampaignForEdit(BUILTIN_CAMPAIGNS[0]);
    newC.name = 'New Campaign';
    upsertUserCampaign(newC);
    router.navigate('/campaigns/' + newC.id, { replace: true });
  }

  function renderCampaignEditor(campaignId) {
    if (!getCampaignById(campaignId)) { router.navigate('/campaigns', { replace: true }); return; }
    stopGame();
    hideAll();
    editCamp.style.display = 'flex';
    openCampaignEditor({ campaignId, onExit: () => router.navigate('/campaigns') });
  }

  // --- Settings (empty placeholder) ---
  function renderSettingsScreen() {
    stopGame();
    hideAll();
    settingsEl.style.display = 'flex';
    settingsEl.innerHTML = '';

    settingsEl.appendChild(div({ className: 'screen-header' }, [
      button({ onClick: () => router.navigate('/') }, ['\u2190 Back']),
      span({ className: 'screen-title' }, ['Settings']),
    ]));

    settingsEl.appendChild(div({
      className: 'screen-body',
      style: { textAlign: 'center', padding: '40px 16px', color: '#666' },
    }, [
      div({ style: { fontSize: '18px', marginBottom: '8px' } }, ['(coming soon)']),
      div({ style: { fontSize: '13px' } },
        ['Audio, video, and control settings will live here.']),
    ]));

    settingsEl.appendChild(div({
      className: 'screen-body',
      style: {
        marginTop: '32px',
        padding: '16px',
        borderTop: '1px solid #333',
        textAlign: 'center',
        maxWidth: '400px',
        width: '100%',
      },
    }, [
      button({
        style: {
          background: '#4a1a1a', border: '1px solid #f44336', color: '#f44336',
          padding: '10px 16px', fontFamily: 'monospace', fontSize: '14px',
          borderRadius: '4px', cursor: 'pointer',
        },
        onClick: () => {
          if (!confirm('Delete all saved maps, campaigns, and saved games? This cannot be undone.')) return;
          clearAllStorage();
          location.reload();
        },
      }, ['Clear all local data']),
      div({ style: { fontSize: '12px', color: '#555', marginTop: '8px' } },
        ['Removes user maps, campaigns, and saved games from this browser.']),
    ]));
  }

  // --- Play ---
  function renderPlay(campaignId, mapId) {
    const key = campaignId + '|' + mapId;
    // Same game already running — route re-dispatched, do nothing.
    if (currentGame && currentGameKey === key) return;

    const campaign = getCampaignById(campaignId);
    if (!campaign) { router.navigate('/', { replace: true }); return; }

    // Map may be a freshly-edited unsaved map from the map editor.
    let mapDef = null;
    if (pendingMapEditorPlay && pendingMapEditorPlay.mapDef.id === mapId) {
      mapDef = pendingMapEditorPlay.mapDef;
      pendingMapEditorPlay = null;
    } else {
      mapDef = getMapById(mapId);
    }
    if (!mapDef) { router.navigate('/', { replace: true }); return; }

    startGame(mapDef, campaign, key);
  }

  function renderResume(saveId) {
    const saves = loadSavedGames();
    const save = saves.find(s => s.id === saveId);
    if (!save) { router.navigate('/load-game', { replace: true }); return; }
    const campaign = getCampaignById(save.campaignId) || BUILTIN_CAMPAIGNS[0];

    stopGame();
    hideAll();
    canvas.style.display = 'block';
    const game = createGame({
      mapDef: save.map,
      campaign,
      renderer,
      hud,
      onQuit: () => router.navigate('/'),
      onSave: () => saveCurrentGame(game, save.map, campaign),
    });
    currentGame = game;
    currentGameKey = 'resume|' + save.id;
    bindCanvasInput(canvas, game);
    bindKeyInput(game);
    game.restore(save.snapshot);
    game.start();
  }

  function startGame(mapDef, campaign, key) {
    stopGame();
    hideAll();
    canvas.style.display = 'block';
    const game = createGame({
      mapDef,
      campaign,
      renderer,
      hud,
      onQuit: () => router.navigate('/'),
      onSave: () => saveCurrentGame(game, mapDef, campaign),
    });
    currentGame = game;
    currentGameKey = key;
    bindCanvasInput(canvas, game);
    bindKeyInput(game);
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
      currentGameKey = null;
    }
    unbindKeyInput();
  }

  // --- List screen helpers ---
  function renderList(title, backPath, fillBody) {
    listEl.innerHTML = '';
    listEl.appendChild(div({ className: 'screen-header' }, [
      button({ onClick: () => router.navigate(backPath) }, ['\u2190 Back']),
      span({ className: 'screen-title' }, [title]),
    ]));
    const body = div({ className: 'ms-list' });
    fillBody(body);
    listEl.appendChild(body);
  }

  function makeRow(title, desc, onClick) {
    return div({ className: 'ms-item', onClick }, [
      div({ className: 'ms-item-title' }, [title]),
      desc ? div({ className: 'ms-item-desc' }, [desc]) : null,
    ]);
  }

  return {
    start: () => router.start(),
    navigate: router.navigate,
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
