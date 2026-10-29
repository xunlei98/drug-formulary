import { h, icon, clear, fmt } from '../dom.js';
import { state, allQuotas } from '../store.js';
import { stat, tile, chips, statusPill, quotaBar } from '../ui.js';

export function quota() {
  let filter = 'all';
  let q = '';
  const tiles = h('div', { class: 'tiles' });
  const hero = h('div');
  const list = h('ul', { class: 'list' });
  const input = h('input', { type: 'search', placeholder: 'Filter Ubat Mahal drugs', 'aria-label': 'Filter Ubat Mahal drugs' });

  const paint = () => {
    const all = allQuotas();
    const slots = all.reduce((s, x) => s + (x.quota == null ? 0 : x.remaining), 0);
    const n = (st) => all.filter((x) => x.status === st).length;
    clear(hero, stat('Ubat Mahal slots left', fmt.n(slots)));
    clear(tiles, tile('Over / full', fmt.n(n('over') + n('full'))), tile('Near full', fmt.n(n('near'))), tile('No quota', fmt.n(n('none'))));
    const rows = all.filter((x) => (filter === 'all' || x.status === filter || (filter === 'full' && x.status === 'over'))
      && (!q || `${x.drug.perihal} ${x.no_kod}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => ({ over: 0, full: 1, near: 2, ok: 3, none: 4 }[a.status] - { over: 0, full: 1, near: 2, ok: 3, none: 4 }[b.status]) || a.drug.perihal.localeCompare(b.drug.perihal));
    clear(list, rows.length ? rows.map((x) => h('li', null, h('a', { class: 'item', href: `#/drug/${encodeURIComponent(x.no_kod)}` },
      h('div', { class: 'grow stack' },
        h('div', { class: 'name' }, x.drug.perihal),
        quotaBar(x),
        h('div', { class: 'meta' }, x.quota == null ? `${x.used} on drug` : `${x.used} of ${x.quota} used · ${x.remaining} left${x.waiting ? ` · ${x.waiting} waiting` : ''}`)),
      statusPill(x), icon('chevron')))) : h('li', { class: 'empty' }, 'Nothing matches.'));
  };
  input.addEventListener('input', () => { q = input.value; paint(); });
  const el = h('div', null, hero, tiles,
    h('div', { class: 'search' }, icon('search'), input),
    chips([['all', 'All'], ['full', 'Full or over'], ['near', 'Near full'], ['ok', 'Slots left'], ['none', 'No quota']], filter, (v) => { filter = v; paint(); }),
    h('div', { class: 'card section' }, list));
  paint();
  return { el, title: 'Ubat Mahal quota', update: paint };
}
