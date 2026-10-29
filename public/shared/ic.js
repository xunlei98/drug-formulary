export function maskIc(ic) {
  if (!ic) return '';
  const digits = ic.replace(/\D/g, '');
  if (digits.length < 4) return '*'.repeat(ic.length);
  return `******-**-${digits.slice(-4)}`;
}
