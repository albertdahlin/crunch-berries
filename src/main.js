// @ts-check
import { migrateLegacyConfig } from './storage.js';
import { createCanvasRenderer } from './render-canvas.js';
import { createHud } from './hud.js';
import { createScreenManager } from './home.js';
import { loadBuiltinMaps } from './maps.js';

migrateLegacyConfig();

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const renderer = createCanvasRenderer(canvas);
const hud = createHud();
const screens = createScreenManager({ canvas, renderer, hud });

await loadBuiltinMaps();
screens.start();
