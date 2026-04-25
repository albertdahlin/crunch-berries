# Tower Defence

A mobile-friendly browser tower-defence game. Monsters march from the top of the map to the bottom. Your job is to stop them with towers, upgrades, and a little strategy about terrain and damage types.

## How to play

- Place towers in the **Place** phase to spend gold.
- Press **Wave** to unleash the next horde.
- Kills give gold and score. Each monster that reaches the bottom row costs a life. When lives hit zero, it's game over.
- You can place more towers between waves with the gold you've earned.

## Features

### Towers

There are three base tower families, each with a branching upgrade tree. Every tower can be upgraded twice (to a mid-tier specialist, then to a final form).

- **Soldier** — melee fighter. Cheap, sturdy, and physically blocks enemy paths on the grid. Upgrades into Swordsman (→ 2-Handed, Dual-Wield), Archer (→ Poison, Crossbow, Longbow), or Thief (steals bonus gold on nearby kills).
- **Mage** — splash-damage elemental caster. Upgrades into Pyromancer (→ Inferno, Flamecaster) for fire + burn-over-time, Cryomancer (→ Blizzard, Frostbite) for slow effects, or Stormcaller (→ Chain Lightning, Thunderbolt) for piercing line attacks.
- **Barricade** — very cheap wall with no attack, used to shape monster paths. Upgrades into Catapult (→ Fire Catapult, Trebuchet) for siege AOE, or Ballista (→ Scorpion, Greatbow) for piercing line shots.

Towers also support:

- **Rotation** for directional / piercing attackers (R key or Rotate button) to aim down rows or columns.
- **Sell** for a refund. Full refund if sold the same wave you placed it (before a wave starts); otherwise a configurable percentage.
- **HP bar** — towers can be damaged and destroyed if enemies reach them and the path is blocked.
- **1x1 and 2x2 footprints** — larger towers take more space but cover more ground.

### Monsters

Six enemy types in the Classic campaign, each with its own resistances and weaknesses:

- **Goblin** — common greenskin, no special traits.
- **Wolf** — fragile but very fast. Weak to ice.
- **Knight** — heavy armor, resists physical. Weak to fire and lightning.
- **Bat** — tiny HP, swarms in huge numbers. Lightning sweeps them away.
- **Troll** — massive HP brute. Resists blades and cold, burns and poisons hit hard.
- **Shade** — resists all magic, only physical hurts it.

### Damage types and elemental matchups

Five damage types — **physical, fire, ice, lightning, poison** — each with its own color and effect. Each monster has per-type multipliers, so picking the right tower for the wave matters. Some towers also apply:

- **Damage-over-time (DOT)** — poison, fire burn, frostbite.
- **Slow** — ice towers reduce enemy speed for a duration.
- **Splash** — hits all enemies within a radius of the target.
- **Pierce** — projectile passes through every enemy in a straight line.
- **Gold steal** — extra gold when an enemy dies inside the tower's range.

### Terrain types

Maps are painted from six tile types, each with different gameplay properties:

- **Grass** — walkable and buildable. Default.
- **Road** — walkable but no towers allowed. Top and bottom rows are always road (spawn and exit lanes).
- **Water** — impassable and unbuildable. Pure obstacle.
- **Swamp** — walkable but slows monsters to half speed. A great chokepoint.
- **Forest** — not walkable, but you can still build towers on it.
- **Mountain** — impassable, unbuildable, and **blocks line of sight**. Projectiles explode on impact and towers can't see through.

### Maps and pathfinding

- Monsters use intelligent flow-field pathfinding, always taking the cheapest route to the bottom.
- They prefer moving downward; sideways costs more, backward costs most. You can funnel them with barricades.
- Placing a tower that would completely wall off the spawn row is rejected.
- If the path gets blocked mid-wave, monsters start **attacking the nearest tower** to break through.

### Waves

- **Scripted waves** — early waves have a hand-tuned monster roster. Some waves drop **lore text** ("The ground shakes. A troll approaches...") and some award a **bonus gold** reward for completion.
- **Endless scaling** — once the scripted list runs out, monster counts double at a configurable interval (every 2 waves by default) and HP ramps up each wave.
- **Tower unlocks** — towers can be gated so they only appear from specific waves onward.
- **Wave bonus gold** awarded at the end of every completed wave.
- **Spawn pacing** — the spawn interval shrinks each wave until it hits a minimum, so late waves are denser in time as well as numbers.

### Speed control

A **1x / 2x / 5x** toggle button speeds up the simulation (useful for grinding through cleared waves).

### Bestiary

An in-game **Bestiary** button opens a panel listing every monster on the current campaign with stats, description, and damage multipliers so you can plan your counter-picks.

### Campaigns

A **campaign** is a complete ruleset — towers, upgrades, monsters, waves, starting gold/lives, and refund rate. The game ships with the **Classic** campaign. You can:

- **Clone** Classic to start a custom campaign.
- **Edit everything**: tower stats and upgrade trees, monster stats and resistances, per-wave rosters, lore text, bonus gold, spawn pacing, HP scaling, starting gold and lives, sell refund percentage.
- **Create new towers and monsters** from scratch, including colors, letters, and elemental properties.
- **Export / import** campaigns as JSON files so you can share them or back them up.

### Map editor

- Paint terrain with a brush in six ground types.
- Adjustable **brush size** (1x1, 2x2, 3x3).
- Resize maps from 5x5 up to 60x60.
- **Play test** — jump straight into a playable wave from your current map to see how it performs.
- **Export / import** maps as JSON.
- Built-in maps are read-only; "editing" one clones it into a new user map.

### Save / load

- **Save mid-game** from the in-game Save button; each save records which map and campaign you're on.
- **Resume** from the home screen's Load Game list (up to 20 recent saves kept).
- Campaigns, maps, and saved games are stored in the browser's local storage — no account, no server.
- **Clear all local data** button in Settings to wipe everything cleanly.

### Mobile and accessibility

- **Touch-first UI** — tap to place, drag to paint maps, sticky HUD and action buttons.
- **Wake-lock** requested during waves so your screen doesn't dim mid-battle.
- **Keyboard shortcuts** when playing on desktop:
  - Arrow keys move the cursor.
  - Space / Enter places a tower.
  - `W` starts the wave.
  - `R` rotates the selected placed tower.
  - `X` / Delete sells the selected tower.
  - `B` opens the Bestiary.
  - Number keys pick a tower type or an upgrade choice.
  - Escape deselects.

### Two renderers

- **Canvas** (default) — fast 2D top-down view, works everywhere.
- **WebGL** (experimental) — isometric 3D view powered by Three.js. Drag to pan, scroll to zoom. Switch from Settings.

### Version display

The home screen and in-game HUD show a build version number so you always know which revision you're playing.

## Running locally

It's a static site — no build step, no dependencies to install.

```
python3 -m http.server   # or: npx serve
```

Then open `http://localhost:8000/`. Opening `index.html` directly over `file://` won't work because built-in maps are loaded via `fetch`.
