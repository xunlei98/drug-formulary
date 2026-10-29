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
