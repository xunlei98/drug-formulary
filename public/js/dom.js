const SVG = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function clear(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  stock: 'M21 8l-9-5-9 5v8l9 5 9-5zM3.3 7.7L12 12.5l8.7-4.8M12 22V12.5',
  plus: 'M12 5v14M5 12h14',
  gauge: 'M12 14l4-4M3.3 17a9 9 0 1 1 17.4 0',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  offline: 'M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.4-1.8M1.4 9a15 15 0 0 1 4.2-2.6M22.6 9A15 15 0 0 0 12 5M12 20h.01',
  sync: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  flag: 'M4 22V4M4 4h12l-2 4 2 4H4',
  x: 'M18 6L6 18M6 6l12 12',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', PATHS[name]);
  svg.append(p);
  return svg;
}

export const fmt = {
  n: (v) => (v == null || v === '' ? '-' : Number(v).toLocaleString('en-MY')),
  money: (v) => (v == null ? '-' : `RM ${Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
  date: (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-'),
  time: (iso) => new Date(iso).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }),
  dateTime: (iso) => new Date(iso).toLocaleString('en-MY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
};

export function pct(el, v) {
  el.style.setProperty('--pct', `${Math.max(0, Math.min(100, v))}%`);
  return el;
}

export function uuid() {
  return crypto.randomUUID();
}
