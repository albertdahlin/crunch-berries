// @ts-check
/** @typedef {import('./types.js').Campaign} Campaign */
/** @typedef {import('./types.js').TowerDef} TowerDef */

import { loadUserCampaigns, saveUserCampaigns, newUserId } from './storage.js';

/** The shipped "Classic" campaign (formerly DEFAULT_CONFIG). */
/** @type {Campaign} */
export const CLASSIC_CAMPAIGN = {
  id: 'builtin:classic',
  name: 'Classic',
  builtin: true,
  towers: [
    { name: 'Soldier', letter: 'S', color: '#4fc3f7', bg: '#1565c0', range: 1, damage: 3, fireRate: 15, cost: 10, hp: 10, damageType: 'physical', desc: 'Melee fighter. Cheap and sturdy, blocks enemy paths.', upgrades: [
      { name: 'Swordsman', letter: 'S', color: '#42a5f5', bg: '#1565c0', damage: 5, fireRate: 12, cost: 15, hp: 14, desc: 'Trained blade fighter with improved damage.', upgrades: [
        { name: '2 Handed', letter: 'H', color: '#1e88e5', bg: '#0d47a1', damage: 10, fireRate: 25, cost: 25, hp: 18, desc: 'Massive strikes. Slow but devastating.' },
        { name: 'Dual Wield', letter: 'W', color: '#64b5f6', bg: '#1565c0', damage: 3, fireRate: 6, cost: 25, hp: 12, desc: 'Twin blades. Very fast attacks, low damage each.' },
      ]},
      { name: 'Archer', letter: 'A', color: '#fff176', bg: '#f57f17', range: 4, damage: 2, fireRate: 30, cost: 15, hp: 6, projectileSpeed: 0.15, desc: 'Ranged attacker with good reach.', upgrades: [
        { name: 'Poison', letter: 'P', color: '#81c784', bg: '#2e7d32', range: 3, damage: 1, fireRate: 25, cost: 25, hp: 5, damageType: 'poison', dot: { dps: 1.5, duration: 90 }, projectileSpeed: 0.12, desc: 'Poison-tipped arrows. Low hit damage but deadly DOT.' },
        { name: 'Crossbow', letter: 'X', color: '#ffee58', bg: '#f57f17', damage: 6, fireRate: 50, cost: 30, projectileSpeed: 0.2, desc: 'Heavy bolts. Slow reload, high damage per shot.' },
        { name: 'Longbow', letter: 'L', color: '#fff9c4', bg: '#f57f17', range: 6, fireRate: 18, cost: 20, projectileSpeed: 0.18, desc: 'Extended range. Fast, light arrows from afar.' },
      ]},
      { name: 'Thief', letter: 'T', color: '#a5d6a7', bg: '#2e7d32', damage: 2, fireRate: 10, cost: 20, hp: 8, goldSteal: 3, desc: 'Steals bonus gold when enemies die nearby. Fast but fragile.' },
    ]},
    { name: 'Mage', letter: 'M', color: '#ff8a65', bg: '#bf360c', range: 3, damage: 2, fireRate: 40, cost: 15, hp: 5, damageType: 'fire', projectileSpeed: 0.1, splashRadius: 1, desc: 'Elemental caster. Slow attacks that hit a small area with fire.', upgrades: [
      { name: 'Pyromancer', letter: 'Y', color: '#ff7043', bg: '#bf360c', damage: 3, fireRate: 45, cost: 20, splashRadius: 1.5, dot: { dps: 1.5, duration: 90 }, desc: 'Fire specialist. Burns enemies over time.', upgrades: [
        { name: 'Inferno', letter: 'N', color: '#ff5722', bg: '#b71c1c', damage: 2, fireRate: 50, cost: 30, hp: 4, splashRadius: 3, dot: { dps: 2.5, duration: 120 }, desc: 'Devastating firestorm. Huge AOE with intense burn.' },
        { name: 'Flamecaster', letter: 'F', color: '#ffab91', bg: '#bf360c', damage: 5, fireRate: 35, cost: 25, splashRadius: 0, desc: 'Focused fire bolts. High single-target damage with burn.' },
      ]},
      { name: 'Cryomancer', letter: 'C', color: '#80deea', bg: '#006064', damageType: 'ice', damage: 1, fireRate: 35, cost: 20, hp: 6, splashRadius: 2, speedFactor: 0.4, speedDuration: 90, desc: 'Ice specialist. Slows groups of enemies.', upgrades: [
        { name: 'Blizzard', letter: 'Z', color: '#b2ebf2', bg: '#00838f', fireRate: 30, cost: 30, splashRadius: 3, speedFactor: 0.3, speedDuration: 120, desc: 'Freezing storm. Massive area slow, enemies nearly stop.' },
        { name: 'Frostbite', letter: 'O', color: '#4dd0e1', bg: '#006064', damage: 2, fireRate: 30, cost: 25, hp: 5, splashRadius: 1, dot: { dps: 1, duration: 120 }, speedFactor: 0.5, speedDuration: 60, desc: 'Icy venom. Slows and deals cold damage over time.' },
      ]},
      { name: 'Stormcaller', letter: 'K', color: '#ce93d8', bg: '#4a148c', damageType: 'lightning', range: 4, damage: 2, fireRate: 35, cost: 20, hp: 4, pierce: true, attackDir: 'fixed', desc: 'Lightning specialist. Bolts pierce all enemies in a line.', upgrades: [
        { name: 'Chain Lightning', letter: 'G', color: '#ba68c8', bg: '#6a1b9a', range: 5, damage: 3, fireRate: 40, cost: 25, desc: 'Devastating storm. Longer range, more powerful bolts.' },
        { name: 'Thunderbolt', letter: 'V', color: '#e1bee7', bg: '#4a148c', damage: 4, fireRate: 25, cost: 30, hp: 3, range: 5, desc: 'Rapid lightning strikes. Fast, precise, extreme range.' },
      ]},
    ]},
    { name: 'Barricade', letter: 'B', color: '#90a4ae', bg: '#455a64', range: 0, damage: 0, fireRate: 9999, cost: 3, hp: 15, desc: 'Cheap wall. No attack, blocks paths to redirect enemies.', upgrades: [
      { name: 'Catapult', letter: 'Q', color: '#a1887f', bg: '#4e342e', range: 4, damage: 4, fireRate: 60, cost: 18, hp: 10, damageType: 'physical', projectileSpeed: 0.08, splashRadius: 2, desc: 'Siege engine. Lobs boulders that damage an area.', upgrades: [
        { name: 'Fire Catapult', letter: 'J', color: '#ff8a65', bg: '#4e342e', damageType: 'fire', damage: 3, fireRate: 55, cost: 25, hp: 8, splashRadius: 2.5, dot: { dps: 2, duration: 90 }, desc: 'Burning pitch. Smaller rocks but sets the ground ablaze.' },
        { name: 'Trebuchet', letter: 'U', color: '#8d6e63', bg: '#3e2723', damage: 8, fireRate: 90, cost: 30, hp: 8, range: 6, splashRadius: 3, desc: 'Massive siege weapon. Enormous range and splash, very slow.' },
      ]},
      { name: 'Ballista', letter: 'D', color: '#bcaaa4', bg: '#4e342e', range: 5, damage: 3, fireRate: 40, cost: 15, hp: 10, damageType: 'physical', pierce: true, attackDir: 'fixed', desc: 'Bolt thrower. Skewers all enemies in a line.', upgrades: [
        { name: 'Scorpion', letter: 'R', color: '#81c784', bg: '#2e7d32', damageType: 'poison', damage: 2, fireRate: 30, cost: 20, hp: 8, dot: { dps: 1.5, duration: 90 }, desc: 'Venomous bolts. Pierce with lingering poison.' },
        { name: 'Greatbow', letter: 'I', color: '#d7ccc8', bg: '#3e2723', damage: 6, fireRate: 55, cost: 25, hp: 7, range: 7, desc: 'Heavy siege bow. Extreme range and devastating piercing bolts.' },
      ]},
    ]},
  ],
  monsters: [
    { name: 'Goblin', letter: 'G', color: '#66bb6a', hp: 10, speed: 0.08, reward: 5, desc: 'Common greenskin. No special abilities.' },
    { name: 'Wolf',   letter: 'W', color: '#8d6e63', hp: 5,  speed: 0.16, reward: 6, damageModifiers: { ice: 2 }, desc: 'Swift predator. Fragile but fast. Weak to ice.' },
    { name: 'Knight', letter: 'K', color: '#78909c', hp: 25, speed: 0.05, reward: 12, damageModifiers: { physical: 0.5, fire: 2, lightning: 1.5 }, desc: 'Heavy plate armor. Resists blades, weak to fire and lightning.' },
    { name: 'Bat',    letter: 'B', color: '#ce93d8', hp: 3,  speed: 0.13, reward: 2, damageModifiers: { lightning: 3 }, desc: 'Swarming in huge numbers. Lightning sweeps them away.' },
    { name: 'Troll',  letter: 'T', color: '#2e7d32', hp: 40, speed: 0.04, reward: 15, damageModifiers: { physical: 0.5, fire: 2, poison: 2, ice: 0.5 }, desc: 'Massive brute. Shrugs off blades and cold. Burns and poison eat through it.' },
    { name: 'Shade',  letter: 'S', color: '#424242', hp: 15, speed: 0.07, reward: 8, damageModifiers: { fire: 0.5, ice: 0.5, lightning: 0.5, poison: 0.5, physical: 2 }, desc: 'Dark spirit. Resists all magic but vulnerable to physical force.' },
  ],
  waves: {
    baseCounts: [5, 3, 2, 8, 1, 2],
    unlockWave: [1, 1, 3, 2, 4, 5],
    scaleEvery: 2,
    hpScale: 20,
    intervalStart: 40,
    intervalDecay: 3,
    intervalMin: 10,
  },
  game: {
    startGold: 50,
    startLives: 20,
    waveBonusGold: 10,
    sellRefundPercent: 50,
  },
};

