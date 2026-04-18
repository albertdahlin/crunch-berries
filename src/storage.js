// @ts-check
/** @typedef {import('./types.js').Campaign} Campaign */
/** @typedef {import('./types.js').MapDef}   MapDef */
/** @typedef {import('./types.js').SavedGame} SavedGame */

const KEY_CAMPAIGNS = 'td-campaigns';
const KEY_MAPS      = 'td-maps';
const KEY_SAVES     = 'td-saves';
const KEY_LEGACY_CONFIG = 'td-config';
const KEY_APP_SETTINGS  = 'td-app-settings';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Convert the legacy single-config localStorage into a user campaign. */
export function migrateLegacyConfig() {
  const legacy = localStorage.getItem(KEY_LEGACY_CONFIG);
  if (!legacy) return;
  if (localStorage.getItem(KEY_CAMPAIGNS)) {
    localStorage.removeItem(KEY_LEGACY_CONFIG);
    return;
  }
  try {
    const parsed = JSON.parse(legacy);
    if (parsed && parsed.towers && parsed.monsters && parsed.waves && parsed.game) {
      /** @type {Campaign} */
      const c = {
        id: 'user:' + Date.now(),
        name: 'Custom',
        builtin: false,
        towers: parsed.towers,
        monsters: parsed.monsters,
        waves: parsed.waves,
        game: parsed.game,
      };
      writeJson(KEY_CAMPAIGNS, [c]);
    }
  } catch (e) { /* swallow */ }
  localStorage.removeItem(KEY_LEGACY_CONFIG);
}

/** @returns {Campaign[]} */
export function loadUserCampaigns() {
  const arr = readJson(KEY_CAMPAIGNS, []);
  return Array.isArray(arr) ? arr : [];
}

/** @param {Campaign[]} arr */
export function saveUserCampaigns(arr) { writeJson(KEY_CAMPAIGNS, arr); }

/** @returns {MapDef[]} */
export function loadMaps() {
  const raw = readJson(KEY_MAPS, []);
  if (!Array.isArray(raw)) return [];
  // Backfill id on any pre-id entries.
  return raw.map((m, i) => ({
    id: m.id || ('user:' + (m.name || 'map') + ':' + i),
    name: m.name || 'Unnamed',
    cols: m.cols || 15,
    rows: m.rows || 15,
    data: Array.isArray(m.data) ? m.data : Array.from(m.data || []),
  }));
}

/** @param {MapDef[]} arr */
export function saveMaps(arr) { writeJson(KEY_MAPS, arr); }

/** @returns {SavedGame[]} */
export function loadSavedGames() {
  const arr = readJson(KEY_SAVES, []);
  return Array.isArray(arr) ? arr : [];
}

/** @param {SavedGame[]} arr */
export function saveSavedGames(arr) { writeJson(KEY_SAVES, arr); }

export function newUserId(kind) {
  return (kind || 'user') + ':' + Date.now() + ':' + Math.floor(Math.random() * 1000);
}

/** Remove everything this app persists: campaigns, maps, saved games, app settings. */
export function clearAllStorage() {
  localStorage.removeItem(KEY_CAMPAIGNS);
  localStorage.removeItem(KEY_MAPS);
  localStorage.removeItem(KEY_SAVES);
  localStorage.removeItem(KEY_LEGACY_CONFIG);
  localStorage.removeItem(KEY_APP_SETTINGS);
}
