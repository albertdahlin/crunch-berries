// @ts-check
/** @typedef {import('./types.js').MapDef}        MapDef */
/** @typedef {import('./types.js').MapRuntime}    MapRuntime */
/** @typedef {import('./types.js').Renderer}      Renderer */
/** @typedef {import('./types.js').EditorOverlay} EditorOverlay */
/** @typedef {import('./types.js').Cursor}        Cursor */

import {
  GROUND_GRASS, GROUND_ROAD,
  GROUND_NAMES, GROUND_BG, GROUND_HELP,
} from './constants.js';
import { buildMapRuntime } from './game.js';
import { isTopRowReachable, recomputePath } from './pathfind.js';
import {
  getMapById, upsertUserMap, deleteUserMap, createBlankUserMap,
} from './maps.js';

let activeController = null;

/**
 * @param {{mapId: ?string, canvas: HTMLCanvasElement, renderer: Renderer, onExit: () => void, onPlay: (m: MapDef) => void}} opts
 */
export function openMapEditor(opts) {
  if (activeController) activeController.destroy();

  const { canvas, renderer, onExit, onPlay } = opts;
  const resolved = resolveMap(opts.mapId);
  const mapDef = resolved.map;
  let persisted = resolved.persisted;
  let runtime = buildMapRuntime(mapDef);
  let dirty = false;

  /** @type {EditorOverlay} */
  const overlay = { brush: GROUND_GRASS, brushSize: 1 };
  /** @type {Cursor} */
  const cursor = { x: Math.floor(runtime.cols / 2), y: Math.floor(runtime.rows / 2), visible: false };
  let painting = false;

  const nameEl  = /** @type {HTMLInputElement} */ (document.getElementById('editor-map-name'));
  const colsEl  = /** @type {HTMLInputElement} */ (document.getElementById('editor-map-cols'));
  const rowsEl  = /** @type {HTMLInputElement} */ (document.getElementById('editor-map-rows'));
  const brushEl = /** @type {HTMLElement} */ (document.getElementById('brush-buttons'));
  const helpEl  = /** @type {HTMLElement} */ (document.getElementById('brush-help'));
  const sizeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-editor-size'));
  const playBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-editor-play'));
  const saveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-editor-save'));
  const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-editor-clear'));
  const deleteBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-editor-delete'));
  const backBtn  = /** @type {HTMLButtonElement} */ (document.getElementById('btn-editor-back'));
  const exportBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-editor-export'));
  const importBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-editor-import'));

  nameEl.value = mapDef.name;
  colsEl.value = String(runtime.cols);
  rowsEl.value = String(runtime.rows);
  sizeBtn.textContent = overlay.brushSize + 'x' + overlay.brushSize;
  deleteBtn.style.display = persisted ? '' : 'none';

  renderer.setGridSize(runtime.cols, runtime.rows);

  // Brush buttons
  brushEl.innerHTML = '';
  for (let i = 0; i < GROUND_NAMES.length; i++) {
    const btn = document.createElement('button');
    btn.textContent = (i + 1) + ' ' + GROUND_NAMES[i];
    btn.dataset.brush = String(i);
    btn.style.borderColor = GROUND_BG[i];
    if (i === overlay.brush) btn.classList.add('selected');
    btn.addEventListener('click', () => selectBrush(i));
    brushEl.appendChild(btn);
  }
  helpEl.textContent = GROUND_HELP[overlay.brush];

  function selectBrush(i) {
    overlay.brush = i;
    brushEl.querySelectorAll('button').forEach(b => {
      b.classList.toggle('selected', parseInt(b.dataset.brush || '-1') === i);
    });
    helpEl.textContent = GROUND_HELP[i];
  }

  function paintAt(tx, ty) {
    const sz = overlay.brushSize;
    const { cols, rows, ground } = runtime;
    for (let dy = 0; dy < sz; dy++) {
      for (let dx = 0; dx < sz; dx++) {
        const px = tx + dx, py = ty + dy;
        if (px < 0 || px >= cols || py < 0 || py >= rows) continue;
        if (py === 0 || py === rows - 1) continue;
        ground[py * cols + px] = overlay.brush;
      }
    }
    dirty = true;
  }

  function resize(newCols, newRows) {
    const oldCols = runtime.cols, oldRows = runtime.rows;
    const oldGround = runtime.ground;
    const ground = new Uint8Array(newCols * newRows);
    ground.fill(GROUND_GRASS);
    const copyW = Math.min(oldCols, newCols);
    const copyH = Math.min(oldRows, newRows);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        ground[y * newCols + x] = oldGround[y * oldCols + x];
      }
    }
    for (let x = 0; x < newCols; x++) {
      ground[x] = GROUND_ROAD;
      ground[(newRows - 1) * newCols + x] = GROUND_ROAD;
    }
    runtime = {
      cols: newCols, rows: newRows, ground,
      grid: new Uint8Array(newCols * newRows),
      pathDist: null, pathFlow: null,
    };
    cursor.x = Math.min(cursor.x, newCols - 1);
    cursor.y = Math.min(cursor.y, newRows - 1);
    renderer.setGridSize(newCols, newRows);
    dirty = true;
  }

  function clearMap() {
    runtime.ground.fill(GROUND_GRASS);
    for (let x = 0; x < runtime.cols; x++) {
      runtime.ground[x] = GROUND_ROAD;
      runtime.ground[(runtime.rows - 1) * runtime.cols + x] = GROUND_ROAD;
    }
    dirty = true;
  }

  function currentMapDef() {
    /** @type {MapDef} */
    const m = {
      id: mapDef.id,
      name: (nameEl.value || '').trim() || 'My Map',
      cols: runtime.cols,
      rows: runtime.rows,
      data: Array.from(runtime.ground),
    };
    return m;
  }

  function saveCurrent() {
    const m = currentMapDef();
    if (!m.id || m.id.indexOf('builtin:') === 0) m.id = createBlankUserMap().id;
    const saved = upsertUserMap(m);
    mapDef.id = saved.id;
    mapDef.name = saved.name;
    dirty = false;
    persisted = true;
    deleteBtn.style.display = '';
    return saved;
  }

  function play() {
    recomputePath(runtime);
    if (!isTopRowReachable(runtime)) {
      alert('No valid path! Monsters need a walkable route top to bottom.');
      return;
    }
    const saved = saveCurrent();
    destroy();
    onPlay(saved);
  }

  function exportCurrent() {
    const m = currentMapDef();
    const json = JSON.stringify({ name: m.name, data: m.data, cols: m.cols, rows: m.rows }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = m.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importCurrent() {
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
          if (!parsed.data || !parsed.cols || !parsed.rows) throw new Error('invalid');
          resize(parsed.cols, parsed.rows);
          for (let i = 0; i < parsed.data.length && i < runtime.ground.length; i++) {
            runtime.ground[i] = parsed.data[i];
          }
          nameEl.value = parsed.name || 'Imported';
          dirty = true;
        } catch (e) {
          alert('Invalid map file');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // --- Input ---
  const onMouseMove = (e) => {
    const t = renderer.clientToTile(e.clientX, e.clientY);
    cursor.x = Math.max(0, Math.min(runtime.cols - 1, t.x));
    cursor.y = Math.max(0, Math.min(runtime.rows - 1, t.y));
    cursor.visible = true;
    if (painting) paintAt(cursor.x, cursor.y);
  };
  const onMouseLeave = () => { cursor.visible = false; painting = false; };
  const onMouseDown = (e) => {
    painting = true;
    const t = renderer.clientToTile(e.clientX, e.clientY);
    cursor.x = Math.max(0, Math.min(runtime.cols - 1, t.x));
    cursor.y = Math.max(0, Math.min(runtime.rows - 1, t.y));
    paintAt(cursor.x, cursor.y);
  };
  const onMouseUp = () => { painting = false; };
  const onTouchStart = (e) => {
    const t0 = e.touches[0];
    const t = renderer.clientToTile(t0.clientX, t0.clientY);
    cursor.x = Math.max(0, Math.min(runtime.cols - 1, t.x));
    cursor.y = Math.max(0, Math.min(runtime.rows - 1, t.y));
    cursor.visible = true;
    painting = true;
    paintAt(cursor.x, cursor.y);
  };
  const onTouchMove = (e) => {
    if (!painting) return;
    const t0 = e.touches[0];
    const t = renderer.clientToTile(t0.clientX, t0.clientY);
    cursor.x = Math.max(0, Math.min(runtime.cols - 1, t.x));
    cursor.y = Math.max(0, Math.min(runtime.rows - 1, t.y));
    paintAt(cursor.x, cursor.y);
  };
  const onTouchEnd = () => { painting = false; };
  const onKey = (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const n = parseInt(e.key);
    if (n >= 1 && n <= GROUND_NAMES.length) { selectBrush(n - 1); e.preventDefault(); }
  };

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove',  onTouchMove,  { passive: true });
  canvas.addEventListener('touchend',   onTouchEnd);
  document.addEventListener('keydown', onKey);

  const onSizeBtn = () => {
    overlay.brushSize = overlay.brushSize >= 3 ? 1 : overlay.brushSize + 1;
    sizeBtn.textContent = overlay.brushSize + 'x' + overlay.brushSize;
  };
  const onPlayBtn = play;
  const onSaveBtn = () => { saveCurrent(); };
  const onClearBtn = () => { if (confirm('Clear the map?')) clearMap(); };
  const onDeleteBtn = () => {
    if (!persisted || !mapDef.id) return;
    if (!confirm('Delete this map?')) return;
    deleteUserMap(mapDef.id);
    destroy();
    onExit();
  };
  const onBackBtn = () => { destroy(); onExit(); };
  const onExportBtn = exportCurrent;
  const onImportBtn = importCurrent;
  const onColsChange = (e) => {
    const v = Math.max(5, Math.min(60, +(/** @type {HTMLInputElement} */(e.target)).value || 15));
    (/** @type {HTMLInputElement} */ (e.target)).value = String(v);
    resize(v, runtime.rows);
  };
  const onRowsChange = (e) => {
    const v = Math.max(5, Math.min(60, +(/** @type {HTMLInputElement} */(e.target)).value || 15));
    (/** @type {HTMLInputElement} */ (e.target)).value = String(v);
    resize(runtime.cols, v);
  };

  sizeBtn.addEventListener('click', onSizeBtn);
  playBtn.addEventListener('click', onPlayBtn);
  saveBtn.addEventListener('click', onSaveBtn);
  clearBtn.addEventListener('click', onClearBtn);
  deleteBtn.addEventListener('click', onDeleteBtn);
  backBtn.addEventListener('click', onBackBtn);
  if (exportBtn) exportBtn.addEventListener('click', onExportBtn);
  if (importBtn) importBtn.addEventListener('click', onImportBtn);
  colsEl.addEventListener('change', onColsChange);
  rowsEl.addEventListener('change', onRowsChange);

  // Render loop (separate from game loop)
  let alive = true;
  function tick() {
    if (!alive) return;
    renderer.renderEditor(runtime, cursor, overlay);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function destroy() {
    alive = false;
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseleave', onMouseLeave);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove',  onTouchMove);
    canvas.removeEventListener('touchend',   onTouchEnd);
    document.removeEventListener('keydown', onKey);
    sizeBtn.removeEventListener('click', onSizeBtn);
    playBtn.removeEventListener('click', onPlayBtn);
    saveBtn.removeEventListener('click', onSaveBtn);
    clearBtn.removeEventListener('click', onClearBtn);
    deleteBtn.removeEventListener('click', onDeleteBtn);
    backBtn.removeEventListener('click', onBackBtn);
    if (exportBtn) exportBtn.removeEventListener('click', onExportBtn);
    if (importBtn) importBtn.removeEventListener('click', onImportBtn);
    colsEl.removeEventListener('change', onColsChange);
    rowsEl.removeEventListener('change', onRowsChange);
    activeController = null;
  }

  activeController = { destroy };
}

/** @returns {{map: MapDef, persisted: boolean}} */
function resolveMap(mapId) {
  if (mapId && mapId.indexOf('builtin:') !== 0) {
    const found = getMapById(mapId);
    if (found) return { map: { ...found, data: [...found.data] }, persisted: true };
  }
  return { map: createBlankUserMap(), persisted: false };
}
