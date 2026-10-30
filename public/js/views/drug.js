import { h, icon, clear, fmt } from '../dom.js';
import { state, can_, parLines, totalFor, movementsFor, quotaSummary, unitSummaries, undoneIds, logMovement, saveQuota } from '../store.js';
import { stat, statusPill, quotaBar, tape, locName, moveLine, toast } from '../ui.js';
import { inverseOf } from '/shared/ledger.js';
import { parPill, parMeta } from './stock.js';
import { drugHeader } from '../drugui.js';
import { drugView } from '/shared/druginfo.js';
import { LIST_LABEL } from '/shared/par.js';

export function drug({ id }) {
  const kod = decodeURIComponent(id);
  const d = state.drugMap.get(kod);
  if (!d) return { el: h('div', { class: 'empty' }, 'Drug not found on this device.'), title: 'Drug' };
  const body = h('div', { class: 'stack' });

  const paint = () => {
    const total = totalFor(kod);
    const q = quotaSummary(kod);
    const stock = parLines({ drug: kod }).map((r) => ({ ...r, name: state.locMap.get(r.location)?.name || r.location }))
      .sort((a, b) => (b.status === 'low') - (a.status === 'low') || a.name.localeCompare(b.name));
    const moves = movementsFor(kod, 30);
    const undone = undoneIds();
    const belowMin = d.min != null && total < d.min;

    const featured = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, d.perihal), h('span', { class: 'mono' }, d.no_kod)),
      h('div', { class: 'card-pad stack' },
        h('div', { class: 'row wrap' },
          h('div', { class: 'grow' }, stat('Stock balance', fmt.n(total), h('small', null, ` ${d.sku || ''}`))),
          belowMin && h('span', { class: 'pill s-near' }, icon('alert'), 'Below min'),
          state.mahal.has(kod) && h('span', { class: 'pill navy' }, 'Ubat Mahal')),
        q && h('div', { class: 'stack' },
          h('div', { class: 'row' }, h('div', { class: 'grow' }, stat('Ubat Mahal slots left', q.quota == null ? '-' : fmt.n(q.remaining))), statusPill(q)),
          quotaBar(q),
          h('div', { class: 'sub' }, q.quota == null ? `${q.used} on drug. Quota not set.` : `${q.used} of ${q.quota} used${q.waiting ? ` · ${q.waiting} on waiting list` : ''}`)),
        h('div', { class: 'sheet-actions' },
          can_('stock.log') && h('a', { class: 'btn', href: `#/log?drug=${encodeURIComponent(kod)}` }, icon('plus'), 'Log movement'),
          q && can_('patient.view') && h('a', { class: 'btn ghost', href: `#/patients?drug=${encodeURIComponent(kod)}` }, icon('users'), 'Patients'))));

    const units = q ? unitSummaries(kod) : [];
    const unitCard = units.length ? h('section', { class: 'card' },
      h('p', { class: 'label card-pad' }, 'Quota by unit'),
      h('div', { class: 'scroll-x' }, h('table', null, h('thead', null, h('tr', null, ['Unit', 'Used', 'Kuota', 'Status'].map((t) => h('th', null, t)))),
        h('tbody', null, units.map((u) => h('tr', null, h('td', null, u.unit), h('td', { class: 'mono' }, u.used), h('td', { class: 'mono' }, u.quota ?? '-'), h('td', null, statusPill(u)))))))) : null;

    const stockCard = h('section', { class: 'card' }, h('p', { class: 'label card-pad' }, 'Stock vs par by location'),
      h('ul', { class: 'list' }, stock.length ? stock.map((s) => h('li', null, h('a', { class: 'item', href: `#/kad/${encodeURIComponent(kod)}?loc=${encodeURIComponent(s.location)}`, 'aria-label': `Kad Stok ${s.name}` },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, s.name), h('div', { class: 'meta' }, s.par ? `Par ${fmt.n(s.par)} · ${parMeta(s)}` : 'No par level')),
        h('div', { class: 'par' }, h('span', { class: 'qty mono' }, s.qty === undefined ? '–' : fmt.n(s.qty)), s.par ? h('span', { class: 'meta mono' }, `/ ${fmt.n(s.par)}`) : null),
        parPill(s.status), icon('chevron'))))
        : h('li', { class: 'empty' }, 'No stock recorded and no par level.')));

    const moveCard = h('section', { class: 'card' },
      h('div', { class: 'card-pad stack' }, h('div', { class: 'row-between' }, h('p', { class: 'label' }, 'Recent movements'),
        h('a', { class: 'btn ghost', href: `#/kad/${encodeURIComponent(kod)}` }, 'Kad Stok')), moves.length > 1 ? tape(moves) : null),
      h('ul', { class: 'list' }, moves.length ? moves.slice(0, 12).map((m) => {
        const l = moveLine(m);
        const canUndo = !m.pending && !m.reverses && !undone.has(m.id) && can_('stock.log') && m.type !== 'stocktake' && m.type !== 'adjust';
        return h('li', { class: 'item' },
          h('div', { class: 'grow' }, h('div', { class: 'name' }, `${l.label} ${l.where}`), h('div', { class: 'meta' }, `${l.when} · ${m.username || ''}${m.reverses ? ' · reversal' : ''}${m.note ? ` · ${m.note}` : ''}`)),
          m.pending && h('span', { class: 'pill s-near' }, 'Pending'),
          h('span', { class: 'qty mono' }, `${l.sign}${fmt.n(m.qty)}`),
          canUndo && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Undo this movement', onClick: () => undo(m) }, icon('undo')));
      }) : h('li', { class: 'empty' }, 'No movements yet.')));

    clear(body, featured, unitCard, keptCard(kod), stockCard, moveCard, q && can_('quota.edit') ? quotaEditor(kod, q) : null);
  };

  async function undo(m) {
    if (!confirm(`Undo this ${m.type} of ${m.qty}? A reversing entry is added. The original stays on record.`)) return;
    const r = await logMovement({ ...inverseOf(m, 'x'), id: undefined, note: 'Undo', reverses: m.id });
    toast(r.status === 'rejected' ? r.reason : r.status === 'queued' ? 'Undo queued' : 'Undone', r.status === 'rejected');
    paint();
  }

  paint();
  return { el: h('div', null, h('a', { class: 'btn ghost', href: '#/' }, icon('back'), 'Search'), h('div', { class: 'section' }), drugHeader(d), body), title: d.no_kod, update: paint };
}

