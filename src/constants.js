// @ts-check

export const VERSION = '__VERSION__';
export const FPS = 30;
export const TICK_RATE = 1000 / FPS;

export const DAMAGE_TYPES = ['physical', 'fire', 'ice', 'lightning', 'poison'];
export const DAMAGE_TYPE_COLORS = {
  physical:  '#aaa',
  fire:      '#ff6600',
  ice:       '#66ccff',
  lightning: '#ffff33',
  poison:    '#aa44ff',
};

export const GROUND_GRASS  = 0;
export const GROUND_ROAD   = 1;
export const GROUND_WATER  = 2;
export const GROUND_SWAMP  = 3;
export const GROUND_FOREST = 4;

export const GROUND_WALKABLE   = [true,  true,  false, true,  false];
export const GROUND_BUILDABLE  = [true,  false, false, false, true];
export const GROUND_SPEED_MULT = [1.0,   1.0,   1.0,   0.5,   1.0];

export const GROUND_BG         = ['#1a2a1a', '#2a2218', '#0a1a3a', '#2a2a0a', '#0a2a0a'];
export const GROUND_CHAR       = ['', '.', '~', ',', '\u2663'];
export const GROUND_CHAR_COLOR = ['', '#3a3028', '#1a3a6a', '#4a4a1a', '#1a5a1a'];

export const GROUND_NAMES = ['Grass', 'Road', 'Water', 'Swamp', 'Forest'];
export const GROUND_HELP  = [
  'Walkable, buildable',
  'Walkable, not buildable',
  'Impassable, not buildable',
  'Walkable, not buildable, 0.5x speed',
  'Not walkable, buildable',
];

// 8 directions: 0=up, 1=up-right, 2=right, 3=down-right, 4=down, 5=down-left, 6=left, 7=up-left
export const DX = [0, 1, 1, 1, 0, -1, -1, -1];
export const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

export const ROT_NAMES = ['\u2191', '\u2192', '\u2193', '\u2190'];

export function framesToSec(f) { return +(f / FPS).toFixed(2); }
export function secToFrames(s) { return Math.round(s * FPS); }

export function esc(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
