// Patient identities (name, IC) go over the Firestore REST API with no-store, so they are never written
// to the SDK's IndexedDB cache or its offline write queue. Online only, by design.
import { auth, PROJECT_ID, FIRESTORE_ORIGIN } from './fb.js';

const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const BASE = `${FIRESTORE_ORIGIN}/v1/${ROOT}`;
export const docName = (path) => `${ROOT}/${path}`;

export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: fields(v) } };
}
export const fields = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]));

export function decode(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return unfields(v.mapValue.fields || {});
  return null;
}
const unfields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));
const fromDoc = (d) => ({ id: d.name.split('/').pop(), ...unfields(d.fields || {}) });

async function call(path, init = {}) {
  if (!navigator.onLine) throw new Error('Names and IC numbers are only shown online.');
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init, cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(res.status === 403 ? 'Not allowed.' : body.error?.message || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return body;
}

export async function getIdentity(id) {
  const d = await call(`/patient_identity/${encodeURIComponent(id)}`);
  return d ? fromDoc(d) : null;
}

export async function identitiesFor(noKod) {
  const rows = await call(':runQuery', {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'patient_identity' }], where: { fieldFilter: { field: { fieldPath: 'no_kod' }, op: 'EQUAL', value: { stringValue: noKod } } } } }),
  });
  return new Map(rows.filter((r) => r.document).map((r) => { const d = fromDoc(r.document); return [d.id, d]; }));
}

// Field paths in a transform must quote segments that are not plain identifiers.
export const quotePath = (...segs) => segs.map((s) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : `\`${s.replace(/[\\`]/g, (c) => `\\${c}`)}\``)).join('.');

// writes: Firestore REST Write objects. All succeed or none (one atomic commit).
export async function commit(writes) {
  return call(':commit', { method: 'POST', body: JSON.stringify({ writes }) });
}

export const setWrite = (path, data, { mustNotExist = false, mask = null, serverTime = [] } = {}) => ({
  update: { name: docName(path), fields: fields(data) },
  ...(mask ? { updateMask: { fieldPaths: mask } } : {}),
  ...(mustNotExist ? { currentDocument: { exists: false } } : {}),
  ...(serverTime.length ? { updateTransforms: serverTime.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })) } : {}),
});

export const incrementWrite = (path, deltas) => ({
  transform: { document: docName(path), fieldTransforms: deltas.map(([segs, n]) => ({ fieldPath: quotePath(...segs), increment: { integerValue: String(n) } })) },
});
