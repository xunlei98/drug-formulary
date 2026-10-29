import { h, icon, clear, fmt } from '../dom.js';
import { state, can_, cardFor, locationOptions, myScope, stockFor, parLines } from '../store.js';
import { stat } from '../ui.js';
import { pageOf, DOC_LABEL } from '/shared/kad.js';

const PAGE = 20;
const rm = (v) => (v == null ? '-' : Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const q = (v) => (v == null ? '' : fmt.n(v));

// Where a card opens when no location is given: the ward's own, else where this drug has the most stock.
export function defaultLoc(kod, wanted) {
  const opts = cardLocations();
  if (wanted && opts.some((l) => l.id === wanted)) return wanted;
  const own = state.user?.location_id;
  if (own && opts.some((l) => l.id === own)) return own;
  return stockFor(kod).find((s) => opts.some((l) => l.id === s.location))?.location || opts[0]?.id || '';
}
export const cardLocations = () => { const s = myScope(); return locationOptions().filter((l) => !s || s.has(l.id)); };

export function kad({ id }, query) {
  const kod = decodeURIComponent(id);
  let loc = defaultLoc(kod, query.get('loc'));
  let show = PAGE;
  const body = h('div', { class: 'stack' });

  const paint = () => {
    const d = state.drugMap.get(kod) || { no_kod: kod, perihal: kod };
    if (!loc) loc = defaultLoc(kod, query.get('loc'));
    const card = cardFor(kod, loc);
    const page = pageOf(card, show);
    const par = parLines({ drug: kod, location: loc })[0]?.par || 0;
    const where = state.locMap.get(loc)?.name || loc;
    const sel = h('select', { 'aria-label': 'Lokasi' }, cardLocations().map((l) => h('option', { value: l.id, selected: l.id === loc }, l.label)));
    sel.addEventListener('change', () => { loc = sel.value; show = PAGE; history.replaceState(null, '', `#/kad/${encodeURIComponent(kod)}?loc=${encodeURIComponent(loc)}`); paint(); });

    const bf = h('tr', { class: 'bf' },
      h('td', { class: 'sticky' }, page.older ? '' : card.asOf ? fmt.date(card.asOf) : ''),
      h('td', { colspan: 7 }, 'Baki dibawa ke hadapan', page.older ? h('span', { class: 'meta' }, ` (${page.older} baris lama disembunyikan)`) : null),
      h('td', { class: `num${page.bf < 0 ? ' neg' : ''}` }, fmt.n(page.bf)), h('td', { class: 'num' }, rm(page.bfRm)), h('td'));
    const rows = page.rows.map((r) => h('tr', { class: r.pending ? 'pending' : '' },
      h('td', { class: 'sticky' }, fmt.date(r.tarikh), r.pending ? h('span', { class: 'pill s-near' }, 'Belum sync') : null),
      h('td', { class: 'mono' }, r.doc || '-'),
      h('td', { class: 'party' }, r.party, r.note ? h('div', { class: 'meta' }, r.note) : null),
      h('td', { class: 'num' }, q(r.inQty)), h('td', { class: 'num' }, r.inQty == null ? '' : rm(r.inPrice)), h('td', { class: 'num' }, r.inQty == null ? '' : rm(r.inRm)),
      h('td', { class: 'num' }, q(r.outQty)), h('td', { class: 'num' }, r.outQty == null ? '' : rm(r.outRm)),
      h('td', { class: `num baki${r.negative ? ' neg' : ''}` }, fmt.n(r.baki)), h('td', { class: 'num' }, rm(r.bakiRm)),
      h('td', null, r.pegawai)));

    const table = h('div', { class: 'scroll-x kad-scroll', tabindex: 0, 'aria-label': 'Kad Stok, skrol ke kanan untuk lajur lain' },
      h('table', { class: 'kad' },
        h('thead', null,
          h('tr', null,
            h('th', { rowspan: 2, class: 'sticky' }, 'Tarikh'), h('th', { rowspan: 2 }, 'No. PK / BTB / BPSS / BPSI / BPIN'), h('th', { rowspan: 2 }, 'Terima Daripada / Keluar Kepada'),
            h('th', { colspan: 3, class: 'grp' }, 'Terimaan'), h('th', { colspan: 2, class: 'grp' }, 'Keluaran'), h('th', { colspan: 2, class: 'grp' }, 'Baki'),
            h('th', { rowspan: 2 }, 'Nama Pegawai')),
          h('tr', null, ['Kuantiti', 'Seunit (RM)', 'Jumlah (RM)', 'Kuantiti', 'Jumlah (RM)', 'Kuantiti', 'Jumlah (RM)'].map((t) => h('th', { class: 'num' }, t)))),
        h('tbody', null, bf, rows.length ? rows : h('tr', null, h('td', { class: 'sticky' }), h('td', { colspan: 10, class: 'meta' }, 'Tiada transaksi lagi di lokasi ini.')))));

    clear(body,
      h('div', { class: 'row wrap kad-top' },
        h('div', { class: 'grow' }, stat(`Baki semasa · ${where}`, h('span', { class: card.baki < 0 ? 'neg' : '' }, fmt.n(card.baki)), h('small', null, ` ${d.sku || ''}`))),
        card.baki < 0 && h('span', { class: 'pill s-over' }, icon('alert'), 'Baki negatif, perlu semakan'),
        par ? h('span', { class: `pill ${card.baki < par ? 's-near' : 's-ok'}` }, `Par ${fmt.n(par)}`) : null),
      h('section', { class: 'card kad-card' },
        h('div', { class: 'kad-head' },
          h('div', { class: 'row-between' }, h('p', { class: 'label' }, 'Kad Stok · Bahagian B · Transaksi Stok'), h('span', { class: 'label' }, 'KEW.PS · M.S. 7/13')),
          h('h2', null, d.perihal),
          h('div', { class: 'kad-meta' },
            h('div', null, h('p', { class: 'label' }, 'No. Kod'), h('div', { class: 'mono' }, d.no_kod)),
            h('div', null, h('p', { class: 'label' }, 'Unit'), h('div', null, d.sku || '-')),
            h('div', null, h('p', { class: 'label' }, 'Paras par'), h('div', null, par ? fmt.n(par) : '-')),
            h('label', { class: 'kad-loc' }, h('p', { class: 'label' }, 'Lokasi'), sel))),
        table,
        page.older ? h('div', { class: 'card-pad' }, h('button', { class: 'btn ghost block', type: 'button', onClick: () => { show += PAGE; paint(); } }, `Tunjuk ${Math.min(PAGE, page.older)} baris lebih lama`)) : null),
      can_('stock.log') && h('a', { class: 'btn block', href: `#/log?drug=${encodeURIComponent(kod)}&loc=${encodeURIComponent(loc)}` }, icon('plus'), 'Isi baris baru'),
      h('p', { class: 'sub kad-nota' }, h('b', null, 'Nota: '), Object.entries(DOC_LABEL).filter(([k]) => k !== 'LAIN').map(([k, v]) => `${k} = ${v}`).join('; '),
        '. Jumlah (RM) = Kuantiti × Seunit; tanpa Seunit ditunjuk "-". Baris disusun ikut masa disimpan, terbaru di bawah.'));
  };

  paint();
  return { el: h('div', null, h('a', { class: 'btn ghost', href: `#/drug/${encodeURIComponent(kod)}` }, icon('back'), kod), h('div', { class: 'section' }), body), title: 'Kad Stok', update: paint, wide: true };
}
