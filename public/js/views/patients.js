import { h, icon, clear, fmt } from '../dom.js';
import { state, searchDrugs, changeKategori, pendingFor } from '../store.js';
import { listPatients, getPatient, patientLog, revealIc, createPatient, editPatient } from '../patients-data.js';
import { stat, tile, chips, toast } from '../ui.js';
import { KATEGORI, UNITS, NEEDS_STOP_DATE, nextStates } from '/shared/patient-state.js';
import { COUNTED } from '/shared/quota.js';

const KAT_CLASS = { Active: 's-ok', 'Active - Pesara': 's-ok', 'Waiting List': 's-near', Off: 's-none', Defaulted: 's-over' };
const kategoriPill = (k) => h('span', { class: `pill ${KAT_CLASS[k] || ''}` }, k);


// Drug first: the list costs one read per patient shown, so all patients load only on request.
export function patients(_, query) {
  let kat = 'all';
  let drug = query.get('drug') || '';
  let unit = 'all';
  let q = '';
  let data = { rows: [], named: false, fromCache: false };
  const banner = h('div');
  const hero = h('div');
  const list = h('ul', { class: 'list' });
  const input = h('input', { type: 'search', placeholder: 'Name, initials or last 4 of IC', 'aria-label': 'Filter patients' });
  const drugSel = h('select', { 'aria-label': 'Drug' });
  const unitSel = h('select', { 'aria-label': 'Unit' });
  const countFor = (k) => state.counts.filter((c) => c.no_kod === k && COUNTED.includes(c.kategori)).reduce((s, c) => s + c.n, 0);

  const paint = () => {
    const pend = new Map(pendingFor().filter((o) => o.kind === 'patient_update').map((o) => [o.patient_id, o.patch.kategori]));
    const all = data.rows.map((p) => (pend.has(p.id) ? { ...p, kategori: pend.get(p.id), pending: true } : p));
    const rows = all.filter((p) => (kat === 'all' || p.kategori === kat) && (unit === 'all' || p.unit === unit)
      && (!q || `${p.nama} ${p.initials} ${p.ic4}`.toLowerCase().includes(q.toLowerCase())));
    const counted = drug && drug !== 'all' ? countFor(drug) : state.counts.filter((c) => COUNTED.includes(c.kategori)).reduce((s, c) => s + c.n, 0);
    clear(hero, stat('Ubat Mahal patients on drug', fmt.n(counted)));
    clear(banner, drug && !data.named && data.rows.length ? h('div', { class: 'notice warn' }, state.online ? 'Initials only. Choose one drug to see names.' : 'Offline view: initials only. Names, doses and notes need a connection.') : null);
    if (!drug) {
      clear(list, h('li', { class: 'empty' }, 'Choose a drug to list its patients.'));
      return;
    }
    clear(list, rows.length ? rows.slice(0, 300).map((p) => h('li', null, h('a', { class: 'item', href: `#/patient/${p.id}` },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.nama), h('div', { class: 'meta' }, h('span', { class: 'mono' }, p.ic), ` · ${state.drugMap.get(p.no_kod)?.perihal || p.no_kod} · ${p.unit || '-'}`)),
      p.pending && h('span', { class: 'pill s-near' }, 'Pending'), kategoriPill(p.kategori), icon('chevron'))))
      : h('li', { class: 'empty' }, data.rows.length ? 'No patients match these filters.' : 'No patients to show.'));
  };
  const load = () => {
    if (!drug) { data = { rows: [] }; paint(); return; }
    clear(list, h('li', { class: 'empty' }, 'Loading'));
    listPatients(drug === 'all' ? null : drug).then((d) => { data = d; paint(); }).catch((e) => clear(list, h('li', { class: 'empty' }, e.message)));
  };

  clear(drugSel, h('option', { value: '' }, 'Choose drug'), h('option', { value: 'all', selected: drug === 'all' }, 'All drugs (reads every patient)'),
    [...state.mahal.keys()].map((k) => h('option', { value: k, selected: k === drug }, `${state.drugMap.get(k)?.perihal || k} (${countFor(k)})`)).sort((a, b) => a.textContent.localeCompare(b.textContent)));
  clear(unitSel, h('option', { value: 'all' }, 'All units'), UNITS.map((u) => h('option', { value: u }, u)));
  drugSel.addEventListener('change', () => { drug = drugSel.value; load(); });
  unitSel.addEventListener('change', () => { unit = unitSel.value; paint(); });
  input.addEventListener('input', () => { q = input.value; paint(); });

  const el = h('div', null, hero, h('div', { class: 'section' }), banner,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, drugSel), h('div', { class: 'grow' }, unitSel)),
    h('div', { class: 'search' }, icon('search'), input),
    chips([['all', 'All'], ...KATEGORI.map((k) => [k, k])], kat, (v) => { kat = v; paint(); }),
    h('div', { class: 'section' }),
    h('div', { class: 'card' }, list),
    h('p', null, h('a', { class: 'btn', href: '#/patient/new' }, icon('plus'), 'Add patient')));
  load();
  return { el, title: 'Ubat Mahal patients', update: paint };
}

