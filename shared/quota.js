export const COUNTED = ['Active', 'Active - Pesara'];
export const WAITING = 'Waiting List';

export function status(used, quota, nearPct = 80) {
  if (quota === null || quota === undefined) return 'none';
  if (used > quota) return 'over';
  if (used === quota) return 'full';
  return used * 100 >= quota * nearPct ? 'near' : 'ok';
}

export function summarize(quota, patients, nearPct) {
  const used = patients.filter((p) => COUNTED.includes(p.kategori)).length;
  const waiting = patients.filter((p) => p.kategori === WAITING).length;
  return {
    quota,
    used,
    waiting,
    remaining: quota === null || quota === undefined ? null : quota - used,
    status: status(used, quota, nearPct),
  };
}

export function byUnit(unitQuotas, patients, nearPct) {
  const units = new Set([...unitQuotas.map((u) => u.unit), ...patients.map((p) => p.unit).filter(Boolean)]);
  return [...units].sort().map((unit) => {
    const q = unitQuotas.filter((u) => u.unit === unit).reduce((s, u) => s + u.kuantiti, 0);
    const has = unitQuotas.some((u) => u.unit === unit);
    return { unit, ...summarize(has ? q : null, patients.filter((p) => p.unit === unit), nearPct) };
  });
}
