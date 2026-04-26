// @ts-check

// Tiny SVG icon set — 16x16 viewBox, currentColor stroke/fill.
// Adapted from the Ashenhold design's icons.jsx into vanilla DOM.
//
// Usage:
//   import { icon } from './icons.js';
//   element.appendChild(icon('flame'));
//   element.appendChild(icon('flame', { size: 14 }));
//
// Returns an <svg> element. Color is inherited from the parent via currentColor.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @typedef {{ stroke?: string, fill?: string, paths?: string[], filled?: string[], strokeRects?: number[][], filledRects?: number[][], strokeCircles?: number[][], filledCircles?: number[][] }} IconDef */

/** @type {Record<string, IconDef>} */
const ICONS = {
  heart: {
    paths: ['M8 13.5 C 3.5 10.5, 2 8.5, 2 6 C 2 4, 3.5 3, 5 3 C 6.5 3, 7.5 4, 8 5 C 8.5 4, 9.5 3, 11 3 C 12.5 3, 14 4, 14 6 C 14 8.5, 12.5 10.5, 8 13.5 Z'],
  },
  coin: {
    strokeCircles: [[8, 8, 5.5]],
    paths: ['M8 4.5 V 11.5 M 6 6.5 L 10 9.5 M 10 6.5 L 6 9.5'],
  },
  shield: {
    paths: [
      'M8 1.8 L 13.5 4 V 8 C 13.5 11, 11 13.5, 8 14.5 C 5 13.5, 2.5 11, 2.5 8 V 4 Z',
      'M8 5 V 10 M 5.5 7.5 H 10.5',
    ],
  },
  skull: {
    paths: [
      'M8 1.5 C 4 1.5, 2 4, 2 7 C 2 9, 3 10.5, 4.5 11 V 13.5 H 11.5 V 11 C 13 10.5, 14 9, 14 7 C 14 4, 12 1.5, 8 1.5 Z',
      'M7 11 V 13.5 M 8 11 V 13.5 M 9 11 V 13.5',
    ],
    filledCircles: [[6, 7.5, 1.2], [10, 7.5, 1.2]],
  },
  tower: {
    paths: [
      'M4 14 H 12 V 6 H 4 Z',
      'M3 6 L 3 4 H 5 V 6 M 11 6 V 4 H 13 V 6',
      'M6 14 V 10 H 10 V 14',
      'M7 6 V 8 H 9 V 6',
    ],
  },
  bolt: {
    paths: ['M9 1.5 L 3.5 9 H 7 L 6 14.5 L 12 7 H 8.5 L 10 1.5 Z'],
  },
  spark: {
    paths: ['M8 2 L 9 7 L 14 8 L 9 9 L 8 14 L 7 9 L 2 8 L 7 7 Z'],
  },
  flame: {
    paths: ['M8 1.5 C 9 4, 12 5, 12 9 C 12 12, 10 14, 8 14 C 6 14, 4 12, 4 9 C 4 7, 5 6, 6 5.5 C 6 7, 7 8, 8 7.5 C 7.5 5, 8 3, 8 1.5 Z'],
  },
  moon: {
    paths: ['M12.5 9.5 A 5.5 5.5 0 1 1 7 2.5 A 4 4 0 0 0 12.5 9.5 Z'],
  },
  hourglass: {
    paths: [
      'M4 2 H 12 M 4 14 H 12',
      'M4 2 V 4 L 8 8 L 4 12 V 14',
      'M12 2 V 4 L 8 8 L 12 12 V 14',
    ],
  },
  eye: {
    paths: [
      'M1.5 8 C 3.5 4, 6 3, 8 3 C 10 3, 12.5 4, 14.5 8 C 12.5 12, 10 13, 8 13 C 6 13, 3.5 12, 1.5 8 Z',
    ],
    strokeCircles: [[8, 8, 2]],
    filledCircles: [[8, 8, 0.8]],
  },
  gear: {
    paths: ['M8 1.5 V 3.5 M 8 12.5 V 14.5 M 1.5 8 H 3.5 M 12.5 8 H 14.5 M 3 3 L 4.5 4.5 M 11.5 11.5 L 13 13 M 3 13 L 4.5 11.5 M 11.5 4.5 L 13 3'],
    strokeCircles: [[8, 8, 2.5]],
  },
  play: {
    filled: ['M4 2.5 L 13 8 L 4 13.5 Z'],
  },
  pause: {
    filledRects: [[4, 3, 2.5, 10], [9.5, 3, 2.5, 10]],
  },
  fast: {
    filled: ['M1 3 L 8 8 L 1 13 Z', 'M8 3 L 15 8 L 8 13 Z'],
  },
  star: {
    filled: ['M8 1.5 L 10 6 L 14.5 6.5 L 11 9.8 L 12 14.5 L 8 12 L 4 14.5 L 5 9.8 L 1.5 6.5 L 6 6 Z'],
  },
  starHollow: {
    paths: ['M8 1.5 L 10 6 L 14.5 6.5 L 11 9.8 L 12 14.5 L 8 12 L 4 14.5 L 5 9.8 L 1.5 6.5 L 6 6 Z'],
  },
  arrowRight: {
    paths: ['M3 8 H 13 M 9 4 L 13 8 L 9 12'],
  },
  arrowLeft: {
    paths: ['M13 8 H 3 M 7 4 L 3 8 L 7 12'],
  },
  plus: {
    paths: ['M8 3 V 13 M 3 8 H 13'],
  },
  brush: {
    paths: ['M12 2 L 14 4 L 7 11 L 5 9 Z', 'M5 9 L 2 14 L 7 11'],
  },
  grid: {
    strokeRects: [[2, 2, 4, 4], [10, 2, 4, 4], [2, 10, 4, 4], [10, 10, 4, 4]],
  },
  lock: {
    strokeRects: [[3, 7, 10, 7]],
    paths: ['M5 7 V 5 Q 5 2, 8 2 Q 11 2, 11 5 V 7'],
    filledCircles: [[8, 10.5, 1]],
  },
  check: {
    paths: ['M3 8.5 L 7 12 L 13 4'],
  },
  x: {
    paths: ['M4 4 L 12 12 M 12 4 L 4 12'],
  },
  scroll: {
    paths: ['M3 3 H 12 Q 13 3, 13 4 V 12 Q 13 13, 12 13 H 4 Q 3 13, 3 12 V 4 M 6 6 H 10 M 6 8.5 H 10 M 6 11 H 8'],
  },
  crown: {
    paths: ['M2 12 H 14 M 2 12 L 3 5 L 6 8 L 8 3 L 10 8 L 13 5 L 14 12'],
    filledCircles: [[3, 5, 0.8], [13, 5, 0.8], [8, 3, 0.8]],
  },
  sword: {
    paths: ['M13 2 L 13 6 L 6 13 L 3 13 V 10 L 10 3 Z', 'M3 13 L 1.5 14.5'],
  },
  diamond: {
    paths: ['M8 1.5 L 14 8 L 8 14.5 L 2 8 Z M 5 8 L 8 4 L 11 8 M 5 8 L 8 12 L 11 8'],
  },
  branch: {
    strokeCircles: [[3, 8, 1.8], [13, 4, 1.8], [13, 12, 1.8]],
    paths: ['M4.5 7 L 11.5 4.5 M 4.5 9 L 11.5 11.5'],
  },
  runeCircle: {
    strokeCircles: [[8, 8, 6], [8, 8, 2]],
    paths: ['M8 2 V 14 M 2 8 H 14 M 4 4 L 12 12 M 12 4 L 4 12'],
  },
  home: {
    paths: ['M2 8 L 8 2 L 14 8 M 4 7 V 14 H 12 V 7 M 7 14 V 10 H 9 V 14'],
  },
  save: {
    paths: ['M3 3 H 11 L 13 5 V 13 H 3 Z M 5 3 V 7 H 10 V 3 M 5 10 H 11'],
  },
  trash: {
    paths: ['M3 4 H 13 M 5 4 V 2 H 11 V 4 M 4 4 L 5 14 H 11 L 12 4 M 7 7 V 11 M 9 7 V 11'],
  },
};

const STROKE_ATTRS = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.4',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

/**
 * @param {string} name
 * @param {{ size?: number }} [opts]
 */
export function icon(name, opts = {}) {
  const def = ICONS[name];
  const size = opts.size ?? 14;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'inline-block';
  svg.style.verticalAlign = 'middle';
  svg.style.flexShrink = '0';
  if (!def) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '8'); c.setAttribute('cy', '8'); c.setAttribute('r', '5');
    setAttrs(c, STROKE_ATTRS);
    svg.appendChild(c);
    return svg;
  }
  for (const d of def.paths || [])  svg.appendChild(strokePath(d));
  for (const d of def.filled || []) svg.appendChild(fillPath(d));
  for (const r of def.strokeRects || []) svg.appendChild(strokeRect(r));
  for (const r of def.filledRects || []) svg.appendChild(fillRect(r));
  for (const c of def.strokeCircles || []) svg.appendChild(strokeCircle(c));
  for (const c of def.filledCircles || []) svg.appendChild(fillCircle(c));
  return svg;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}
function strokePath(d) {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d); setAttrs(p, STROKE_ATTRS);
  return p;
}
function fillPath(d) {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d); p.setAttribute('fill', 'currentColor');
  return p;
}
function strokeRect([x, y, w, h]) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
  r.setAttribute('width', String(w)); r.setAttribute('height', String(h));
  setAttrs(r, STROKE_ATTRS);
  return r;
}
function fillRect([x, y, w, h]) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
  r.setAttribute('width', String(w)); r.setAttribute('height', String(h));
  r.setAttribute('fill', 'currentColor');
  return r;
}
function strokeCircle([cx, cy, r]) {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(cy)); c.setAttribute('r', String(r));
  setAttrs(c, STROKE_ATTRS);
  return c;
}
function fillCircle([cx, cy, r]) {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(cy)); c.setAttribute('r', String(r));
  c.setAttribute('fill', 'currentColor');
  return c;
}
