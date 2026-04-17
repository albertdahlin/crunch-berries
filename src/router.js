// @ts-check

/**
 * @typedef {Object} Route
 * @property {string} pattern
 * @property {(params: Record<string,string>) => void} handler
 */

/**
 * Tiny hash-fragment router. Matches `location.hash` against an ordered list
 * of patterns (first match wins). Patterns like `/foo/:bar` produce a params
 * object `{ bar: <segment> }`. Unknown paths redirect to `/`.
 *
 * @param {Route[]} routes
 */
export function createRouter(routes) {
  function parseHash() {
    let h = (location.hash || '').replace(/^#/, '');
    if (h.startsWith('/')) h = h.slice(1);
    if (h.endsWith('/')) h = h.slice(0, -1);
    const parts = h ? h.split('/') : [];
    for (const r of routes) {
      let p = r.pattern.replace(/^\//, '');
      if (p.endsWith('/')) p = p.slice(0, -1);
      const pparts = p ? p.split('/') : [];
      if (pparts.length !== parts.length) continue;
      /** @type {Record<string,string>} */
      const params = {};
      let ok = true;
      for (let i = 0; i < pparts.length; i++) {
        if (pparts[i].startsWith(':')) {
          params[pparts[i].slice(1)] = parts[i];
        } else if (pparts[i] !== parts[i]) {
          ok = false; break;
        }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }

  function dispatch() {
    const match = parseHash();
    if (match) match.handler(match.params);
    else navigate('/', { replace: true });
  }

  /** @param {string} path @param {{replace?: boolean}} [opts] */
  function navigate(path, opts) {
    const hash = '#' + path;
    if (opts && opts.replace) {
      history.replaceState(null, '', hash);
      dispatch();
      return;
    }
    if (location.hash === hash) {
      dispatch();
      return;
    }
    location.hash = hash;
  }

  window.addEventListener('hashchange', dispatch);

  function start() {
    // Normalize an empty fragment to '#/' so the initial history entry has a
    // canonical path; back from '#/foo' lands on '#/' instead of the pre-hash
    // URL (which would leave our router idle).
    if (!location.hash || location.hash === '#') {
      history.replaceState(null, '', '#/');
    }
    dispatch();
  }

  return { navigate, dispatch, start };
}