const KEPT_ORDER = ['floor', 'aoh', 'trolley', 'dda', 'other'];

function keptCard(kod) {
  const kept = drugView(state.drugMap.get(kod)).kept;
  const groups = KEPT_ORDER.map((kind) => ({ kind, rows: kept.filter((r) => r.kind === kind) })).filter((g) => g.rows.length);
  const line = (r) => {
    const href = r.loc_id ? `#/kad/${encodeURIComponent(kod)}?loc=${encodeURIComponent(r.loc_id)}` : null;
    const body = [
      h('div', { class: 'grow' }, h('div', { class: 'name' }, r.loc), r.note ? h('div', { class: 'meta' }, r.note) : null),
      r.qty ? h('span', { class: 'qty mono' }, r.qty) : null,
      href ? icon('chevron') : null,
    ];
    return h('li', null, href
      ? h('a', { class: 'item', href, 'aria-label': `Kad Stok ${r.loc}` }, body)
      : h('div', { class: 'item' }, body));
  };
  return h('section', { class: 'card' },
    h('p', { class: 'label card-pad' }, 'Where this drug is kept'),
    groups.length
      ? groups.flatMap((g) => [h('p', { class: 'label kept-kind' }, LIST_LABEL[g.kind] || 'Other'), h('ul', { class: 'list' }, g.rows.map(line))])
      : h('p', { class: 'sub kept-empty' }, 'Not listed on floor stock, after office hours, or an emergency trolley.'));
}

function quotaEditor(kod, q) {
  const m = state.mahal.get(kod);
  const input = h('input', { type: 'number', min: 0, step: 1, value: m.quota ?? '', 'aria-label': 'Kuota' });
  const note = h('input', { type: 'text', value: m.nota || '', maxlength: 300 });
  const box = h('section', { class: 'card card-pad hidden stack' },
    h('p', { class: 'label' }, 'Edit quota (needs connection)'),
    h('label', { class: 'field' }, h('span', null, 'Kuota (patients allowed)'), input),
    h('label', { class: 'field' }, h('span', null, 'Nota'), note),
    h('button', { class: 'btn', type: 'button', onClick: async () => {
      if (!state.online) { toast('Needs a connection', true); return; }
      try { await saveQuota(kod, input.value, note.value); toast('Quota saved'); box.classList.add('hidden'); }
      catch (e) { toast(e.code === 'permission-denied' ? 'Not allowed' : e.message, true); }
    } }, 'Save'));
  return h('div', null, h('button', { class: 'btn ghost block', type: 'button', onClick: () => box.classList.toggle('hidden') }, 'Edit quota'), h('div', { class: 'section' }), box);
}