/** @type {Campaign[]} */
export const BUILTIN_CAMPAIGNS = [CLASSIC_CAMPAIGN];

/** @returns {Campaign[]} Built-ins followed by user-created campaigns. */
export function listAllCampaigns() {
  return [...BUILTIN_CAMPAIGNS.map(deepCopy), ...loadUserCampaigns()];
}

/** @param {string} id @returns {?Campaign} */
export function getCampaignById(id) {
  for (const c of BUILTIN_CAMPAIGNS) if (c.id === id) return deepCopy(c);
  for (const c of loadUserCampaigns()) if (c.id === id) return c;
  return null;
}

/** @param {Campaign} campaign @returns {Campaign} The saved user campaign. */
export function upsertUserCampaign(campaign) {
  if (campaign.builtin) throw new Error('cannot save built-in campaign');
  const list = loadUserCampaigns();
  const idx = list.findIndex(c => c.id === campaign.id);
  if (idx >= 0) list[idx] = campaign; else list.push(campaign);
  saveUserCampaigns(list);
  return campaign;
}

/** @param {string} id */
export function deleteUserCampaign(id) {
  const list = loadUserCampaigns().filter(c => c.id !== id);
  saveUserCampaigns(list);
}

/** @param {Campaign} source @returns {Campaign} */
export function cloneCampaignForEdit(source) {
  const copy = deepCopy(source);
  copy.id = newUserId('user');
  copy.builtin = false;
  copy.name = source.name + ' (copy)';
  return copy;
}

