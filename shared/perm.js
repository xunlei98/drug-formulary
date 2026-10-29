export const ROLES = ['admin', 'pharmacist', 'ward'];

const PHARMACIST = [
  'drug.view', 'drug.edit', 'stock.view', 'stock.log', 'quota.view', 'quota.edit',
  'patient.view', 'patient.edit', 'patient.fullic',
];

const TABLE = {
  ward: ['drug.view', 'stock.view', 'stock.log', 'quota.view'],
  pharmacist: PHARMACIST,
  admin: [...PHARMACIST, 'user.manage', 'location.manage', 'import.run', 'audit.view'],
};

export const can = (role, perm) => !!TABLE[role]?.includes(perm);

export function subtree(locations, rootId) {
  const out = new Set();
  const walk = (id) => {
    if (out.has(id)) return;
    out.add(id);
    for (const l of locations) if (l.parent_id === id) walk(l.id);
  };
  if (rootId) walk(rootId);
  return out;
}

// null means unrestricted. A Set limits stock reads to those location ids.
export function viewScope(user, locations, wardStockScope = 'own') {
  if (user.role !== 'ward' || wardStockScope === 'all') return null;
  return subtree(locations, user.location_id);
}

export function canLog(user, m, locations) {
  if (!can(user.role, 'stock.log')) return false;
  if (user.role !== 'ward') return true;
  const own = subtree(locations, user.location_id);
  return [m.from, m.to].filter(Boolean).some((l) => own.has(l));
}
