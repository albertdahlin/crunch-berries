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

// Integer ids — stored in map data, referenced by editor brushes and sim code.
// Keep these stable; adding a new type means appending, not renumbering.
export const GROUND_GRASS    = 0;
export const GROUND_ROAD     = 1;
export const GROUND_WATER    = 2;
export const GROUND_SWAMP    = 3;
export const GROUND_FOREST   = 4;
export const GROUND_MOUNTAIN = 5;

/**
 * @typedef {Object} GroundType
 * @property {string}  name
 * @property {string}  help          Short human description of behaviour
 * @property {boolean} walkable      Monsters can cross this tile
 * @property {boolean} buildable     Towers can be placed here
 * @property {number}  speedMult     Monster move-speed multiplier
 * @property {boolean} blocksSight   Stops projectiles and tower LOS
 * @property {string}  bg            Fill colour
 * @property {string}  char          Optional glyph drawn on the tile
 * @property {string}  charColor     Glyph colour (empty if char is empty)
 */

/** @type {GroundType[]} Indexed by GROUND_* id. */
export const GROUND_TYPES = [
  { name: 'Grass'
  , help: 'Walkable, buildable'
  , walkable: true
  , buildable: true
  , speedMult: 1.0
  , blocksSight: false
  , bg: '#1a2a1a'
  , char: ''
  , charColor: ''
  },
  { name: 'Road'
  , help: 'Walkable, not buildable'
  , walkable: true
  , buildable: false
  , speedMult: 1.0
  , blocksSight: false
  , bg: '#2a2218'
  , char: '·'
  , charColor: '#3a3028'
  },
  { name: 'Water'
  , help: 'Impassable, not buildable'
  , walkable: false
  , buildable: false
  , speedMult: 1.0
  , blocksSight: false
  , bg: '#0a1a3a'
  , char: '♒︎'
  , charColor: '#1a3a6a'
  },
  { name: 'Swamp'
  , help: 'Walkable, not buildable, 0.5x speed'
  , walkable: true
  , buildable: false
  , speedMult: 0.5
  , blocksSight: false
  , bg: '#2a2a0a'
  , char: '𖣂'
  , charColor: '#4a4a1a'
  },
  { name: 'Forest'
  , help: 'Not walkable, buildable'
  , walkable: false
  , buildable: true
  , speedMult: 1.0
  , blocksSight: false
  , bg: '#0a2a0a'
  , char: '\u2663'
  , charColor: '#1a5a1a'
  },
  { name: 'Mountain'
  , help: 'Impassable, not buildable, blocks line of sight'
  , walkable: false
  , buildable: false
  , speedMult: 1.0
  , blocksSight: true
  , bg: '#2a2a2a'
  , char: '\u25B2'
  , charColor: '#888'
  },
];

// 8 directions: 0=up, 1=up-right, 2=right, 3=down-right, 4=down, 5=down-left, 6=left, 7=up-left
export const DX = [0, 1, 1, 1, 0, -1, -1, -1];
export const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

export const ROT_NAMES = ['\u2191', '\u2192', '\u2193', '\u2190'];

export function framesToSec(f) { return +(f / FPS).toFixed(2); }
export function secToFrames(s) { return Math.round(s * FPS); }