export function createEmptyUserCampaign() {
  return cloneCampaignForEdit(CLASSIC_CAMPAIGN);
}

/** @param {Campaign} campaign @param {number} typeIdx @param {number} rotation */
export function getTowerSize(campaign, typeIdx, rotation) {
  const type = campaign.towers[typeIdx];
  if (!type) return { w: 2, h: 2 };
  const sw = type.sizeW || 2, sh = type.sizeH || 2;
  return (rotation === 1 || rotation === 3) ? { w: sh, h: sw } : { w: sw, h: sh };
}

/** @param {Campaign} campaign @param {import('./types.js').Tower} tower */
export function getTowerNode(campaign, tower) {
  return getMergedNode(campaign.towers[tower.typeIdx], tower.upgradePath || []);
}

/** Walk upgrade path, return deepest existing node. */
export function getConfigNode(root, path) {
  let node = root;
  for (const idx of path) {
    if (!node.upgrades || !node.upgrades[idx]) break;
    node = node.upgrades[idx];
  }
  return node;
}

/** Walk upgrade path, merging properties shallowly from root down. */
export function getMergedNode(root, path) {
  const merged = {};
  let node = root;
  for (const key in node) if (key !== 'upgrades') merged[key] = node[key];
  for (const idx of path) {
    if (!node.upgrades || !node.upgrades[idx]) break;
    node = node.upgrades[idx];
    for (const key in node) if (key !== 'upgrades') merged[key] = node[key];
  }
  if (node.upgrades) merged.upgrades = node.upgrades;
  return merged;
}

/** @param {import('./types.js').WaveConfig} waves @param {import('./types.js').MonsterDef[]} monsters @param {number} waveNum */
export function getWaveConfig(waves, monsters, waveNum) {
  const scale = Math.pow(2, Math.floor((waveNum - 1) / waves.scaleEvery));
  const counts = monsters.map((_, i) => {
    const base = (waves.baseCounts[i] || 1);
    const unlock = (waves.unlockWave[i] || 1);
    return waveNum >= unlock ? Math.round(base * scale) : 0;
  });
  const interval = Math.max(waves.intervalMin, waves.intervalStart - (waveNum - 1) * waves.intervalDecay);
  const hpMult = 1 + (waveNum - 1) * (waves.hpScale || 0) / 100;
  return { counts, interval, hpMult };
}

function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }
