// @ts-check

// Small DOM-builder helpers: build element trees via nested function calls
// instead of concatenating HTML strings. Text children are escaped via
// createTextNode; attribute values are escaped by setAttribute; callers
// don't need to esc() anything they pass in.
//
// Attrs keys:
//   className       -> el.className
//   textContent     -> el.textContent
//   style (object)  -> Object.assign(el.style, v)
//   checked/disabled/readOnly/selected/required -> boolean property
//   on<Event>       -> el.addEventListener('<event>', fn)   e.g. onClick, onChange
//   anything else   -> el.setAttribute(k, String(v))
// Values that are null/undefined/false are skipped, so conditional attrs are easy:
//   input({ checked: isOn, selected: idx === current })

const BOOLEAN_ATTRS = new Set(['checked', 'disabled', 'readOnly', 'selected', 'required']);

export function element(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'className')            el.className = v;
    else if (k === 'textContent')     el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (BOOLEAN_ATTRS.has(k))    el[k] = !!v;
    else if (k.length > 2 && k.startsWith('on') && k[2] === k[2].toUpperCase()) {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
  return el;
}

const tag = (name) => (attrs, children) => element(name, attrs, children);

export const div       = tag('div');
export const span      = tag('span');
export const button    = tag('button');
export const h1        = tag('h1');
export const h2        = tag('h2');
export const label     = tag('label');
export const input     = tag('input');
export const select    = tag('select');
export const option    = tag('option');
export const fieldset  = tag('fieldset');
export const legend    = tag('legend');
export const a         = tag('a');
export const textarea  = tag('textarea');
