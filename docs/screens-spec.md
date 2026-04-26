# Screens spec — Tower Defence

A starting-point inventory of every screen in the app, intended as input for a redesign pass. Each entry lists the route, what the user is trying to do there, the primary actions, and the key UI elements currently on the screen. Routes are hash fragments handled by `src/router.js`; the screen manager in `src/home.js` drives the lifecycle.

The whole app is **mobile-first** (sticky top HUD, sticky bottom action bar, touch-first input). It is a **pure static site** with no backend — everything persists in `localStorage`.

---

## 1. Home / main menu

- **Route:** `/`
- **Purpose:** Entry point. The user picks what they want to do (play, resume, edit content, change app settings).
- **Primary actions:** New Game, Load Game, Map Editor, Campaign Editor, Settings.
- **UI elements:**
  - Title (`TOWER DEFENCE`).
  - Vertical list of 5 menu cards, each with a title + one-line description.
  - Build version label (`v…`) at the bottom.
- **Design notes:** This is the first impression. Currently very utilitarian / monospace. No artwork, no campaign hero shot, no “Continue last game” shortcut.

## 2. Settings (app)

- **Route:** `/settings`
- **Purpose:** App-level preferences — distinct from per-campaign rules.
- **Primary actions:** Pick renderer (Canvas / WebGL), clear all local data.
- **UI elements:**
  - Header with `← Back` and title.
  - Renderer radio group with hint text per option.
  - Destructive action: “Clear all local data” (with confirm).
- **Design notes:** Sparse today — natural place for future audio/controls/accessibility settings.

---

## Pre-game flow

## 3. New Game — Pick Campaign

- **Route:** `/new-game`
- **Purpose:** Choose which ruleset (towers, monsters, waves) to play.
- **UI elements:** Header with back button, list of campaigns. Each row shows name, `[built-in]` tag where applicable, and a stat line (`N towers · M monsters`).
- **Design notes:** Currently text-only. A campaign card with theme art / difficulty / flavour text would help here.

## 4. New Game — Pick Map

- **Route:** `/new-game/:campaignId`
- **Purpose:** Pick a map for the chosen campaign.
- **UI elements:** Header, list of maps, each row showing name, dimensions (`16x24`), and built-in tag.
- **Design notes:** No thumbnail / preview today. A small grid preview per map would dramatically improve scanability.

## 5. Load Game

- **Route:** `/load-game`
- **Purpose:** Resume an in-progress save (saved from the in-game HUD).
- **UI elements:**
  - Header.
  - Either an empty state (“No saved games yet…”) or a list of saves.
  - Each save row: title (`<map name> — W<wave>`), saved-at timestamp, delete (`×`) button.
- **Limit:** Up to 20 saves, most-recent first.

---

## Map editor

## 6. Map list

- **Route:** `/maps`
- **Purpose:** Browse, create, edit, or clone maps.
- **UI elements:**
  - Header.
  - “+ New Map” row (highlighted).
  - List of maps. Built-in maps show a clone (`⧉`) button and a “Tap to clone” hint; user maps show edit (`✎`) and “Tap to edit”.
- **Design notes:** Same lack of preview as the play map picker — same opportunity.

## 7. Map editor (canvas)

- **Routes:** `/maps/new`, `/maps/:mapId` (built-ins auto-clone before edit)
- **Purpose:** Paint a tile grid. Top and bottom rows are forced to road (spawn / exit lanes).
- **UI elements:**
  - Canvas (the grid).
  - Editor toolbar (sticky bottom):
    - Row 1: name input, width and height inputs.
    - Row 2: brush palette (one per ground type) and brush-size toggle (`1×1` / `3×3` etc.).
    - Row 3: per-brush help line.
    - Row 4: Play, Save, Clear, Delete (user maps only), Export, Import, Back.
- **Design notes:** Lots of buttons in a flat row — could benefit from a clearer split between “tools”, “file”, and “navigation”. The brush palette is the primary tool; everything else is secondary.

---

## Campaign editor

## 8. Campaign list

- **Route:** `/campaigns`
- **Purpose:** Browse, create, edit, clone, or delete campaigns.
- **UI elements:** Same list pattern as maps. Built-ins offer Clone, user campaigns offer Delete.
- **Design notes:** Built-in campaigns are read-only — opening one immediately clones into a user campaign. Worth surfacing this transition more clearly.

## 9. Campaign editor — list view

- **Route:** `/campaigns/:campaignId`
- **Purpose:** Top-level view of a campaign’s sections. The user picks what to drill into.
- **UI elements (single full-screen view, scrollable):**
  - Header: Back, Save, campaign-name input.
  - **Towers** section — list of towers (color swatch + letter + name), `+ Add Tower` button.
  - **Monsters** section — same pattern, `+ Add Monster`.
  - **Waves** section — list of wave summaries (e.g. `Wave 3: 12 Goblins, 4 Trolls`), `+ Add Wave`.
  - Inline form: scaling rules (`scaleEvery`, `hpScale`, spawn intervals).
  - Inline form: game rules (start gold/lives, wave bonus, sell refund %).
  - Footer actions: Reset to Classic, Export, Import.
