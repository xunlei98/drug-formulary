import { h, icon, pct, fmt } from './dom.js';
import { state } from './store.js';

export function statusPill(q) {
  const label = { ok: 'Slots left', near: 'Near full', full: 'Full', over: `Over +${q.over}`, none: 'No quota set' }[q.status];
  return h('span', { class: `pill s-${q.status}` }, icon(q.status === 'ok' ? 'check' : q.status === 'none' ? 'flag' : 'alert'), label);
}

export function quotaBar(q) {
  const p = q.quota ? (q.used / q.quota) * 100 : 0;
  return pct(h('div', { class: `bar s-${q.status}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': q.quota || 0, 'aria-valuenow': q.used, 'aria-label': 'Quota used' }), p);
}

export function stat(label, value, extra) {
  return h('div', null, h('p', { class: 'label' }, label), h('p', { class: 'hero' }, value, extra));
}

export function tile(label, value) {
  return h('div', { class: 'tile' }, h('p', { class: 'label' }, label), h('div', { class: 'num' }, value));
}

export function chips(options, current, onPick) {
  const wrap = h('div', { class: 'chips', role: 'group' });
  const paint = (cur) => {
    for (const b of wrap.children) b.setAttribute('aria-pressed', b.dataset.v === cur ? 'true' : 'false');
  };
  for (const [v, label] of options) {
    wrap.append(h('button', { class: 'chip', type: 'button', 'data-v': v, onClick: () => { paint(v); onPick(v); } }, label));
  }
  paint(current);
  return wrap;
}

export function segmented(options, current, onPick) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const paint = (cur) => { for (const b of wrap.children) b.setAttribute('aria-pressed', b.dataset.v === cur ? 'true' : 'false'); };
  for (const [v, label] of options) wrap.append(h('button', { type: 'button', 'data-v': v, onClick: () => { paint(v); onPick(v); } }, label));
  paint(current);
  return wrap;
}

export function tape(movements) {
  const recent = movements.filter((m) => !m.pending).slice(0, 24).reverse();
  const max = Math.max(1, ...recent.map((m) => m.qty));
  const t = h('div', { class: 'tape', role: 'img', 'aria-label': `Last ${recent.length} movements` });
  for (const m of recent) {
    const i = h('i', { class: m.type === 'issue' ? 'out' : '', title: `${m.type} ${m.qty}` });
    i.style.setProperty('--h', `${Math.max(8, (m.qty / max) * 100)}%`);
    t.append(i);
  }
  return t;
}

export function locName(id) {
  return state.locMap.get(id)?.name || id || '-';
}

let toastEl = null;
export function toast(text, bad = false) {
  toastEl?.remove();
  toastEl = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, text);
  document.body.append(toastEl);
  setTimeout(() => toastEl?.remove(), 3500);
}

export function moveLine(m) {
  const a = m.from ? locName(m.from) : null;
  const b = m.to ? locName(m.to) : null;
  const where = a && b ? `${a} to ${b}` : a ? `from ${a}` : `to ${b}`;
  const sign = m.type === 'issue' ? '-' : m.type === 'receive' ? '+' : m.type === 'stocktake' ? '=' : '';
  return { where, sign, label: m.type[0].toUpperCase() + m.type.slice(1), when: m.server_time ? fmt.dateTime(m.server_time) : '' };
}

export const LABEL = { receive: 'Receive', transfer: 'Transfer', issue: 'Issue', adjust: 'Adjust', stocktake: 'Stocktake' };
