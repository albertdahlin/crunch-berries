// @ts-check
import { migrateLegacyConfig } from './storage.js';
import { loadAppSettings } from './app-settings.js';
import { createCanvasRenderer } from './render-canvas.js';
import { createHud } from './hud.js';
import { createScreenManager } from './home.js';
import { loadBuiltinMaps } from './maps.js';

migrateLegacyConfig();

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const hud = createHud();

const { rendererType } = loadAppSettings();
let renderer;
if (rendererType === 'webgl') {
  try {
    // Dynamic import so Three.js isn't fetched on canvas sessions.
    const mod = await import('./render-webgl.js');
    renderer = mod.createWebGLRenderer(canvas);
  } catch (e) {
    console.error('WebGL renderer failed to init, falling back to canvas:', e);
    renderer = createCanvasRenderer(canvas);
  }
} else {
  renderer = createCanvasRenderer(canvas);
}

const screens = createScreenManager({ canvas, renderer, hud });

await loadBuiltinMaps();
screens.start();
