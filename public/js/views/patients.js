import { h, icon, clear, fmt, uuid } from '../dom.js';
import { state, searchDrugs, changeKategori, submitOps, refresh, pendingFor } from '../store.js';
import { get, post } from '../api.js';
import { stat, tile, chips, toast } from '../ui.js';
import { KATEGORI, UNITS, NEEDS_STOP_DATE, nextStates } from '/shared/patient-state.js';
import { COUNTED } from '/shared/quota.js';

const KAT_CLASS = { Active: 's-ok', 'Active - Pesara': 's-ok', 'Waiting List': 's-near', Off: 's-none', Defaulted: 's-over' };
const kategoriPill = (k) => h('span', { class: `pill ${KAT_CLASS[k] || ''}` }, k);


async function load() {
  try {
    const { patients } = await get('/api/patients');
    return { rows: patients, full: true };
  } catch (e) {
    if (!e.offline) throw e;
    return { rows: state.patients.map((p) => ({ ...p, nama: p.initials, ic: `******-**-${p.ic4}`, minimal: true })), full: false };
  }
}


export function patients(_, query) {
  let kat = 'all';
  let drug = query.get('drug') || 'all';
  let unit = 'all';
  let q = '';
  let data = { rows: [], full: true };
  const banner = h('div');
  const hero = h('div');
  const list = h('ul', { class: 'list' });
  const input = h('input', { type: 'search', placeholder: 'Name, initials or last 4 of IC', 'aria-label': 'Filter patients' });
  const drugSel = h('select', { 'aria-label': 'Drug' });
  const unitSel = h('select', { 'aria-label': 'Unit' });

  const paint = () => {
    const pend = new Map(pendingFor().filter((o) => o.kind === 'patient_update' && o.patch.kategori).map((o) => [o.patient_id, o.patch.kategori]));
    const all = data.rows.map((p) => (pend.has(p.id) ? { ...p, kategori: pend.get(p.id), pending: true } : p));
    const rows = all.filter((p) => (kat === 'all' || p.kategori === kat) && (drug === 'all' || p.no_kod === drug) && (unit === 'all' || p.unit === unit)
      && (!q || `${p.nama} ${p.ic}`.toLowerCase().includes(q.toLowerCase())));
    const counted = all.filter((p) => COUNTED.includes(p.kategori)).length;
    clear(hero, stat('Ubat Mahal patients on drug', fmt.n(counted), h('small', null, ` · ${all.filter((p) => p.kategori === 'Waiting List').length} waiting`)));
    clear(banner, !data.full && h('div', { class: 'notice warn' }, 'Offline view: initials only. Names, doses and notes need a connection.'));
    clear(list, rows.length ? rows.slice(0, 300).map((p) => h('li', null, h('a', { class: 'item', href: `#/patient/${p.id}` },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.nama), h('div', { class: 'meta' }, h('span', { class: 'mono' }, p.ic || ''), ` · ${state.drugMap.get(p.no_kod)?.perihal || p.no_kod} · ${p.unit || '-'}`)),
      p.pending && h('span', { class: 'pill s-near' }, 'Pending'), kategoriPill(p.kategori), icon('chevron'))))
      : h('li', { class: 'empty' }, state.patients.length || data.rows.length ? 'No patients match these filters.' : 'No patients to show.'));
  };

  clear(drugSel, h('option', { value: 'all' }, 'All drugs'), [...state.mahal.keys()].map((k) => h('option', { value: k, selected: k === drug }, state.drugMap.get(k)?.perihal || k)).sort((a, b) => a.textContent.localeCompare(b.textContent)));
  clear(unitSel, h('option', { value: 'all' }, 'All units'), UNITS.map((u) => h('option', { value: u }, u)));
  drugSel.addEventListener('change', () => { drug = drugSel.value; paint(); });
  unitSel.addEventListener('change', () => { unit = unitSel.value; paint(); });
  input.addEventListener('input', () => { q = input.value; paint(); });

  const el = h('div', null, hero, h('div', { class: 'section' }), banner,
    h('div', { class: 'search' }, icon('search'), input),
    chips([['all', 'All'], ...KATEGORI.map((k) => [k, k])], kat, (v) => { kat = v; paint(); }),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, drugSel), h('div', { class: 'grow' }, unitSel)),
    h('div', { class: 'section' }),
    h('div', { class: 'card' }, list),
    h('p', null, h('a', { class: 'btn', href: '#/patient/new' }, icon('plus'), 'Add patient')));
  load().then((d) => { data = d; paint(); }).catch((e) => clear(list, h('li', { class: 'empty' }, e.message)));
  paint();
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
      const r = await changeKategori(id, patch);
      if (r.status === 'rejected') { clear(msg, h('div', { class: 'notice bad' }, r.reason)); return; }
      toast(r.status === 'queued' ? 'Saved on this device. Syncs when online.' : r.warning ? `Saved. ${r.warning}` : 'Saved');
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
          h('div', { class: 'grow' }, h('div', { class: 'name' }, l.action === 'kategori' ? `${l.from_kategori} to ${l.to_kategori}` : l.action === 'create' ? `Added as ${l.to_kategori}` : `Edited: ${l.detail}`), h('div', { class: 'meta' }, `${fmt.dateTime(l.ts)} · ${l.username}`)))) : h('li', { class: 'empty' }, 'No changes yet.'))));
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
          const [r] = await submitOps([{ id: uuid(), kind: 'patient_update', patient_id: id, patch: { ...f, tarikh_mula: f.tarikh_mula || null } }], 'live');
          if (r.status === 'rejected') { clear(msg, h('div', { class: 'notice bad' }, r.reason)); return; }
          toast('Saved'); await reload(); refresh().catch(() => {});
        } catch (e) { clear(msg, h('div', { class: 'notice bad' }, e.offline ? 'Needs a connection.' : e.message)); }
      } }, 'Save changes'));
  }

  async function reveal() {
    if (ic) { ic = null; clearTimeout(icTimer); paint(); return; }
    try {
      ic = (await post(`/api/patients/${id}/reveal-ic`)).ic;
      paint();
      icTimer = setTimeout(() => { ic = null; paint(); }, 10000);
    } catch (e) { toast(e.offline ? 'Needs a connection' : e.message, true); }
  }

  async function reload() {
    try {
      p = await get(`/api/patients/${id}`);
      log = (await get(`/api/patients/${id}/log`)).log;
    } catch (e) {
      if (!e.offline) throw e;
      const m = state.patients.find((x) => x.id === id);
      p = m ? { ...m, nama: m.initials, ic: `******-**-${m.ic4}`, minimal: true } : null;
      if (!p) clear(box, h('div', { class: 'empty' }, 'Not available offline.'));
    }
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
          const [r] = await submitOps([{ id: uuid(), kind: 'patient_create', patient: { ...f, tarikh_mula: f.tarikh_mula || null } }], 'live');
          if (r.status === 'rejected') { clear(msg, h('div', { class: 'notice bad' }, r.reason)); return; }
          toast(r.warning ? `Added. ${r.warning}` : 'Patient added');
          await refresh(); location.hash = '#/patients';
        } catch (e) { clear(msg, h('div', { class: 'notice bad' }, e.offline ? 'Adding patients needs a connection.' : e.message)); }
      } }, 'Add patient')));
  return { el, title: 'Add patient' };
}
