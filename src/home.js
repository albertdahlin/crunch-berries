// @ts-check
/** @typedef {import('./types.js').Campaign}  Campaign */
/** @typedef {import('./types.js').MapDef}    MapDef */
/** @typedef {import('./types.js').SavedGame} SavedGame */
/** @typedef {import('./types.js').Renderer}  Renderer */
/** @typedef {import('./types.js').Hud}       Hud */
/** @typedef {import('./types.js').Game}      Game */

import { VERSION } from './constants.js';
import { div, span, button, h1, h2, label, input } from './html.js';
import { icon } from './icons.js';
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
import { loadAppSettings, saveAppSettings } from './app-settings.js';
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

    const items = [
      { title: 'New Vigil',       desc: 'Pick a campaign and a map',       to: '/new-game',   ic: 'sword'  },
      { title: 'Resume',          desc: 'Continue a saved game',           to: '/load-game',  ic: 'play'   },
      { title: 'Cartography',     desc: 'Create and edit maps',            to: '/maps',       ic: 'brush'  },
      { title: 'Forge',           desc: 'Design towers, monsters, waves',  to: '/campaigns',  ic: 'tower'  },
      { title: 'Sanctum',         desc: 'Audio, video, renderer',          to: '/settings',   ic: 'gear'   },
    ];

    const hero = div({ className: 'home-hero' }, [
      div({ className: 'eyebrow home-eyebrow' }, ['Chapter I  ·  The Long Dusk']),
      h1({ className: 'home-title' }, ['Tower', document.createElement('br'), 'Defence']),
      div({ className: 'divider-ornate home-divider' }, [span({}, ['✦'])]),
      div({ className: 'home-blurb' }, [
        'The wards are thin. The Black Tide rises from the salt-roads below. Hold the pass, kindle the beacons, and do not let the dark pass the wall.',
      ]),
    ]);

    const menu = div({ className: 'ms-list' }, items.map(it =>
      div({
        className: 'ms-item panel panel-ornate',
        onClick: () => router.navigate(it.to),
      }, [
        div({ className: 'ms-item-icon' }, [icon(it.ic, { size: 18 })]),
        div({ className: 'ms-item-body' }, [
          div({ className: 'ms-item-title' }, [it.title]),
          div({ className: 'ms-item-desc'  }, [it.desc]),
        ]),
        span({ className: 'ms-item-arrow' }, ['›']),
      ]),
    ));

    homeEl.appendChild(div({ className: 'home-grid' }, [hero, menu]));
    homeEl.appendChild(div({ className: 'ms-version' }, ['ASHENHOLD  ·  v' + VERSION]));
    homeEl.style.display = 'flex';
  }

  // --- New Game: campaign picker ---
  function renderPickCampaign() {
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('Choose Campaign', '/', (body) => {
      listAllCampaigns().forEach(c => {
        body.appendChild(makeCampaignRow(c, () => router.navigate('/new-game/' + c.id)));
      });
    }, 'New Vigil  ·  Step One');
  }

  // --- New Game: map picker ---
  function renderPickMap(campaignId) {
    const campaign = getCampaignById(campaignId);
    if (!campaign) { router.navigate('/new-game', { replace: true }); return; }
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('Choose Map', '/new-game', (body) => {
      listAllMaps().forEach(m => {
        body.appendChild(makeMapRow(m, () => router.navigate('/play/' + campaign.id + '/' + m.id)));
      });
    }, 'New Vigil  ·  Step Two');
  }

  // --- Load Game ---
  function renderLoadGame() {
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('Resume Vigil', '/', (body) => {
      const saves = loadSavedGames();
      if (saves.length === 0) {
        body.appendChild(div({ className: 'ms-empty' }, [
          'No vigils kept. The Ledger holds no entries until you save from the in-game menu.',
        ]));
        return;
      }
      saves.forEach(s => {
        const dateStr = new Date(s.savedAt).toLocaleString();
        body.appendChild(div({
          className: 'ms-item ms-saved panel panel-ornate',
          onClick: () => router.navigate('/resume/' + s.id),
        }, [
          div({ className: 'ms-item-icon' }, [icon('scroll', { size: 18 })]),
          div({ className: 'ms-item-body' }, [
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
            div({ className: 'ms-item-desc' }, [dateStr]),
          ]),
        ]));
      });
    }, 'Saved Games');
  }

  // --- Map Editor list ---
  function renderMapList() {
    stopGame();
    hideAll();
    listEl.style.display = 'flex';
    renderList('Cartography', '/', (body) => {
      body.appendChild(makeAddRow('New Map', 'Start with a blank grid',
        () => router.navigate('/maps/new')));

      listAllMaps().forEach(m => {
        const isBuiltin = m.id.indexOf('builtin:') === 0;
        const onOpen = () => {
          if (isBuiltin) {
            const copy = cloneMapForEdit(m);
            upsertUserMap(copy);
            router.navigate('/maps/' + copy.id);
          } else {
            router.navigate('/maps/' + m.id);
          }
        };
        body.appendChild(makeMapRow(m, onOpen));
      });
    }, 'Maps');
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
    renderList('Forge', '/', (body) => {
      body.appendChild(makeAddRow('New Campaign', 'Clone Classic and customize',
        () => router.navigate('/campaigns/new')));

      listAllCampaigns().forEach(c => {
        const onAction = (/** @type {MouseEvent} */ e) => {
          e.stopPropagation();
          if (c.builtin) {
            const copy = cloneCampaignForEdit(c);
            upsertUserCampaign(copy);
            router.navigate('/campaigns/' + copy.id);
          } else {
            deleteUserCampaign(c.id);
            renderCampaignList();
          }
        };
        const actionBtn = button({
          className: c.builtin ? 'ms-btn-edit' : 'ms-btn-del',
          title: c.builtin ? 'Clone' : 'Delete',
          onClick: onAction,
        }, [c.builtin ? '\u29C9' : '\u00d7']);
        const row = makeCampaignRow(c, () => router.navigate('/campaigns/' + c.id));
        row.querySelector('.ms-saved-top').appendChild(actionBtn);
        body.appendChild(row);
      });
    }, 'Campaigns');
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

  // --- Settings ---
  function renderSettingsScreen() {
    stopGame();
    hideAll();
    settingsEl.style.display = 'flex';
    settingsEl.innerHTML = '';

    const back = button({
      className: 'btn btn-ghost btn-icon',
      title: 'Back',
      onClick: () => router.navigate('/'),
    }, [icon('arrowLeft', { size: 14 })]);
    settingsEl.appendChild(div({ className: 'screen-header' }, [
      back,
      div({ className: 'screen-header-text' }, [
        div({ className: 'screen-eyebrow' }, ['Sanctum']),
        span({ className: 'screen-title' }, ['Settings']),
      ]),
    ]));

    const current = loadAppSettings();
    const pickRenderer = (type) => {
      if (type === current.rendererType) return;
      saveAppSettings({ rendererType: type });
      location.reload();
    };

    settingsEl.appendChild(div({ className: 'settings-group panel panel-ornate' }, [
      h2({}, ['Renderer']),
      label({}, [
        input({
          type: 'radio', name: 'rendererType', value: 'canvas',
          checked: current.rendererType === 'canvas',
          onChange: () => pickRenderer('canvas'),
        }),
        'Canvas',
      ]),
      div({ className: 'settings-hint' }, ['2D top-down view. Reliably fast on every device.']),
      label({}, [
        input({
          type: 'radio', name: 'rendererType', value: 'webgl',
          checked: current.rendererType === 'webgl',
          onChange: () => pickRenderer('webgl'),
        }),
        'WebGL  \u00b7  experimental',
      ]),
      div({ className: 'settings-hint' }, [
        'Isometric 3D via Three.js. Drag to pan, scroll to zoom. Still in development.',
      ]),
    ]));

    settingsEl.appendChild(div({ className: 'settings-group panel' }, [
      h2({}, ['Local Data']),
      div({ className: 'settings-hint', style: { marginLeft: 0, marginBottom: '12px' } },
        ['Removes user maps, campaigns, saved games, and app settings from this browser.']),
      button({
        className: 'btn btn-danger',
        onClick: () => {
          if (!confirm('Delete all saved maps, campaigns, and saved games? This cannot be undone.')) return;
          clearAllStorage();
          location.reload();
        },
      }, [icon('trash', { size: 14 }), 'Clear All Local Data']),
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
  function renderList(title, backPath, fillBody, eyebrow) {
    listEl.innerHTML = '';
    const back = button({
      className: 'btn btn-ghost btn-icon',
      onClick: () => router.navigate(backPath),
      title: 'Back',
    }, [icon('arrowLeft', { size: 14 })]);
    const headerText = div({ className: 'screen-header-text' }, [
      eyebrow ? div({ className: 'screen-eyebrow' }, [eyebrow]) : null,
      span({ className: 'screen-title' }, [title]),
    ]);
    listEl.appendChild(div({ className: 'screen-header' }, [back, headerText]));
    const body = div({ className: 'ms-list' });
    fillBody(body);
    listEl.appendChild(body);
  }

  function makeRow(title, desc, onClick, opts = {}) {
    return div({ className: 'ms-item panel panel-ornate', onClick }, [
      opts.iconName ? div({ className: 'ms-item-icon' }, [icon(opts.iconName, { size: 18 })]) : null,
      div({ className: 'ms-item-body' }, [
        div({ className: 'ms-item-title' }, [title]),
        desc ? div({ className: 'ms-item-desc' }, [desc]) : null,
      ]),
      span({ className: 'ms-item-arrow' }, ['›']),
    ]);
  }

  function makeAddRow(title, desc, onClick) {
    return div({
      className: 'ms-item panel',
      style: { borderStyle: 'dashed', borderColor: 'var(--verdant)' },
      onClick,
    }, [
      div({
        className: 'ms-item-icon',
        style: { borderColor: 'var(--verdant)', color: 'var(--verdant)' },
      }, [icon('plus', { size: 18 })]),
      div({ className: 'ms-item-body' }, [
        div({ className: 'ms-item-title', style: { color: 'var(--verdant)' } }, [title]),
        desc ? div({ className: 'ms-item-desc' }, [desc]) : null,
      ]),
    ]);
  }

  function makeCampaignRow(c, onClick) {
    return div({ className: 'ms-item panel panel-ornate', onClick }, [
      div({ className: 'ms-item-icon' }, [icon('crown', { size: 18 })]),
      div({ className: 'ms-item-body' }, [
        div({ className: 'ms-saved-top' }, [
          span({ className: 'ms-item-title' }, [c.name]),
          c.builtin ? span({ className: 'ms-pip-builtin' }, ['Built-in']) : null,
        ]),
        div({ className: 'ms-item-desc' },
          [c.towers.length + ' towers  ·  ' + c.monsters.length + ' monsters']),
      ]),
      span({ className: 'ms-item-arrow' }, ['›']),
    ]);
  }

  function makeMapRow(m, onClick) {
    const isBuiltin = m.id.indexOf('builtin:') === 0;
    return div({ className: 'ms-item panel panel-ornate', onClick }, [
      div({ className: 'ms-item-icon' }, [icon('grid', { size: 18 })]),
      div({ className: 'ms-item-body' }, [
        div({ className: 'ms-saved-top' }, [
          span({ className: 'ms-item-title' }, [m.name]),
          isBuiltin ? span({ className: 'ms-pip-builtin' }, ['Built-in']) : null,
        ]),
        div({ className: 'ms-item-desc' }, [m.cols + ' x ' + m.rows]),
      ]),
      span({ className: 'ms-item-arrow' }, ['›']),
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
