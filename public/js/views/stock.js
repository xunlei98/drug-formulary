import { h, icon, clear, fmt } from '../dom.js';
import { state, can_, balances, locationOptions } from '../store.js';
import { stat, chips } from '../ui.js';

export function stock() {
  let loc = 'all';
  let q = '';
  const hero = h('div');
  const list = h('ul', { class: 'list' });
  const input = h('input', { type: 'search', placeholder: 'Filter by drug', 'aria-label': 'Filter by drug' });
  const chipHost = h('div');

  const lines = () => {
    const rows = [];
    for (const [k, qty] of balances()) {
      if (!qty) continue;
      const [drug, location] = k.split('|');
      const d = state.drugMap.get(drug);
      if (!d || (loc !== 'all' && location !== loc)) continue;
      if (q && !`${d.perihal} ${d.no_kod}`.toLowerCase().includes(q.toLowerCase())) continue;
      rows.push({ d, location, qty });
    }
    return rows.sort((a, b) => a.d.perihal.localeCompare(b.d.perihal));
  };

  const paint = () => {
    const rows = lines();
    clear(hero, stat('Stock balance', fmt.n(rows.reduce((s, r) => s + r.qty, 0)), h('small', null, ` units on ${rows.length} lines`)));
    clear(list, rows.length ? rows.slice(0, 200).map((r) => h('li', null, h('a', { class: 'item', href: `#/drug/${encodeURIComponent(r.d.no_kod)}` },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, r.d.perihal), h('div', { class: 'meta' }, state.locMap.get(r.location)?.name || r.location)),
      h('span', { class: 'qty mono' }, fmt.n(r.qty)), icon('chevron'))))
      : h('li', { class: 'empty' }, 'No stock recorded here yet.'));
  };
  const paintChips = () => {
    const present = new Set([...balances().keys()].map((k) => k.split('|')[1]));
    const opts = locationOptions().filter((l) => present.has(l.id));
    clear(chipHost, chips([['all', 'All locations'], ...opts.map((l) => [l.id, l.name])], loc, (v) => { loc = v; paint(); }));
  };
  input.addEventListener('input', () => { q = input.value; paint(); });
  const el = h('div', null, hero, h('div', { class: 'section' }), chipHost,
    h('div', { class: 'search' }, icon('search'), input),
    h('div', { class: 'card section' }, list),
    can_('stock.log') && h('p', null, h('a', { class: 'btn', href: '#/log' }, icon('plus'), 'Log movement')));
  paint(); paintChips();
  return { el, title: 'Stock', update: () => { paint(); } };
}
