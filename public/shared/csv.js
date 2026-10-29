export function parseTable(text) {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0];
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function parseRecords(text, required) {
  const rows = parseTable(text);
  if (!rows.length) throw new Error('No rows found');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const missing = required.filter((r) => !head.includes(r.toLowerCase()));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
  return rows.slice(1).map((r, i) => ({
    line: i + 2,
    get: (name) => (r[head.indexOf(name.toLowerCase())] ?? '').trim(),
  }));
}

export function num(v) {
  const s = String(v).replace(/[,\s]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isNaN(n) ? NaN : n;
}

export function isoDate(v) {
  const s = String(v).trim();
  if (!s) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}
