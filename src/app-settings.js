// @ts-check
/** @typedef {import('./types.js').AppSettings} AppSettings */

const KEY = 'td-app-settings';

/** @type {AppSettings} */
const DEFAULTS = {
  rendererType: 'canvas',
};

/** @returns {AppSettings} */
export function loadAppSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

/** @param {Partial<AppSettings>} partial */
export function saveAppSettings(partial) {
  const merged = { ...loadAppSettings(), ...partial };
  localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

export const APP_SETTINGS_KEY = KEY;