function field(label, node) {
  return h('label', { class: 'field' }, h('span', null, label), node);
}

export function patient({ id }) {
  const box = h('div', { class: 'stack' }, h('div', { class: 'empty' }, 'Loading'));
  let p = null;
  let ic = null;
  let icTimer = null;
  let log = [];

  const paint = () => {
    if (!p) return;
    const minimal = p.minimal;
    const next = nextStates(p.kategori);
    const stopInput = h('input', { type: 'date', 'aria-label': 'Stop date' });
    const msg = h('div', { 'aria-live': 'polite' });
    const move = async (k) => {
      const patch = { kategori: k, tarikh_henti: NEEDS_STOP_DATE.includes(k) ? stopInput.value : null };
      if (NEEDS_STOP_DATE.includes(k) && !patch.tarikh_henti) { clear(msg, h('div', { class: 'notice bad' }, 'Choose the stop date first.')); return; }
      const r = await changeKategori(id, patch, { kategori: p.kategori, no_kod: p.no_kod, unit: p.unit });
      if (r.status === 'rejected') { clear(msg, h('div', { class: 'notice bad' }, r.reason)); return; }
      toast(r.status === 'queued' ? 'Saved on this device. Syncs when online.' : 'Saved');
      if (r.status === 'queued') { p = { ...p, kategori: k }; paint(); } else await reload();
    };
    clear(box,
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, minimal ? `Patient ${p.nama}` : p.nama), kategoriPill(p.kategori)),
        h('div', { class: 'card-pad stack' },
          h('div', { class: 'kv' },
            h('div', null, h('div', { class: 'label' }, 'No Kad Pengenalan'), h('div', { class: 'v mono' }, ic || p.ic),
              !minimal && h('button', { class: 'btn ghost', type: 'button', onClick: reveal }, icon('eye'), ic ? 'Hide' : 'Show full IC')),
            h('div', null, h('div', { class: 'label' }, 'Ubat Mahal'), h('div', { class: 'v' }, state.drugMap.get(p.no_kod)?.perihal || p.no_kod)),
            h('div', null, h('div', { class: 'label' }, 'Unit'), h('div', { class: 'v' }, p.unit || '-')),
            h('div', null, h('div', { class: 'label' }, 'Preskriber'), h('div', { class: 'v' }, p.preskriber || '-')),
            h('div', null, h('div', { class: 'label' }, 'Tarikh mula'), h('div', { class: 'v' }, fmt.date(p.tarikh_mula))),
            h('div', null, h('div', { class: 'label' }, 'Tarikh henti'), h('div', { class: 'v' }, fmt.date(p.tarikh_henti))),
            !minimal && h('div', { class: 'full' }, h('div', { class: 'label' }, 'Dos'), h('div', { class: 'v' }, p.dos || '-')),
            !minimal && h('div', { class: 'full' }, h('div', { class: 'label' }, 'Nota'), h('div', { class: 'v' }, p.nota || '-'))))),
      h('section', { class: 'card card-pad stack' },
        h('p', { class: 'label' }, 'Change Kategori'),
        next.length ? h('div', { class: 'sheet-actions' }, next.map((k) => h('button', { class: 'btn ghost', type: 'button', onClick: () => move(k) }, `Move to ${k}`))) : h('div', { class: 'sub' }, 'No moves allowed from here.'),
        next.some((k) => NEEDS_STOP_DATE.includes(k)) && field('Stop date (needed for Off or Defaulted)', stopInput),
        msg,
        !state.online && h('div', { class: 'notice' }, 'Offline: Kategori and dates can be queued. Other edits need a connection.')),
      !minimal && editForm(),
      !minimal && h('section', { class: 'card' }, h('p', { class: 'label card-pad' }, 'Change log'),
        h('ul', { class: 'list' }, log.length ? log.map((l) => h('li', { class: 'item' },
          h('div', { class: 'grow' }, h('div', { class: 'name' }, l.action === 'kategori' ? `${l.from} to ${l.to}` : l.action === 'create' ? `Added as ${l.to}` : `Edited: ${l.detail}`), h('div', { class: 'meta' }, `${fmt.dateTime(l.ts)} · ${l.username}`)))) : h('li', { class: 'empty' }, 'No changes yet.'))));
  };

  function editForm() {
    const f = { unit: p.unit, preskriber: p.preskriber, dos: p.dos, nota: p.nota, nama: p.nama, tarikh_mula: p.tarikh_mula || '' };
    const bind = (k, node) => { node.addEventListener('input', () => { f[k] = node.value; }); return node; };
    const unitSel = h('select', null, h('option', { value: '' }, '-'), UNITS.map((u) => h('option', { value: u, selected: u === f.unit }, u)));
    unitSel.addEventListener('change', () => { f.unit = unitSel.value; });
    const msg = h('div');
    return h('details', { class: 'card card-pad' }, h('summary', { class: 'label' }, 'Edit details (needs connection)'),
      h('div', { class: 'section' }),
      field('Name', bind('nama', h('input', { type: 'text', value: f.nama }))), field('Unit', unitSel),
      field('Preskriber', bind('preskriber', h('input', { type: 'text', value: f.preskriber }))), field('Dos', bind('dos', h('input', { type: 'text', value: f.dos }))),
      field('Tarikh mula', bind('tarikh_mula', h('input', { type: 'date', value: f.tarikh_mula }))), field('Nota', bind('nota', h('input', { type: 'text', value: f.nota }))),
      msg, h('button', { class: 'btn', type: 'button', onClick: async () => {
        try {
          await editPatient(id, p, { ...f, tarikh_mula: f.tarikh_mula || null });
          toast('Saved'); await reload();
        } catch (e) { clear(msg, h('div', { class: 'notice bad' }, e.message)); }
      } }, 'Save changes'));
  }

  async function reveal() {
    if (ic) { ic = null; clearTimeout(icTimer); paint(); return; }
    try {
      ic = await revealIc(id);
      paint();
      icTimer = setTimeout(() => { ic = null; paint(); }, 10000);
    } catch (e) { toast(e.message, true); }
  }

  async function reload() {
    p = await getPatient(id).catch(() => null);
    if (!p) { clear(box, h('div', { class: 'empty' }, state.online ? 'Patient not found.' : 'Not available offline.')); return; }
    log = p.minimal ? [] : await patientLog(id).catch(() => []);
    paint();
  }
  reload().catch((e) => clear(box, h('div', { class: 'notice bad' }, e.message)));
  return {
    el: h('div', null, h('a', { class: 'btn ghost', href: '#/patients' }, icon('back'), 'Patients'), h('div', { class: 'section' }), box),
    title: 'Patient',
    cleanup: () => { clearTimeout(icTimer); },
  };
}

