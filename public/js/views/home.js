import { h, icon, clear, fmt } from '../dom.js';
import { state, searchDrugs, totalFor, balances } from '../store.js';
import { stat, tile, chips } from '../ui.js';
import { drugCard, DISCLAIMER } from '../drugui.js';

const RECENT = 'fm-recent-searches';
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch { return []; } };
const VIEW = 'fm-results-view';
const remember = (q) => {
  if (q.trim().length < 2) return;
  localStorage.setItem(RECENT, JSON.stringify([q.trim(), ...recent().filter((r) => r !== q.trim())].slice(0, 5)));
};

export function home() {
  let q = '';
  let kind = 'all';
  let view = localStorage.getItem(VIEW) === 'list' ? 'list' : 'gallery';
  const results = h('ul', { class: 'list' });
  const gallery = h('div', { class: 'gallery' });
  const recents = h('div', { class: 'chips' });
  const card = h('div', { class: 'card' }, results);
  const views = chips([['gallery', 'Gallery'], ['list', 'List']], view, (v) => { view = v; localStorage.setItem(VIEW, v); paint(); });
  const tilesEl = h('div', { class: 'tiles' });
  const input = h('input', { type: 'search', placeholder: 'Drug, brand, Kod PhIS or No Kod', 'aria-label': 'Search drugs', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });

  const paint = () => {
    const rows = searchDrugs(q, kind, 50);
    clear(results);
    clear(gallery);
    card.hidden = view === 'gallery' && rows.length > 0;
    gallery.hidden = !card.hidden;
    if (view === 'gallery') {
      for (const d of rows) {
        const a = drugCard(d, state.mahal.has(d.no_kod) && h('span', { class: 'pill navy' }, 'Mahal'));
        a.addEventListener('click', () => remember(q));
        gallery.append(a);
      }
    }
    if (!rows.length) results.append(h('li', { class: 'empty' }, state.drugs.length ? 'No match. Try fewer letters.' : 'No data on this device yet. Connect once to download the formulary.'));
    if (view === 'list') for (const d of rows) {
      const mahal = state.mahal.has(d.no_kod);
      const total = totalFor(d.no_kod);
      results.append(h('li', null, h('a', { class: 'item', href: `#/drug/${encodeURIComponent(d.no_kod)}`, onClick: () => remember(q) },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, d.perihal), h('div', { class: 'meta' }, h('span', { class: 'mono' }, d.no_kod), d.brand ? ` · ${d.brand}` : '')),
        mahal && h('span', { class: 'pill navy' }, 'Mahal'),
        h('span', { class: 'qty sub' }, total ? fmt.n(total) : ''),
        icon('chevron'))));
    }
    clear(recents, !q && recent().map((r) => h('button', { class: 'chip', type: 'button', onClick: () => { input.value = r; q = r; paint(); } }, r)));
  };
  const paintTiles = () => clear(tilesEl,
    tile('Ubat', fmt.n(state.drugs.filter((d) => d.kategori === 'Ubat').length)),
    tile('Ubat Mahal', fmt.n(state.mahal.size)),
    tile('On hand lines', fmt.n([...balances().values()].filter((v) => v > 0).length)));

  input.addEventListener('input', () => { q = input.value; paint(); });
  const el = h('div', null,
    stat('Items in formulary', fmt.n(state.drugs.length)),
    tilesEl,
    h('div', { class: 'search' }, icon('search'), input),
    chips([['all', 'All'], ['mahal', 'Ubat Mahal'], ['ubat', 'Ubat'], ['bukan', 'Bukan Ubat']], kind, (v) => { kind = v; paint(); }),
    recents,
    h('div', { class: 'row-between section' }, h('p', { class: 'label' }, 'Results'), views),
    h('p', { class: 'sub disclaimer' }, DISCLAIMER),
    gallery,
    card);
  paint(); paintTiles();
  return { el, title: 'Formulary', wide: true, update: () => { paint(); paintTiles(); } };
}
