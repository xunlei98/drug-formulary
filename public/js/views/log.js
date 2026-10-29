import { h, icon, clear, fmt } from '../dom.js';
import { state, searchDrugs, locationOptions, logMovement, myScope } from '../store.js';
import { segmented, toast, LABEL } from '../ui.js';
import { validateShape } from '/shared/ledger.js';

export function log(_, query) {
  const f = { type: 'receive', drug: query.get('drug') || '', from: '', to: '', qty: 1, note: '' };
  const drugBox = h('input', { type: 'search', placeholder: 'Search drug', 'aria-label': 'Drug', autocomplete: 'off', value: f.drug ? state.drugMap.get(f.drug)?.perihal || '' : '' });
  const hits = h('ul', { class: 'list card hidden' });
  const picked = h('div', { class: 'sub' });
  const qty = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, value: f.qty, 'aria-label': 'Quantity' });
  const fromSel = h('select', { 'aria-label': 'From' });
  const toSel = h('select', { 'aria-label': 'To' });
  const fromField = h('label', { class: 'field' }, h('span', null, 'From'), fromSel);
  const toField = h('label', { class: 'field' }, h('span', null, 'To'), toSel);
  const note = h('input', { type: 'text', maxlength: 200, placeholder: 'Optional', 'aria-label': 'Note' });
  const msg = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn block', type: 'button' }, 'Save movement');

  const own = myScope();
  const options = (selected) => [h('option', { value: '' }, 'Choose location'), ...locationOptions().map((l) => h('option', { value: l.id, selected: l.id === selected }, l.label))];
  const paintLocs = () => {
    const t = f.type;
    fromField.classList.toggle('hidden', !['transfer', 'issue'].includes(t) && !(t === 'adjust'));
    toField.classList.toggle('hidden', !['receive', 'transfer', 'stocktake'].includes(t) && !(t === 'adjust'));
    fromField.firstChild.textContent = t === 'adjust' ? 'Remove from (for decrease)' : 'From';
    toField.firstChild.textContent = t === 'stocktake' ? 'Counted at' : t === 'adjust' ? 'Add to (for increase)' : 'To';
    qty.setAttribute('aria-label', t === 'stocktake' ? 'Counted quantity' : 'Quantity');
    clear(fromSel, options(f.from));
    clear(toSel, options(f.to));
    if (own && !f.to && !f.from) {
      const ward = state.user.location_id;
      if (['issue'].includes(t)) { f.from = ward; fromSel.value = ward; }
      if (['receive', 'stocktake'].includes(t)) { f.to = ward; toSel.value = ward; }
    }
  };
  const pickDrug = (d) => { f.drug = d.no_kod; drugBox.value = d.perihal; clear(picked, h('span', { class: 'mono' }, d.no_kod), d.sku ? ` · ${d.sku}` : ''); hits.classList.add('hidden'); };
  drugBox.addEventListener('input', () => {
    f.drug = ''; clear(picked);
    const rows = drugBox.value.trim() ? searchDrugs(drugBox.value, 'all', 6) : [];
    clear(hits, rows.map((d) => h('li', null, h('button', { class: 'item', type: 'button', onClick: () => pickDrug(d) }, h('div', { class: 'grow' }, h('div', { class: 'name' }, d.perihal), h('div', { class: 'meta mono' }, d.no_kod)))))); 
    hits.classList.toggle('hidden', !rows.length);
  });
  fromSel.addEventListener('change', () => { f.from = fromSel.value; });
  toSel.addEventListener('change', () => { f.to = toSel.value; });
  qty.addEventListener('input', () => { f.qty = Number(qty.value); });
  const step = (n) => { f.qty = Math.max(0, (Number(qty.value) || 0) + n); qty.value = f.qty; };

  submit.addEventListener('click', async () => {
    const m = { drug: f.drug, type: f.type, qty: Number(qty.value), note: note.value.trim() || undefined };
    if (!fromField.classList.contains('hidden') && f.from) m.from = f.from;
    if (!toField.classList.contains('hidden') && f.to) m.to = f.to;
    const problem = !m.drug ? 'Choose a drug first.' : validateShape({ id: 'preview-id', ...m });
    if (problem) { clear(msg, h('div', { class: 'notice bad' }, typeof problem === 'string' ? problem : problem.error || String(problem))); return; }
    submit.disabled = true;
    try {
      const r = await logMovement(m);
      if (r.status === 'rejected') { clear(msg, h('div', { class: 'notice bad' }, r.reason)); return; }
      toast(r.status === 'queued' ? 'Saved on this device. It will sync when online.' : 'Movement saved');
      location.hash = `#/drug/${encodeURIComponent(m.drug)}`;
    } catch (e) {
      clear(msg, h('div', { class: 'notice bad' }, e.message));
    } finally { submit.disabled = false; }
  });

  if (f.drug) pickDrug(state.drugMap.get(f.drug) || { no_kod: f.drug, perihal: f.drug });
  paintLocs();
  const el = h('div', { class: 'stack' },
    h('p', { class: 'label' }, 'Log stock movement'),
    h('div', { class: 'card card-pad' },
      segmented(Object.entries(LABEL), f.type, (v) => { f.type = v; f.from = ''; f.to = ''; paintLocs(); }),
      h('div', { class: 'section' }),
      h('label', { class: 'field' }, h('span', null, 'Drug'), drugBox), hits, picked,
      h('div', { class: 'section' }),
      fromField, toField,
      h('label', { class: 'field' }, h('span', null, 'Quantity'),
        h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'Minus one', onClick: () => step(-1) }, '-'), qty, h('button', { type: 'button', 'aria-label': 'Plus one', onClick: () => step(1) }, '+'))),
      h('label', { class: 'field' }, h('span', null, 'Note'), note),
      msg, submit),
    h('p', { class: 'sub' }, navigator.onLine ? 'Online: checked against live balance.' : 'Offline: saved here and synced later. A negative balance is flagged for review.'));
  return { el, title: 'Log movement' };
}
