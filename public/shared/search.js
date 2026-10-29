const WORD = /[a-z0-9]+/g;

export function indexDrug(d) {
  const text = [d.perihal, d.brand, d.kod_phis, d.no_kod].join(' ').toLowerCase();
  return { drug: d, text, words: text.match(WORD) || [], name: (d.perihal || '').toLowerCase() };
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function tokenScore(t, entry) {
  const at = entry.text.indexOf(t);
  if (at >= 0) {
    const wordStart = at === 0 || !/[a-z0-9]/.test(entry.text[at - 1]);
    return (wordStart ? 100 : 60) - Math.min(at, 40) / 4;
  }
  if (t.length < 4) return 0;
  const allow = t.length >= 7 ? 2 : 1;
  let best = 9;
  for (const w of entry.words) best = Math.min(best, distance(t, w), distance(t, w.slice(0, t.length)));
  return best <= allow ? 40 - best * 8 : 0;
}

export function search(index, query, limit = 50) {
  const tokens = (query.toLowerCase().match(WORD) || []);
  if (!tokens.length) return [];
  const hits = [];
  for (const entry of index) {
    let total = 0;
    for (const t of tokens) {
      const s = tokenScore(t, entry);
      if (!s) { total = 0; break; }
      total += s;
    }
    if (total) hits.push({ drug: entry.drug, score: total + (entry.name.startsWith(tokens[0]) ? 20 : 0) });
  }
  hits.sort((a, b) => b.score - a.score || a.drug.perihal.localeCompare(b.drug.perihal));
  return hits.slice(0, limit).map((h) => h.drug);
}
