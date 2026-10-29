// Drug cards and the Notion-style property list, built from drugView() (MASTER first, old sheet second).
import { h, fmt } from './dom.js';
import { drugView, prescriberTone, procurementTone } from '/shared/druginfo.js';

export const DISCLAIMER = 'Images are for illustration only and may not be the actual brand our pharmacy is getting.';

// A picture, or a grey block when there is none or it fails to load.
export function photo(url, cls) {
  const box = h('div', { class: `ph ${cls}` });
  if (url) box.append(h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onError: (e) => e.target.remove() }));
  return box;
}

const pill = (text, tone) => (text ? h('span', { class: `pill ${tone}` }, text) : null);
const line = (text, cls = '') => (text ? h('div', { class: `ln ${cls}` }, String(text).split('\n')[0]) : null);

export function drugCard(d, extra) {
  const v = drugView(d);
  return h('a', { class: 'dcard', href: `#/drug/${encodeURIComponent(d.no_kod)}` },
    photo(v.pack_img || v.img, 'ph-card'),
    h('div', { class: 'dbody' },
      h('div', { class: 'dname' }, d.perihal),
      line(v.brand), line(v.pharm_cat),
      v.prescriber_cat && h('div', null, pill(v.prescriber_cat, prescriberTone(v.prescriber_cat))),
      line(v.indications), line(v.dosage),
      line(v.phis || d.no_kod, 'mono'),
      h('div', { class: 'pills' }, pill(v.procurement, procurementTone(v.procurement)), v.old_sheet_only && pill('Old formulary only', 's-none'), extra)));
}

const text = (s) => (s == null || s === '' ? null : String(s));
const CLINICAL = [
  ['Brand', (v) => text(v.brand)],
  ['Form', (v) => pill(v.form, 's-ok')],
  ['Pharmacologic Category', (v) => text(v.pharm_cat)],
  ['Prescriber Category', (v) => pill(v.prescriber_cat, prescriberTone(v.prescriber_cat))],
  ['Indications', (v) => text(v.indications), true],
  ['Dosage', (v) => text(v.dosage), true],
  ['Dilution', (v) => text(v.dilution), true],
  ['Renal Dosage Adjustment', (v) => text(v.renal), true],
  ['Pregnancy', (v) => text(v.pregnancy), true],
  ['Breastfeeding', (v) => text(v.breastfeeding), true],
];
const num = (n) => (n == null ? null : fmt.n(n));
const money = (n) => (n == null ? null : fmt.money(n));
const SUPPLY = [
  ['Kategori', (v, d) => text(d.kategori)],
  ['PhIS Code', (v) => text(v.phis), false, 'mono'],
  ['No Kod', (v, d) => text(d.no_kod), false, 'mono'],
  ['Procurement', (v) => pill(v.procurement, procurementTone(v.procurement))],
  ['Group', (v) => text(v.group)],
  ['Packaging', (v) => text(v.packaging)],
  ['SKU', (v) => text(v.sku)],
  ['Price Per Pack', (v) => money(v.price_pack)],
  ['Price Per Unit', (v) => money(v.price_unit)],
  ['Keep Buffer', (v) => (v.keep_buffer == null ? null : v.keep_buffer ? 'Yes' : 'No')],
  ['Source of Origin', (v) => text(v.origin)],
  ['Yearly', (v, d) => num(d.yearly)], ['Monthly', (v, d) => num(d.monthly)],
  ['Min', (v, d) => num(d.min)], ['Max', (v, d) => num(d.max)], ['Buffer', (v, d) => num(d.buffer)],
];

const LONG = 280;
function value(content, long, cls = '') {
  if (content == null) return h('div', { class: 'pv empty-v' }, 'Empty');
  const el = h('div', { class: `pv ${cls}` }, content);
  if (!long || typeof content !== 'string' || (content.length < LONG && content.split('\n').length <= 6)) return el;
  el.classList.add('clamp');
  const more = h('button', { class: 'more', type: 'button', 'aria-expanded': 'false', onClick: () => {
    const open = el.classList.toggle('clamp') === false;
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? 'Show less' : 'Show more';
  } }, 'Show more');
  return h('div', { class: 'pv-wrap' }, el, more);
}

const rows = (list, v, d) => list.map(([label, get, long, cls]) => h('div', { class: 'prow' }, h('div', { class: 'pl' }, label), value(get(v, d), long, cls)));

export function drugHeader(d) {
  const v = drugView(d);
  const pics = [v.pack_img, v.img].filter(Boolean);
  return h('div', { class: 'dhead' },
    pics.length ? h('div', { class: 'dpics' }, pics.map((u) => photo(u.replace(/=w400$/, '=w600'), 'ph-head'))) : null,
    h('h2', { class: 'dtitle' }, d.perihal),
    v.old_sheet_only && h('p', null, h('span', { class: 'pill s-near' }, 'Old formulary only · not in current stock list')),
    h('div', { class: 'props', 'aria-label': 'Drug information' }, rows(CLINICAL, v, d),
      h('p', { class: 'label psec' }, 'Supply'), rows(SUPPLY, v, d)),
    pics.length ? h('p', { class: 'sub' }, DISCLAIMER) : null);
}