export function newPatient() {
  const f = { no_kod: '', nama: '', ic: '', kategori: 'Waiting List', unit: '', preskriber: '', dos: '', tarikh_mula: '' };
  const bind = (k, node) => { node.addEventListener('input', () => { f[k] = node.value; }); node.addEventListener('change', () => { f[k] = node.value; }); return node; };
  const mahalOpts = searchDrugs('', 'mahal', 200).sort((a, b) => a.perihal.localeCompare(b.perihal));
  const msg = h('div');
  const el = h('div', { class: 'stack' }, h('a', { class: 'btn ghost', href: '#/patients' }, icon('back'), 'Patients'),
    h('div', { class: 'card card-pad' }, h('p', { class: 'label' }, 'Add patient (needs connection)'),
      field('Ubat Mahal drug', bind('no_kod', h('select', null, h('option', { value: '' }, 'Choose'), mahalOpts.map((d) => h('option', { value: d.no_kod }, d.perihal))))),
      field('Name', bind('nama', h('input', { type: 'text' }))), field('No Kad Pengenalan', bind('ic', h('input', { type: 'text', inputmode: 'numeric' }))),
      field('Kategori', bind('kategori', h('select', null, ['Waiting List', 'Active', 'Active - Pesara'].map((k) => h('option', { value: k }, k))))),
      field('Unit', bind('unit', h('select', null, h('option', { value: '' }, '-'), UNITS.map((u) => h('option', { value: u }, u))))),
      field('Preskriber', bind('preskriber', h('input', { type: 'text' }))), field('Dos', bind('dos', h('input', { type: 'text' }))),
      field('Tarikh mula', bind('tarikh_mula', h('input', { type: 'date' }))), msg,
      h('button', { class: 'btn block', type: 'button', onClick: async () => {
        try {
          if (!f.no_kod || !f.nama.trim()) { clear(msg, h('div', { class: 'notice bad' }, 'Choose the drug and enter the name.')); return; }
          await createPatient({ ...f, tarikh_mula: f.tarikh_mula || null });
          toast('Patient added');
          location.hash = `#/patients?drug=${encodeURIComponent(f.no_kod)}`;
        } catch (e) { clear(msg, h('div', { class: 'notice bad' }, e.message)); }
      } }, 'Add patient')));
  return { el, title: 'Add patient' };
}
