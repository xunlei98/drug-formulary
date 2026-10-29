import { h, icon, clear, fmt } from '../dom.js';
import { state, can_, parLines, locationOptions } from '../store.js';
import { tile, chips } from '../ui.js';
import { STATUS_LABEL, LIST_LABEL } from '/shared/par.js';

const PILL = { ok: 's-ok', low: 's-over', uncounted: 's-none', nopar: 's-none' };
export const parPill = (status) => status && h('span', { class: `pill ${PILL[status]}` }, status === 'low' && icon('alert'), STATUS_LABEL[status]);
export const parMeta = (r) => r.lists.map((x) => `${LIST_LABEL[x.list]} ${x.qty}${x.unit ? ` ${x.unit}` : ''}`).join(' · ');

export function stock() {
  const all = parLines();
  const withLines = new Set(all.map((r) => r.location));
  const opts = locationOptions().filter((l) => withLines.has(l.id));
  const own = state.user?.location_id;
  let loc = own && withLines.has(own) ? own : 'all';
  let show = 'all';
  let q = '';
  const hero = h('div');
  const list = h('ul', { class: 'list' });
  const input = h('input', { type: 'search', placeholder: 'Filter by drug', 'aria-label': 'Filter by drug' });

  const lines = () => parLines(loc === 'all' ? {} : { location: loc })
    .filter((r) => loc !== 'all' || r.qty !== undefined)
    .filter((r) => show === 'all' || r.status === show)
    .map((r) => ({ ...r, d: state.drugMap.get(r.drug) }))
    .filter((r) => r.d && (!q || `${r.d.perihal} ${r.d.no_kod}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.d.perihal.localeCompare(b.d.perihal));

  const paint = () => {
    const rows = lines();
    const scope = parLines(loc === 'all' ? {} : { location: loc });
    const count = (s) => scope.filter((r) => r.status === s).length;
    clear(hero, h('h2', null, loc === 'all' ? 'All locations' : state.locMap.get(loc)?.name || loc),
      h('div', { class: 'tiles' }, tile('Shown', fmt.n(rows.length)), tile('Low', fmt.n(count('low'))), tile('Not counted', fmt.n(count('uncounted')))));
    clear(list, rows.length ? rows.slice(0, 300).map((r) => h('li', null, h('a', { class: 'item', href: `#/drug/${encodeURIComponent(r.drug)}` },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, r.d.perihal),
        h('div', { class: 'meta' }, loc === 'all' ? state.locMap.get(r.location)?.name || r.location : parMeta(r) || 'No par level')),
      h('div', { class: 'par' }, h('span', { class: 'qty mono' }, r.qty === undefined ? '–' : fmt.n(r.qty)), r.par ? h('span', { class: 'meta mono' }, `/ ${fmt.n(r.par)}`) : null),
      parPill(r.status), icon('chevron'))))
      : h('li', { class: 'empty' }, loc === 'all' ? 'No stock recorded yet. Pick a ward to see its par levels.' : 'Nothing matches.'));
  };
  input.addEventListener('input', () => { q = input.value; paint(); });
  const el = h('div', null, hero, h('div', { class: 'section' }),
    chips([['all', 'All locations'], ...opts.map((l) => [l.id, l.name])], loc, (v) => { loc = v; paint(); }),
    chips([['all', 'Any status'], ['low', 'Low'], ['uncounted', 'Not counted'], ['ok', 'OK']], show, (v) => { show = v; paint(); }),
    h('div', { class: 'search' }, icon('search'), input),
    h('p', { class: 'sub' }, 'Par = approved floor-stock maximum from the 2026 lists. Balances come only from logged movements and counts.'),
    h('div', { class: 'card section' }, list),
    can_('stock.log') && h('p', null, h('a', { class: 'btn', href: '#/log' }, icon('plus'), 'Log movement')));
  paint();
  return { el, title: 'Stock', update: () => { paint(); } };
}
