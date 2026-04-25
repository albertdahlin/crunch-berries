# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mobile-first browser tower-defence game. Pure static site — HTML + ES modules + `localStorage`, no build step, no package manager, no tests. `index.html` loads `src/main.js` as an ES module; `three` is pulled via an import map from `esm.sh` and only loaded when the WebGL renderer is selected.

## Running / deploying

Open `index.html` over an HTTP server (ES modules + `fetch` for maps won't work over `file://`). Any static server works: `python3 -m http.server`, `npx serve`, etc. There is no dev script, lint, or test command.

The constant `VERSION` in `src/constants.js` is literally the string `__VERSION__` in source; CI substitutes it at deploy time with the git commit count (`git rev-list --count HEAD`). Don't replace it locally — keep the sentinel.

Deployment is `.github/workflows/deploy.yml`: on push to the current working branch, it rsyncs `index.html`, `src/`, and `maps/` to `github@8h.nu:/srv/8h.nu/pub/td/`. There is no GitHub Pages deploy.

## Architecture

### Module layering (no circular deps)

```
main.js
  └─ home.js (screen/router manager; owns Game lifecycle)
       ├─ router.js              hash-fragment routing (#/play/:c/:m etc.)
       ├─ game.js                sim: towers, monsters, projectiles, waves, phases
       ├─ edit-map.js            grid-paint editor
       ├─ edit-campaign.js       towers/monsters/waves config UI
       ├─ hud.js                 in-game DOM HUD, binds to Game handlers
       ├─ render-canvas.js       2D renderer (Renderer interface)
       └─ render-webgl.js        Three.js renderer, dynamically imported
  ├─ campaigns.js  built-in Classic campaign + upgrade-path merge logic
  ├─ maps.js       built-in map manifest loader + user map CRUD
  ├─ pathfind.js   Dijkstra flow-field from bottom row up
  ├─ storage.js    localStorage keys + legacy-config migration
  ├─ app-settings.js
  ├─ constants.js  FPS=30, ground types, direction vectors
  ├─ html.js       tiny DOM-builder (div/span/button/… helpers)
  └─ types.js      JSDoc `@typedef`s only — no runtime code
```

### Three big contracts

**`Renderer`** (see `types.js`). Both `render-canvas.js` and `render-webgl.js` implement the same interface: `renderGame(state, map, campaign)`, `renderEditor(map, cursor, overlay)`, `resize`, `clientToTile`, `setGridSize`, `clear`. The Game never touches the canvas — it hands a `GameState` + `MapRuntime` + `Campaign` to the renderer each tick. To add visuals, update both renderers (or decide whether the feature is renderer-specific).

**`Campaign`**. A serialisable bundle of `towers[]`, `monsters[]`, `waves` (`WaveConfig`), and `game` (starting gold/lives/etc.). Towers are trees: `TowerDef.upgrades` is an array of partial `TowerDef`s. A placed `Tower` stores an `upgradePath: number[]`; `campaigns.getMergedNode(root, path)` walks the path and shallow-merges properties so the leaf inherits from its ancestors. Use `getTowerNode(campaign, tower)` and `getTowerSize(campaign, typeIdx, rotation)` — don't index `upgrades` by hand.

**`MapDef` vs `MapRuntime`**. `MapDef` is the serialisable shape (`id, name, cols, rows, data[]`). `game.buildMapRuntime(mapDef)` expands it into a `MapRuntime` with typed arrays for `ground` (tile types) and `grid` (tower occupancy), plus `pathDist`/`pathFlow` from the flow-field solver. The top and bottom rows are **always force-overwritten to `GROUND_ROAD`** — they are the spawn/exit lanes and cannot be edited.

### Pathfinding

`pathfind.computePath(runtime, tempGrid?)` runs a Dijkstra flow-field seeded from every open tile on the bottom row (exit), producing `dist` and `flow` arrays. Monsters follow `flow` upward. `DIR_COST` in `pathfind.js` biases monsters to move downward (away from the top row where they spawn) — don't change the costs without understanding the bias. `isTopRowReachable(runtime, tempGrid)` is used before placing a tower to ensure placement doesn't fully wall off spawns; a `tempGrid` arg lets callers probe a hypothetical placement without mutating state.

### Game loop and phases

`createGame()` in `game.js` runs at `FPS = 30` via `setInterval(step, TICK_RATE)`. `GamePhase` is `'PLACE' | 'WAVE' | 'GAMEOVER'`. Players only spend gold and place towers in `PLACE`; the `Wave` button transitions to `WAVE`, which spawns until the roster for that wave is exhausted and all monsters have died, then returns to `PLACE`. Wave rosters come from `campaign.waves.list[idx]`; past the list's end, counts double every `scaleEvery` waves via `getWaveConfig()`.

### Routing and screen lifecycle

`home.js::createScreenManager` owns every non-in-game screen and the single active `Game`. Navigation is driven by `router.js` (hash fragments like `#/play/:campaignId/:mapId`). `hideAll()` is called on every route transition, then the target screen is shown. The canvas DOM element is shared by play, map editor, and WebGL; the renderer is created once in `main.js` and reused. When writing a new screen, add it as a route and follow the `hideAll(); showMyStuff()` pattern.

### Persistence

All state lives in `localStorage` under keys defined in `storage.js`:

- `td-campaigns` — user campaigns (built-ins are source code, not stored)
- `td-maps` — user maps (built-ins live in `maps/` and are fetched at startup)
- `td-saves` — saved in-progress games (capped at 20, most-recent-first)
- `td-app-settings` — renderer choice
- `td-config` — legacy single-config key, auto-migrated on startup (`migrateLegacyConfig`)

`maps/index.json` is a manifest — an array of JSON filenames. `maps.loadBuiltinMaps()` fetches it at startup then each listed file; a missing index or a `file://` load gracefully falls back to the empty list. To add a built-in map, drop the JSON in `maps/` and list it in `index.json`.

## Conventions

- **JSDoc over TypeScript.** Every file starts with `// @ts-check`. Types live in `src/types.js` as `@typedef`s; other files import them via `@typedef {import('./types.js').Foo} Foo`. Editors get the same safety as TS without a build step.
- **No build step.** Don't introduce one. No bundler, no transpiler, no `npm`.
- **DOM builders, not templates.** Use the helpers in `src/html.js` (`div(attrs, children)`, etc.) rather than `innerHTML` strings. `on<Event>` attrs auto-bind listeners; children are text-node-escaped.
- **Campaign entity IDs are stable.** Tower/monster `id`s are referenced from `waves.list[].monsters` and `waves.list[].towers`. `ensureCampaignIds` backfills missing ones from `campaign.nextId`. When deleting or renaming, check wave references.
- **Ground type constants are append-only.** `GROUND_GRASS`, `GROUND_ROAD`, … are integer ids stored in saved map data. Never renumber — only append new types to the end of `GROUND_TYPES`.
- **Renderer fairness.** Any change to what the game displays usually needs to land in both `render-canvas.js` and `render-webgl.js`. If a feature only makes sense in one, note it.
