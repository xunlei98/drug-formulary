import crypto from 'node:crypto';
import { createPatient } from './patients.js';
import { recordMovement } from './stock.js';
import { UNITS } from '../shared/patient-state.js';

const ROLE_USER = { id: null, username: 'demo' };

export function addDemoData(db) {
  if (db.prepare("SELECT 1 FROM patients WHERE nama LIKE 'DEMO PATIENT %'").get()) return 'Demo data already present.';
  const mahal = db.prepare('SELECT m.no_kod FROM mahal_item m WHERE m.quota IS NOT NULL ORDER BY m.quota DESC LIMIT 6').all();
  const cats = ['Active', 'Active', 'Active - Pesara', 'Waiting List', 'Active', 'Off', 'Defaulted'];
  let n = 0;
  mahal.forEach((m, mi) => {
    const quota = db.prepare('SELECT quota FROM mahal_item WHERE no_kod = ?').get(m.no_kod).quota;
    const count = mi === 0 ? quota + 2 : mi === 1 ? quota : Math.max(2, Math.round(quota * (0.3 + 0.12 * mi)));
    for (let i = 0; i < count; i++) {
      n++;
      const kategori = mi < 2 && i < quota + 2 ? 'Active' : cats[(i + mi) % cats.length];
      const stop = kategori === 'Off' || kategori === 'Defaulted' ? '2026-06-01' : null;
      const r = createPatient(db, crypto.randomUUID(), {
        no_kod: m.no_kod, nama: `DEMO PATIENT ${String(n).padStart(3, '0')}`, ic: `000000-00-${String(n).padStart(4, '0')}`,
        kategori, unit: UNITS[(i + mi) % UNITS.length], preskriber: 'Dr Demo', dos: '1 tablet daily', tarikh_mula: '2025-03-01', tarikh_henti: stop,
      }, ROLE_USER);
      if (r.status !== 'applied') throw new Error(`demo patient failed: ${r.reason}`);
    }
  });
  const drugs = db.prepare("SELECT no_kod FROM drugs WHERE kategori = 'Ubat' ORDER BY perihal LIMIT 4").all().map((d) => d.no_kod);
  const mov = (o) => recordMovement(db, { id: crypto.randomUUID(), device_time: new Date().toISOString(), note: 'demo', ...o }, ROLE_USER, 'replay');
  for (const d of [...drugs, ...mahal.map((m) => m.no_kod).slice(0, 2)]) {
    mov({ drug: d, type: 'receive', to: 'main-store', qty: 600 });
    mov({ drug: d, type: 'transfer', from: 'main-store', to: 'ward-medical', qty: 120 });
    mov({ drug: d, type: 'transfer', from: 'main-store', to: 'opd-pharmacy', qty: 80 });
    mov({ drug: d, type: 'issue', from: 'ward-medical', qty: 35 });
    mov({ drug: d, type: 'issue', from: 'ward-medical', qty: 20 });
    mov({ drug: d, type: 'receive', to: 'main-store', qty: 240 });
  }
  return `Added ${n} fake DEMO patients and example stock movements.`;
}
