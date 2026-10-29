// Par level = approved floor-stock maximum for one drug at one location, summed across the unit's lists.
export const LIST_LABEL = { floor: 'Floor stock', dda: 'Psychotropic & DDA', aoh: 'After office hours', trolley: 'Emergency trolley', recovery: 'Recovery bay' };

export function groupPar(rows) {
  const out = new Map();
  for (const r of rows) {
    const key = `${r.drug}|${r.location}`;
    const g = out.get(key) || out.set(key, { drug: r.drug, location: r.location, par: 0, lists: [] }).get(key);
    g.par += r.max_qty;
    g.lists.push({ list: r.list, qty: r.max_qty, unit: r.sku_unit, note: r.note || '' });
  }
  return out;
}

// qty is undefined when no count or movement has ever reached this drug at this location.
export function parStatus(qty, par) {
  if (!par) return qty === undefined ? null : 'nopar';
  if (qty === undefined) return 'uncounted';
  return qty < par ? 'low' : 'ok';
}
export const STATUS_LABEL = { ok: 'OK', low: 'Low', uncounted: 'Not counted', nopar: 'No par' };
