// @ts-check
/** @typedef {import('./types.js').MapDef} MapDef */

import { loadMaps, saveMaps, newUserId } from './storage.js';
import { GROUND_GRASS, GROUND_ROAD } from './constants.js';

/** Virtual "Empty Map" entry with a fixed id. */
export const EMPTY_MAP_ID = 'builtin:empty';

/** @returns {MapDef} */
export function makeEmptyMap(cols = 15, rows = 15) {
  const data = new Array(cols * rows).fill(GROUND_GRASS);
  for (let x = 0; x < cols; x++) {
    data[x] = GROUND_ROAD;
    data[(rows - 1) * cols + x] = GROUND_ROAD;
  }
  return { id: EMPTY_MAP_ID, name: 'Empty', cols, rows, data };
}

/** @returns {MapDef[]} */
export function listAllMaps() {
  return [makeEmptyMap(), ...loadMaps()];
}

/** @param {string} id @returns {?MapDef} */
export function getMapById(id) {
  if (id === EMPTY_MAP_ID) return makeEmptyMap();
  const found = loadMaps().find(m => m.id === id);
  return found || null;
}

/** @param {MapDef} map @returns {MapDef} The saved map, with id assigned if new. */
export function upsertUserMap(map) {
  if (map.id === EMPTY_MAP_ID) throw new Error('cannot save over built-in empty');
  const list = loadMaps();
  if (!map.id) map.id = newUserId('map');
  const idx = list.findIndex(m => m.id === map.id);
  if (idx >= 0) list[idx] = map; else list.push(map);
  saveMaps(list);
  return map;
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
