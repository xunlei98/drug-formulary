import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Parses `pdftotext -layout` output of the "Senarai Floor Stock 2026" PDFs and matches rows to the formulary.

const LISTS = [
  [/Psikotropik|Dadah Berbahaya/i, 'dda'],
  [/After Office/i, 'aoh'],
  [/Emergency Trolley/i, 'trolley'],
  [/Recovery Bay/i, 'recovery'],
  [/Floor Stock/i, 'floor'],
];
export const LIST_LABEL = { floor: 'Floor stock', dda: 'Psychotropic & DDA', aoh: 'After office hours', trolley: 'Emergency trolley', recovery: 'Recovery bay' };

const FULL = /^\s{0,6}(\d{1,3})\s{2,}(\S.*?)\s{2,}([A-Za-z][A-Za-z]{0,11})(?:\s{2,}(\d[\d,]*))?(?:\s{2,}(\S.*))?$/;
const BARE = /^\s{0,6}(\d{1,3})\s{2,}([A-Za-z][A-Za-z]{0,11})(?:\s{2,}(\d[\d,]*))?(?:\s{2,}(\S.*))?$/;
const CONT_QTY = /^\s{6,}(\S.*?)\s{2,}(\d[\d,]*)\s*$/;
const CONT = /^\s{6,}(\S.*?)\s*$/;
const qtyOf = (s) => (s ? +s.replace(/,/g, '') : null);
const STOP = /^(Nota:|Pihak Wad|Pemohon|Farmasi|Pegawai|Tarikh|Diluluskan|Ketua)/;

export function parseFloorStock(text) {
  const rows = [];
  let list = null;
  let inTable = false;
  let prefix = null;
  let last = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const title = /Senarai (.+?) 2026/.exec(line);
    if (title) { list = (LISTS.find(([re]) => re.test(title[1])) || [null, 'floor'])[1]; inTable = false; last = null; prefix = null; return; }
    if (/^\s*Maksimum\b/.test(line) || /^\s*Bil\s/.test(line)) { inTable = list !== null; return; }
    if (!inTable || !line.trim()) return;
    if (STOP.test(line.trim())) { inTable = false; last = null; prefix = null; return; }
    let m = FULL.exec(line);
    if (m) {
      last = { list, bil: +m[1], name: m[2].trim(), unit: m[3].trim(), max: qtyOf(m[4]), note: (m[5] || '').trim(), line: i + 1 };
      if (prefix) { last.name = `${prefix} ${last.name}`; prefix = null; }
      rows.push(last);
      return;
    }
    m = BARE.exec(line);
    if (m) {
      last = { list, bil: +m[1], name: prefix || '', unit: m[2].trim(), max: qtyOf(m[3]), note: (m[4] || '').trim(), line: i + 1, wrapped: true };
      prefix = null;
      rows.push(last);
      return;
    }
    m = CONT_QTY.exec(line);
    if (m && last && last.max === null) {
      last.name = `${last.name} ${m[1]}`.trim(); last.max = qtyOf(m[2]); last.wrapped = false;
      return;
    }
    m = CONT.exec(line);
    if (m) {
      if (BARE.test(lines[i + 1] || '')) prefix = m[1];
      else if (last?.wrapped) { last.name = `${last.name} ${m[1]}`.trim(); last.wrapped = false; }
      else prefix = m[1];
      return;
    }
    // Section headings such as "Tablets" or "Injectables" reset any half-built wrap.
    prefix = null;
    if (last) last.wrapped = false;
  });
  return rows.map(({ wrapped, ...r }) => r);
}

const SPELLING = { hci: 'hcl', lnjection: 'injection', inj: 'injection', lnj: 'injection', opthalmic: 'ophthalmic', trandermal: 'transdermal', mls: 'ml', ug: 'mcg' };
export function norm(s) {
  return String(s).toLowerCase()
    .replace(/\*+/g, '')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\s*\/\s*/g, '/')
    .replace(/(\d)\s+(mg|g|mcg|ml|iu|miu|%|units?|mmol)(?![a-z])/g, '$1$2')
    .replace(/[^a-z0-9.%/+]+/g, ' ')
    .split(' ').filter(Boolean).map((t) => SPELLING[t] || t).join(' ');
}
const PACKS = ['vial', 'penfill', 'cartridge', 'pen', 'ampoule', 'prefilled'];
const tokens = (s) => new Set(norm(s).split(' '));
const numbers = (s) => new Set((norm(s).match(/\d+(?:\.\d+)?/g) || []));

function dice(a, b) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return (2 * n) / (a.size + b.size || 1);
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Strengths must agree exactly; a name that only shares the molecule is not the same item.
export function matchRow(name, index) {
  const key = norm(name);
  const exact = index.byNorm.get(key);
  if (exact) return { drug: exact, match: 'exact', score: 1 };
  const t = tokens(name);
  const nums = numbers(name);
  const head = key.split(' ').find((w) => /^[a-z]{3,}$/.test(w));
  const packs = PACKS.filter((p) => t.has(p));
  let best = null;
  for (const d of index.items) {
    if (!sameSet(nums, d.nums) || (head && !d.tokens.has(head))) continue;
    if (packs.length && PACKS.some((p) => d.tokens.has(p)) && !packs.some((p) => d.tokens.has(p))) continue;
    const s = dice(t, d.tokens);
    if (!best || s > best.score) best = { drug: d.no_kod, score: s };
  }
  if (!best || best.score < 0.6) return { drug: null, match: 'none', score: best ? +best.score.toFixed(2) : 0 };
  return { drug: best.drug, match: best.score >= 0.8 ? 'high' : 'low', score: +best.score.toFixed(2) };
}

export function buildIndex(drugs) {
  const byNorm = new Map();
  for (const d of drugs) if (!byNorm.has(norm(d.perihal))) byNorm.set(norm(d.perihal), d.no_kod);
  return { byNorm, items: drugs.map((d) => ({ no_kod: d.no_kod, tokens: tokens(d.perihal), nums: numbers(d.perihal) })) };
}

// Nearest formulary names for a row nobody could match, to help the reviewer.
export function suggest(name, drugs, n = 2) {
  const t = tokens(name);
  return drugs.map((d) => ({ d, s: dice(t, tokens(d.perihal)) })).sort((a, b) => b.s - a.s).slice(0, n).filter((x) => x.s > 0.3).map((x) => x.d);
}

// Server-side PDF to text. Needs poppler-utils (pdftotext) on the host.
export function pdfToText(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floorstock-'));
  try {
    const file = path.join(dir, 'list.pdf');
    fs.writeFileSync(file, buffer);
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', timeout: 20000, maxBuffer: 8_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('pdftotext is not installed on the server. Install poppler-utils, or paste the PDF text instead.');
    throw new Error('Could not read that PDF.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
