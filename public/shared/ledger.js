export const MOVEMENT_TYPES = ['receive', 'transfer', 'issue', 'adjust', 'stocktake'];

const SHAPE = {
  receive: { from: false, to: true },
  transfer: { from: true, to: true },
  issue: { from: true, to: false },
  stocktake: { from: false, to: true },
};

export function validateShape(m) {
  if (!m || typeof m.id !== 'string' || m.id.length < 8) return 'bad id';
  if (typeof m.drug !== 'string' || !m.drug) return 'drug required';
  if (!MOVEMENT_TYPES.includes(m.type)) return 'bad type';
  if (!Number.isInteger(m.qty)) return 'qty must be a whole number';
  if (m.type === 'stocktake' ? m.qty < 0 : m.qty <= 0) return m.type === 'stocktake' ? 'count cannot be negative' : 'qty must be above 0';
  const from = m.from || null;
  const to = m.to || null;
  if (m.type === 'adjust') {
    if (!from === !to) return 'adjust needs exactly one of from or to';
  } else {
    const need = SHAPE[m.type];
    if (need.from !== !!from) return need.from ? 'from location required' : 'from location not allowed';
    if (need.to !== !!to) return need.to ? 'to location required' : 'to location not allowed';
  }
  if (from && from === to) return 'from and to must differ';
  return null;
}

export const keyOf = (drug, loc) => `${drug}|${loc}`;

export function deltas(m) {
  const out = [];
  if (m.type === 'stocktake') return out;
  if (m.from) out.push([keyOf(m.drug, m.from), -m.qty]);
  if (m.to) out.push([keyOf(m.drug, m.to), m.qty]);
  return out;
}

export function applyMovement(balances, m) {
  if (m.type === 'stocktake') {
    const k = keyOf(m.drug, m.to);
    const before = balances.get(k) || 0;
    balances.set(k, m.qty);
    return { variance: m.qty - before };
  }
  for (const [k, d] of deltas(m)) balances.set(k, (balances.get(k) || 0) + d);
  return {};
}

export function negativesAfter(balances, m) {
  const out = [];
  for (const [k, d] of deltas(m)) {
    const after = (balances.get(k) || 0) + d;
    if (after < 0) out.push({ key: k, after });
  }
  return out;
}

export function rebuild(movements) {
  const b = new Map();
  for (const m of movements) applyMovement(b, m);
  return b;
}

export function inverseOf(m, newId) {
  if (m.type === 'stocktake') return null;
  const map = { receive: 'issue', issue: 'receive', transfer: 'transfer', adjust: 'adjust' };
  const swap = m.type === 'transfer' ? { from: m.to, to: m.from } : { from: m.to || null, to: m.from || null };
  return { id: newId, drug: m.drug, type: map[m.type], qty: m.qty, ...swap, reverses: m.id };
}

export function isInverse(orig, m) {
  const inv = inverseOf(orig, m.id);
  return !!inv && inv.drug === m.drug && inv.type === m.type && inv.qty === m.qty
    && (inv.from || null) === (m.from || null) && (inv.to || null) === (m.to || null);
}
