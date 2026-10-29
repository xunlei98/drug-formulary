import path from 'node:path';

const int = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const LOCAL = ['127.0.0.1', 'localhost', '::1'];

export function loadConfig(env = process.env) {
  const c = {
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 3000),
    dbPath: path.resolve(env.DB_PATH || './formulary.db'),
    sessionIdleHours: int(env.SESSION_IDLE_HOURS, 12),
    adminIdleHours: int(env.ADMIN_IDLE_HOURS, 4),
    offlineDays: int(env.OFFLINE_DAYS, 3),
    idleLockMin: int(env.IDLE_LOCK_MIN, 5),
    offlinePatients: env.OFFLINE_PATIENTS === 'off' ? 'off' : 'minimal',
    wardStockScope: env.WARD_STOCK_SCOPE === 'all' ? 'all' : 'own',
    secureCookies: env.SECURE_COOKIES !== '0',
    trustProxy: env.TRUST_PROXY === '1',
    nearPct: int(env.QUOTA_NEAR_PCT, 80),
    loginMaxFails: int(env.LOGIN_MAX_FAILS, 5),
    loginWindowMs: int(env.LOGIN_WINDOW_MIN, 15) * 60_000,
  };
  if (!c.secureCookies && !LOCAL.includes(c.host)) {
    throw new Error('SECURE_COOKIES=0 is only allowed when HOST is 127.0.0.1, localhost or ::1');
  }
  return c;
}

export const publicConfig = (c) => ({
  offlineDays: c.offlineDays,
  offlinePatients: c.offlinePatients,
  idleLockMin: c.idleLockMin,
  nearPct: c.nearPct,
});
