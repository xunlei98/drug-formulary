import { HttpError } from '../http.js';
import { audit } from '../db.js';
import { fullPatient } from '../patients.js';

export function patientRoutes({ db }) {
  return [
    ['GET', '/api/patients', () => ({
      patients: db.prepare('SELECT * FROM patients ORDER BY no_kod, nama').all().map(fullPatient),
    }), 'patient.view'],

    ['GET', '/api/patients/:id/log', (ctx) => ({
      log: db.prepare('SELECT ts, username, action, from_kategori, to_kategori, detail FROM patient_log WHERE patient_id = ? ORDER BY id DESC LIMIT 50').all(ctx.params.id),
    }), 'patient.view'],

    ['POST', '/api/patients/:id/reveal-ic', (ctx) => {
      const row = db.prepare('SELECT ic FROM patients WHERE id = ?').get(ctx.params.id);
      if (!row) throw new HttpError(404, 'Patient not found');
      audit(db, ctx.user, 'patient.ic_reveal', ctx.params.id);
      return { ic: row.ic };
    }, 'patient.fullic'],

    ['GET', '/api/patients/:id', (ctx) => {
      const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(ctx.params.id);
      if (!row) throw new HttpError(404, 'Patient not found');
      return fullPatient(row);
    }, 'patient.view'],
  ];
}
