// @ts-check
/** @typedef {import('./types.js').MapDef} MapDef */

import { loadMaps, saveMaps, newUserId } from './storage.js';
import { GROUND_GRASS, GROUND_ROAD } from './constants.js';

/** Virtual "Empty Map" entry with a fixed id. */
export const EMPTY_MAP_ID = 'builtin:empty';

const MAPS_DIR = 'maps/';

/** @type {MapDef[]} */
let builtinCache = [];

/** @returns {MapDef} */
export function makeEmptyMap(cols = 15, rows = 15) {
  const data = new Array(cols * rows).fill(GROUND_GRASS);
  for (let x = 0; x < cols; x++) {
    data[x] = GROUND_ROAD;
    data[(rows - 1) * cols + x] = GROUND_ROAD;
  }
  return { id: EMPTY_MAP_ID, name: 'Empty', cols, rows, data };
}

/**
 * Fetch the built-in map manifest (`maps/index.json`) and load each listed
 * JSON file. Called once at startup; results cached for synchronous access.
 * @returns {Promise<void>}
 */
export async function loadBuiltinMaps() {
  try {
    const idx = await fetch(MAPS_DIR + 'index.json', { cache: 'no-cache' });
    if (!idx.ok) return;
    const files = await idx.json();
    if (!Array.isArray(files)) return;
    const loaded = await Promise.all(files.map(async (fname) => {
      try {
        const res = await fetch(MAPS_DIR + fname, { cache: 'no-cache' });
        if (!res.ok) return null;
        const raw = await res.json();
        if (!raw.data || !raw.cols || !raw.rows) return null;
        const base = String(fname).replace(/\.json$/i, '');
        /** @type {MapDef} */
        const m = {
          id: 'builtin:' + base,
          name: raw.name || base,
          cols: raw.cols,
          rows: raw.rows,
          data: Array.from(raw.data),
        };
        return m;
      } catch (e) { return null; }
    }));
    builtinCache = loaded.filter(Boolean);
  } catch (e) { /* offline / file:// — skip */ }
}

/** @returns {MapDef[]} */
export function listBuiltinMaps() {
  return [makeEmptyMap(), ...builtinCache];
}

/** @returns {MapDef[]} */
export function listAllMaps() {
  return [...listBuiltinMaps(), ...loadMaps()];
}

/** @param {string} id @returns {?MapDef} */
export function getMapById(id) {
  if (id === EMPTY_MAP_ID) return makeEmptyMap();
  const builtin = builtinCache.find(m => m.id === id);
  if (builtin) return { ...builtin, data: [...builtin.data] };
  const found = loadMaps().find(m => m.id === id);
  return found || null;
}

/** @param {MapDef} map @returns {MapDef} The saved map, with id assigned if new. */
export function upsertUserMap(map) {
  if (map.id && map.id.indexOf('builtin:') === 0) throw new Error('cannot save over built-in map');
  const list = loadMaps();
  if (!map.id) map.id = newUserId('map');
  const idx = list.findIndex(m => m.id === map.id);
  if (idx >= 0) list[idx] = map; else list.push(map);
  saveMaps(list);
  return map;
}

/** @param {MapDef} source @returns {MapDef} A fresh unsaved user copy. */
export function cloneMapForEdit(source) {
  return {
    id: newUserId('map'),
    name: source.name + ' (copy)',
    cols: source.cols,
    rows: source.rows,
    data: [...source.data],
  };
}

/** @param {string} id */
export function deleteUserMap(id) {
  saveMaps(loadMaps().filter(m => m.id !== id));
}

/** Make a fresh unsaved MapDef for the editor. */
export function createBlankUserMap() {
  const m = makeEmptyMap();
  m.id = newUserId('map');
  m.name = 'My Map';
  return m;
}
