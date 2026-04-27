// @ts-check

// Screen transitions:
//   - 'crossfade' — outgoing snapshot fades + scales down + blurs while the
//     incoming screen scales up and fades in. Used for navigation between
//     menu / list / settings / editor screens.
//   - 'band' — ornamental gold-band wipe sweeps in from top + bottom with a
//     glowing seam flash and a central rotating glyph; the actual screen swap
//     happens at the band's mid-point so the player never sees a jump cut.
//     Used when entering or leaving the in-game board.
//
// Reduced motion: respected via CSS — animations collapse to zero duration so
// the swap still happens but without the visual flourish.

const SCREEN_IDS = ['home', 'screen-list', 'screen-settings', 'editor-ui', 'edit-campaign'];

// Tunable timings (must match keyframes in styles.css).
const EXIT_MS  = 360;
const ENTER_MS = 460;
const BAND_MS  = 800;
const BAND_SWAP_MS = 400;       // mid-band, when content is fully covered

export function createTransitions() {
  /** @type {?HTMLElement} */
  let bandEl = null;

  function ensureBand() {
    if (bandEl) return bandEl;
    const div = document.createElement('div');
    div.className = 'tx-band';
    div.innerHTML = [
      '<div class="tx-band-top"></div>',
      '<div class="tx-band-bot"></div>',
      '<div class="tx-band-seam"></div>',
      '<svg class="tx-band-glyph" viewBox="0 0 64 64" aria-hidden="true">',
      '  <g fill="none" stroke="currentColor" stroke-width="1.5">',
      '    <circle cx="32" cy="32" r="22"/>',
      '    <circle cx="32" cy="32" r="14" stroke-dasharray="2 4"/>',
      '    <path d="M32 6 L36 24 L54 28 L40 38 L44 56 L32 46 L20 56 L24 38 L10 28 L28 24 Z" fill="currentColor" fill-opacity="0.3"/>',
      '  </g>',
      '</svg>',
    ].join('');
    document.body.appendChild(div);
    bandEl = div;
    return div;
  }

  /**
   * Find the element currently filling the screen so we can clone it for
   * the exit animation. We look at the named DOM screens; if none of those
   * are visible we assume the canvas play HUD is up — caller should switch
   * to band kind in that case.
   * @returns {?HTMLElement}
   */
  function findVisibleScreen() {
    for (const id of SCREEN_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display !== 'none' && el.offsetWidth > 0) return el;
    }
    return null;
  }

  /**
   * Snapshot the visible screen as a fixed-position overlay clone. The clone
   * removes the original's id so duplicate-id collisions are avoided while it
   * lives. Internal layout still works because we copy the original's content
   * verbatim and the clone's own .tx-clone class lays it out as a stage.
   * @param {HTMLElement} src
   * @returns {HTMLElement}
   */
  function snapshot(src) {
    const clone = /** @type {HTMLElement} */ (src.cloneNode(true));
    clone.removeAttribute('id');
    clone.classList.add('tx-clone');
    document.body.appendChild(clone);
    return clone;
  }

  /**
   * Run a single transition.
   *
   * @param {{ kind: 'crossfade' | 'band', doSwap: () => void }} opts
   * @returns {Promise<void>} Resolves once the transition is fully done.
   */
  function runTransition(opts) {
    if (opts.kind === 'band') {
      return runBand(opts.doSwap);
    }
    return runCrossfade(opts.doSwap);
  }

  function runCrossfade(doSwap) {
    return new Promise((resolve) => {
      const old = findVisibleScreen();
      let clone = null;
      if (old) clone = snapshot(old);
      doSwap();
      const incoming = findVisibleScreen();
      if (incoming) {
        incoming.classList.add('tx-enter');
        setTimeout(() => incoming.classList.remove('tx-enter'), ENTER_MS + 20);
      }
      if (clone) {
        // Force a frame so the clone paints before its exit animation starts.
        requestAnimationFrame(() => clone.classList.add('tx-exit'));
        setTimeout(() => { clone.remove(); resolve(); }, EXIT_MS + 20);
      } else {
        resolve();
      }
    });
  }

  function runBand(doSwap) {
    return new Promise((resolve) => {
      const band = ensureBand();
      // Restart animation if the band class is already active.
      band.classList.remove('is-active');
      // Reflow so the next class addition re-triggers the keyframes.
      void band.offsetWidth;
      band.classList.add('is-active');
      setTimeout(doSwap, BAND_SWAP_MS);
      setTimeout(() => {
        band.classList.remove('is-active');
        resolve();
      }, BAND_MS + 20);
    });
  }

  return { runTransition };
}