- **Design notes:** This screen does a lot. A high-priority redesign target — towers/monsters/waves all live in one long page next to game rules and meta-actions. Could become a tabbed layout.

## 10. Campaign editor — detail view

- **Same route as #9**, internal `detail` mode for a single tower / monster / wave.
- **Purpose:** Edit one entity in depth.
- **UI elements:**
  - Header: Back, title (e.g. “Tower: Cannon”), Delete.
  - **Tower detail:** breadcrumb of upgrade tree (root › upgrade › upgrade), editable form (name, letter, color, stats: damage, fire rate, range, splash, pierce, DOT, slow, gold steal, etc.), child upgrades list with add/remove.
  - **Monster detail:** form for HP, speed, reward, color, letter, damage modifiers per damage type.
  - **Wave detail:** roster editor — counts per monster id; optional tower unlock list.
- **Design notes:** The tower upgrade tree is the most complex sub-flow in the whole app. Currently just a breadcrumb + child list — a visual tree would help a lot.

---

## Gameplay

## 11. Play / Resume (in-game)

- **Routes:** `/play/:campaignId/:mapId`, `/resume/:saveId`
- **Purpose:** The actual game. Same UI for new-game and resume.
- **Phases (drive the HUD’s appearance):**
  - `PLACE` — green phase indicator. The user spends gold, places and upgrades towers, then taps `Wave`.
  - `WAVE` — orange phase indicator. Monsters spawn until the roster is exhausted and all are dead, then auto-returns to `PLACE`.
  - `GAMEOVER` — red phase. The game-over overlay is shown.
- **UI elements:**
  - **Top HUD (sticky):** Gold, Lives, Wave, Score, version, phase label.
  - **Canvas:** the map, towers, monsters, projectiles. Renderer is either 2D canvas or isometric WebGL.
  - **Bottom action bar (sticky):** changes contextually:
    - **No tower selected (placing):** tower-info panel (description + stat summary), tower-type buttons (one per unlocked tower, with cost), Place, Wave, Bestiary, Speed (`1×` / `5×`), Save, Home.
    - **A placed tower selected:** tower-info panel, upgrade buttons (one per available upgrade), Rotate (when applicable), Sell (with refund amount). Most other buttons hidden.
- **Design notes:** Bottom bar is dense and reflows depending on state. The contextual mode-switch (placing vs. inspecting a tower) is the most important UX clarity issue.

## 12. Bestiary overlay (in-game modal)

- **Trigger:** Bestiary button in the action bar (or `B` key).
- **Purpose:** Preview the monsters that have appeared (or will appear next wave) with their current scaled HP, speed, reward, and damage modifiers.
- **UI elements:** Modal box, list of monsters, each row expandable to show stats. Close button.
- **Design notes:** Information dense but mobile-friendly today. Could integrate “next wave” info more prominently.

## 13. Game-over overlay

- **Trigger:** `phase === 'GAMEOVER'`.
- **Purpose:** Show final score, prompt to leave.
- **UI elements:** Title `GAME OVER`, score line, hint (“Tap Home to quit”).
- **Design notes:** Currently passive — no `Restart` or `New Map` shortcut on the overlay itself.

## 14. Lore / notification message overlay

- **Trigger:** Game-state-driven (e.g. story beats, unlocks).
- **Purpose:** Show a non-blocking message centered on the canvas.
- **UI elements:** Centered text box on a dark backdrop. `pointer-events: none` — purely informational.
- **Design notes:** Used both by the canvas renderer and WebGL. Currently very minimal styling.

## 15. Help tooltip overlay (campaign editor)

- **Trigger:** `?` glyph next to a config field.
- **Purpose:** Quick explanation of what a setting does.
- **UI elements:** Centered modal with a single paragraph.
- **Design notes:** Functional but unstyled — easy to upgrade into proper inline help.

---

## Quick map of routes → screens

| Route                                  | Screen                              |
| -------------------------------------- | ----------------------------------- |
| `/`                                    | Home                                |
| `/settings`                            | App settings                        |
| `/new-game`                            | Pick campaign                       |
| `/new-game/:campaignId`                | Pick map                            |
| `/load-game`                           | Saved games list                    |
| `/maps`                                | Map list                            |
| `/maps/new`, `/maps/:mapId`            | Map editor                          |
| `/campaigns`                           | Campaign list                       |
| `/campaigns/:campaignId`               | Campaign editor (list + detail)     |
| `/play/:campaignId/:mapId`             | In-game (new game)                  |
| `/resume/:saveId`                      | In-game (resume save)               |

Overlays (no own route): Bestiary, Game over, In-game message, Help tooltip.
