// Kad Stok (KEW.PS stock card, Bahagian B) for one drug at one location, built from the ledger with no extra reads.
// A movement keeps its type; the card only decides which column (Terimaan or Keluaran) it lands in, seen from `loc`.

export const DOC_TYPES = ['PK', 'BTB', 'BPSS', 'BPSI', 'BPIN', 'LAIN'];
export const DOC_LABEL = {
  PK: 'Pesanan Kerajaan', BTB: 'Borang Terimaan Barang-barang', BPSS: 'Borang Permohonan Stok (KEW.PS-7)',
  BPSI: 'Borang Permohonan Stok (KEW.PS-8)', BPIN: 'Borang Pindahan Stok (KEW.PS-17)', LAIN: 'Lain-lain',
};

// Optional card fields on a movement. Old movements have none of them and still display.
export function validateCardFields(m) {
  if (m.doc_type != null && !DOC_TYPES.includes(m.doc_type)) return 'bad document type';
  if (m.doc_no != null && (typeof m.doc_no !== 'string' || m.doc_no.length > 40)) return 'document number too long';
  if (m.party != null && (typeof m.party !== 'string' || m.party.length > 120)) return 'Terima Daripada / Keluar Kepada too long';
  if (m.tarikh != null && !/^\d{4}-\d{2}-\d{2}$/.test(m.tarikh)) return 'bad Tarikh';
  if (m.unit_price != null && !(typeof m.unit_price === 'number' && Number.isFinite(m.unit_price) && m.unit_price >= 0 && m.unit_price <= 1e6)) return 'Seunit (RM) must be 0 to 1,000,000';
  return null;
}

const money = (n) => Math.round(n * 100) / 100;

// movements: oldest first, any drug/location (filtered here). opening: balance before the first of them (checkpoint).
// name(locId) gives a location's display name.
export function cardRows(movements, { drug, loc, opening = 0, name = (x) => x }) {
  let baki = opening;
  let price = null; // last Seunit seen on this card, used for Keluaran and Baki RM
  const partyOf = new Map(); // movement id -> its Terima Daripada / Keluar Kepada, so a reversal names what it cancels
  const rows = [];
  for (const m of movements) {
    if (m.drug !== drug || (m.from !== loc && m.to !== loc)) continue;
    const before = baki;
    let inQty = null;
    let outQty = null;
    let party;
    if (m.type === 'stocktake') {
      baki = m.qty;
      const v = m.qty - before;
      if (v > 0) inQty = v; else if (v < 0) outQty = -v;
      party = `Kiraan stok: ${m.qty}`;
    } else if (m.to === loc) {
      inQty = m.qty; baki += m.qty;
      party = m.from ? name(m.from) : m.type === 'adjust' ? 'Pelarasan' : 'Pembekal / luar';
    } else {
      outQty = m.qty; baki -= m.qty;
      party = m.to ? name(m.to) : m.type === 'adjust' ? 'Pelarasan' : 'Pesakit / luar';
    }
    if (m.party) party = party && m.type !== 'receive' && m.type !== 'issue' ? `${party} (${m.party})` : m.party;
    if (m.reverses) party = `Batal: ${partyOf.get(m.reverses) || party}`;
    partyOf.set(m.id, party);
    if (m.unit_price != null) price = m.unit_price;
    const p = m.unit_price ?? price;
    rows.push({
      id: m.id, pending: !!m.pending, type: m.type, tarikh: m.tarikh || (m.server_time || '').slice(0, 10) || null,
      doc: m.doc_type ? `${m.doc_type === 'LAIN' ? '' : m.doc_type + ' '}${m.doc_no || ''}`.trim() || m.doc_type : m.doc_no || null,
      party: party || '-', note: m.note || '',
      inQty, inPrice: inQty != null ? m.unit_price ?? null : null, inRm: inQty != null && m.unit_price != null ? money(inQty * m.unit_price) : null,
      outQty, outRm: outQty != null && p != null ? money(outQty * p) : null,
      baki, bakiRm: p != null ? money(baki * p) : null, negative: baki < 0,
      pegawai: m.username || '-',
    });
  }
  return { opening, rows, baki };
}

// The last `show` rows, like the bottom of a paper card, with the balance brought forward onto it.
export function pageOf(card, show) {
  const start = Math.max(0, card.rows.length - show);
  const bf = start === 0 ? card.opening : card.rows[start - 1].baki;
  const bfRm = start === 0 ? null : card.rows[start - 1].bakiRm;
  return { bf, bfRm, rows: card.rows.slice(start), older: start };
}

// The entry form follows the card: a direction (Terimaan, Keluaran or Kiraan stok) and who it is with.
// `with` is a location id (a transfer), 'text' (supplier, patient or anyone outside the app: receive or issue)
// or 'adjust' (a stock correction). The result is an ordinary movement plus the optional card fields.
export function entryToMovement(e) {
  const m = { drug: e.drug, qty: e.qty };
  for (const k of ['note', 'tarikh', 'doc_type', 'doc_no']) if (e[k]) m[k] = e[k];
  if (e.unit_price != null && e.unit_price !== '' && e.dir === 'in') m.unit_price = Number(e.unit_price);
  if (e.dir === 'count') return { ...m, type: 'stocktake', to: e.loc };
  const here = e.dir === 'in' ? 'to' : 'from';
  const there = e.dir === 'in' ? 'from' : 'to';
  if (e.with === 'adjust') return { ...m, type: 'adjust', [here]: e.loc };
  if (e.with === 'text') return { ...m, type: e.dir === 'in' ? 'receive' : 'issue', [here]: e.loc, ...(e.party ? { party: e.party } : {}) };
  return { ...m, type: 'transfer', [here]: e.loc, [there]: e.with || undefined };
}
