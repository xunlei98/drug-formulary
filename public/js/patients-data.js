// Patient access. The minimal record (initials, last 4 of IC, kategori, dates) goes through the SDK and may be cached.
// Name, full IC, dose and notes live in patient_identity and only move over REST (rest.js), online.
import { db } from './fb.js';
import { doc, collection, query, where, getDoc, getDocs } from '/vendor/firebase.js';
import { state, audit, statKey } from './store.js';
import { getIdentity, identitiesFor, commit, setWrite, incrementWrite } from './rest.js';
import { splitPatient, patientId } from '/shared/importers.js';
import { uuid } from './dom.js';

const masked = (ic4) => `******-**-${ic4 || '????'}`;
const withMask = (id, m, ident) => ({ ...m, id, nama: ident?.nama || m.initials, ic: masked(m.ic4), dos: ident?.dos, nota: ident?.nota, minimal: !ident });

// Reads one document per patient. Pass a drug to read only that drug's patients.
export async function listPatients(noKod = null) {
  const q = noKod ? query(collection(db(), 'patients'), where('no_kod', '==', noKod)) : collection(db(), 'patients');
  const snap = await getDocs(q);
  let ids = null;
  if (noKod && navigator.onLine) ids = await identitiesFor(noKod).catch(() => null);
  return { rows: snap.docs.map((d) => withMask(d.id, d.data(), ids?.get(d.id))), named: !!ids, fromCache: snap.metadata.fromCache };
}

export async function getPatient(id) {
  const s = await getDoc(doc(db(), `patients/${id}`));
  if (!s.exists()) return null;
  const ident = navigator.onLine ? await getIdentity(id).catch(() => null) : null;
  return withMask(id, s.data(), ident);
}

export async function patientLog(id) {
  const snap = await getDocs(query(collection(db(), 'patient_log'), where('patient_id', '==', id)));
  return snap.docs.map((d) => ({ ...d.data(), ts: d.data().ts?.toDate?.().toISOString() })).sort((a, b) => ((a.ts || '') < (b.ts || '') ? 1 : -1));
}

// Full IC on request, logged in the audit trail. Never cached.
export async function revealIc(id) {
  const ident = await getIdentity(id);
  audit('patient.reveal_ic', id);
  return ident?.ic || null;
}

const log = (pid, action, from, to, detail = null) =>
  setWrite(`patient_log/${uuid()}`, { patient_id: pid, uid: state.user.uid, username: state.user.username, action, from, to, detail }, { serverTime: ['ts'] });
const today = () => new Date().toISOString().slice(0, 10);

// One atomic REST commit: minimal record, identity, log entry and the quota counter.
export async function createPatient(f) {
  const key = uuid();
  const id = patientId(key);
  const { minimal, identity } = splitPatient({ ...f, key_id: key, tarikh_kemaskini: today() });
  await commit([
    setWrite(`patients/${id}`, { ...minimal, updated_by: state.user.username }, { mustNotExist: true }),
    setWrite(`patient_identity/${id}`, identity, { mustNotExist: true }),
    log(id, 'create', null, minimal.kategori),
    incrementWrite('stats/counts', [[['byKey', statKey(minimal.no_kod, minimal.unit, minimal.kategori)], 1]]),
  ]);
  audit('patient.create', id);
  return id;
}

// Edit of the non-kategori fields. Needs a connection because the identity part is involved.
export async function editPatient(id, prev, f) {
  const minimalPatch = { unit: f.unit || '', preskriber: f.preskriber || '', tarikh_mula: f.tarikh_mula || null, tarikh_kemaskini: today(), updated_by: state.user.username };
  if (f.nama) minimalPatch.initials = splitPatient({ nama: f.nama }).minimal.initials;
  const identPatch = { nama: f.nama, dos: f.dos || '', nota: f.nota || '' };
  const writes = [
    setWrite(`patients/${id}`, minimalPatch, { mask: Object.keys(minimalPatch) }),
    setWrite(`patient_identity/${id}`, identPatch, { mask: Object.keys(identPatch) }),
    log(id, 'edit', null, null, 'details'),
  ];
  if ((prev.unit || '') !== minimalPatch.unit) {
    writes.push(incrementWrite('stats/counts', [[['byKey', statKey(prev.no_kod, prev.unit, prev.kategori)], -1], [['byKey', statKey(prev.no_kod, minimalPatch.unit, prev.kategori)], 1]]));
  }
  await commit(writes);
}

// Admin recount of stats/counts from the minimal records (one read per patient).
export async function recountStats() {
  const snap = await getDocs(collection(db(), 'patients'));
  const byKey = {};
  for (const d of snap.docs) { const p = d.data(); const k = statKey(p.no_kod, p.unit, p.kategori); byKey[k] = (byKey[k] || 0) + 1; }
  await commit([setWrite('stats/counts', { byKey })]);
  return snap.size;
}
