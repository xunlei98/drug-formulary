import { h, icon, clear, fmt } from '../dom.js';
import { state, searchDrugs, logMovement, cardFor, locationOptions } from '../store.js';
import { segmented, toast } from '../ui.js';
import { validateShape } from '/shared/ledger.js';
import { entryToMovement, validateCardFields, DOC_TYPES } from '/shared/kad.js';
import { defaultLoc, cardLocations } from './kad.js';

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const DIR = [['in', 'Terimaan'], ['out', 'Keluaran'], ['count', 'Kiraan stok']];

// One new row of the Kad Stok, in the card's column order. Nama Pegawai is the signed-in user.
export function log(_, query) {
  const e = { drug: query.get('drug') || '', loc: '', dir: 'in', with: '', party: '', qty: 1, tarikh: today(), doc_type: '', doc_no: '', unit_price: '', note: '' };
  e.loc = defaultLoc(e.drug, query.get('loc'));

  const drugBox = h('input', { type: 'search', placeholder: 'Cari ubat', 'aria-label': 'Ubat', autocomplete: 'off' });
  const hits = h('ul', { class: 'list card hidden' });
  const picked = h('div', { class: 'sub' });
  const locSel = h('select', { 'aria-label': 'Lokasi kad' }, cardLocations().map((l) => h('option', { value: l.id, selected: l.id === e.loc }, l.label)));
  const tarikh = h('input', { type: 'date', value: e.tarikh, max: e.tarikh, 'aria-label': 'Tarikh' });
  const docType = h('select', { 'aria-label': 'Jenis dokumen' }, h('option', { value: '' }, 'Tiada'), DOC_TYPES.map((t) => h('option', { value: t }, t === 'LAIN' ? 'Lain-lain' : t)));
  const docNo = h('input', { type: 'text', maxlength: 40, placeholder: 'No. dokumen', 'aria-label': 'No. dokumen' });
  const withSel = h('select', { 'aria-label': 'Terima Daripada / Keluar Kepada' });
  const party = h('input', { type: 'text', maxlength: 120, 'aria-label': 'Nama (pembekal, pesakit atau lain-lain)' });
  const partyField = h('label', { class: 'field' }, h('span', null, 'Nama'), party);
  const withField = h('label', { class: 'field' }, h('span', null, 'Terima Daripada'), withSel);
  const qty = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, value: e.qty, 'aria-label': 'Kuantiti' });
  const qtyLabel = h('span', null, 'Kuantiti diterima');
  const price = h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.0001', placeholder: 'Pilihan', 'aria-label': 'Seunit (RM)' });
  const priceHint = h('div', { class: 'hint' });
  const priceField = h('label', { class: 'field' }, h('span', null, 'Seunit (RM)'), price, priceHint);
  const note = h('input', { type: 'text', maxlength: 200, placeholder: 'Pilihan', 'aria-label': 'Catatan' });
  const after = h('div', { class: 'after', 'aria-live': 'polite' });
  const msg = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn block', type: 'button' }, 'Simpan baris');
  const back = h('a', { class: 'btn ghost' }, icon('back'), 'Kad Stok');

  const read = () => ({ ...e, loc: locSel.value, tarikh: tarikh.value, doc_type: docType.value, doc_no: docNo.value.trim(), with: withSel.value,
    party: party.value.trim(), qty: Number(qty.value), unit_price: price.value, note: note.value.trim() });

  const paintWith = () => {
    const keep = withSel.value;
    const others = locationOptions().filter((l) => l.id !== locSel.value).map((l) => h('option', { value: l.id }, l.label));
    clear(withSel, h('option', { value: '' }, 'Pilih'), h('optgroup', { label: 'Lokasi dalam hospital' }, others),
      h('option', { value: 'text' }, e.dir === 'in' ? 'Pembekal / luar (tulis nama)' : 'Pesakit / luar (tulis nama)'),
      h('option', { value: 'adjust' }, 'Pelarasan stok'));
    withSel.value = [...withSel.options].some((o) => o.value === keep) ? keep : '';
  };
  const paint = () => {
    // The catalog may arrive after the view opens: fill in the drug name and the location lists then.
    if (e.drug && drugBox.value === e.drug && state.drugMap.has(e.drug)) { pickDrug(state.drugMap.get(e.drug)); return; }
    if (!locSel.options.length && cardLocations().length) {
      e.loc = defaultLoc(e.drug, query.get('loc'));
      clear(locSel, cardLocations().map((l) => h('option', { value: l.id, selected: l.id === e.loc }, l.label)));
      paintWith();
    }
    if (withSel.options.length < 4 && locationOptions().length) paintWith();
    const f = read();
    const count = f.dir === 'count';
    withField.classList.toggle('hidden', count);
    partyField.classList.toggle('hidden', count || f.with !== 'text');
    priceField.classList.toggle('hidden', f.dir !== 'in');
    withField.firstChild.textContent = f.dir === 'in' ? 'Terima Daripada' : 'Keluar Kepada';
    qtyLabel.textContent = count ? 'Kuantiti dikira' : f.dir === 'in' ? 'Kuantiti diterima' : 'Kuantiti dikeluarkan';
    const d = state.drugMap.get(f.drug);
    clear(priceHint, d?.harga_pku != null ? `Harga PKU ${fmt.money(d.harga_pku)} setiap ${d.pku || 'PKU'}; Seunit ialah harga satu ${d.sku || 'unit'}.` : 'Kosongkan jika tidak tahu. Lajur RM akan tunjuk "-".');
    back.href = f.drug ? `#/kad/${encodeURIComponent(f.drug)}?loc=${encodeURIComponent(f.loc)}` : '#/stock';
    if (!f.drug || !f.loc) { clear(after); return; }
    const now = cardFor(f.drug, f.loc).baki;
    const n = Number.isFinite(f.qty) ? f.qty : 0;
    const next = count ? n : now + (f.dir === 'in' ? n : -n);
    clear(after, h('div', null, h('p', { class: 'label' }, 'Baki sekarang'), h('div', { class: 'mono' }, fmt.n(now))),
      h('div', { class: 'right' }, h('p', { class: 'label' }, 'Baki selepas baris ini'), h('p', { class: `hero${next < 0 ? ' neg' : ''}` }, fmt.n(next))));
  };

  const pickDrug = (d) => { e.drug = d.no_kod; drugBox.value = d.perihal; clear(picked, h('span', { class: 'mono' }, d.no_kod), d.sku ? ` · ${d.sku}` : ''); hits.classList.add('hidden'); paint(); };
  drugBox.addEventListener('input', () => {
    e.drug = ''; clear(picked);
    const rows = drugBox.value.trim() ? searchDrugs(drugBox.value, 'all', 6) : [];
    clear(hits, rows.map((d) => h('li', null, h('button', { class: 'item', type: 'button', onClick: () => pickDrug(d) }, h('div', { class: 'grow' }, h('div', { class: 'name' }, d.perihal), h('div', { class: 'meta mono' }, d.no_kod))))));
    hits.classList.toggle('hidden', !rows.length);
    paint();
  });
  locSel.addEventListener('change', () => { paintWith(); paint(); });
  for (const el of [withSel, qty, price, tarikh]) el.addEventListener('input', paint);
  withSel.addEventListener('change', paint);
  const step = (n) => { qty.value = Math.max(0, (Number(qty.value) || 0) + n); paint(); };

  submit.addEventListener('click', async () => {
    const f = read();
    const m = entryToMovement(f);
    const problem = !f.drug ? 'Pilih ubat dahulu.' : !f.loc ? 'Pilih lokasi kad.' : f.dir !== 'count' && !f.with ? (f.dir === 'in' ? 'Pilih Terima Daripada.' : 'Pilih Keluar Kepada.')
      : f.with === 'text' && !f.party ? 'Tulis nama pembekal / penerima.' : f.tarikh > today() ? 'Tarikh tidak boleh pada masa depan.'
        : validateShape({ id: 'preview-id', ...m }) || validateCardFields(m);
    if (problem) { clear(msg, h('div', { class: 'notice bad' }, problem)); return; }
    submit.disabled = true;
    try {
      const r = await logMovement(m);
      if (r.status === 'rejected') { clear(msg, h('div', { class: 'notice bad' }, r.reason)); return; }
      toast(r.status === 'queued' ? 'Disimpan dalam peranti. Akan sync bila online.' : 'Baris disimpan');
      location.hash = `#/kad/${encodeURIComponent(f.drug)}?loc=${encodeURIComponent(f.loc)}`;
    } catch (err) {
      clear(msg, h('div', { class: 'notice bad' }, err.message));
    } finally { submit.disabled = false; }
  });

  if (e.drug) pickDrug(state.drugMap.get(e.drug) || { no_kod: e.drug, perihal: e.drug });
  paintWith();
  const el = h('div', { class: 'stack kad-form' },
    back,
    h('section', { class: 'card card-pad' },
      h('p', { class: 'label' }, 'Kad Stok'),
      h('label', { class: 'field' }, h('span', null, 'Ubat'), drugBox), hits, picked,
      h('label', { class: 'field' }, h('span', null, 'Lokasi kad'), locSel)),
    h('section', { class: 'card card-pad' },
      h('p', { class: 'label' }, 'Baris baru · Transaksi Stok'),
      h('label', { class: 'field' }, h('span', null, 'Tarikh'), tarikh),
      h('div', { class: 'field' }, h('span', null, 'No. PK / BTB / BPSS / BPSI / BPIN'), h('div', { class: 'doc' }, docType, docNo)),
      h('fieldset', null, h('legend', { class: 'label' }, 'Jenis transaksi'),
        segmented(DIR, e.dir, (v) => { e.dir = v; paintWith(); paint(); })),
      withField, partyField,
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, qtyLabel,
          h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'Tolak satu', onClick: () => step(-1) }, '-'), qty, h('button', { type: 'button', 'aria-label': 'Tambah satu', onClick: () => step(1) }, '+'))),
        priceField),
      after,
      h('div', { class: 'field' }, h('span', null, 'Nama Pegawai'), h('div', { class: 'officer' }, state.user.username)),
      h('label', { class: 'field' }, h('span', null, 'Catatan'), note),
      msg, submit),
    h('p', { class: 'sub' }, navigator.onLine ? 'Online: disemak dengan baki semasa.' : 'Offline: disimpan di peranti dan sync kemudian. Baki negatif ditanda untuk semakan.'));
  paint();
  return { el, title: 'Isi Kad Stok', update: paint };
}
