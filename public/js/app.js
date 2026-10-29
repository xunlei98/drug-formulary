import { h, clear, icon } from './dom.js';
import { state, subscribe, notify, can_, loadLocal, refresh, syncSoon, syncStatus, wipePatients, startNetworkWatch } from './store.js';
import { get, post, onUnauthorized } from './api.js';
import { mainDb } from './idb.js';
import { home } from './views/home.js';
import { drug } from './views/drug.js';
import { stock } from './views/stock.js';
import { log } from './views/log.js';
import { quota } from './views/quota.js';
import { patients, patient, newPatient } from './views/patients.js';
import { syncView, review } from './views/sync.js';
import { more } from './views/more.js';
import { admin } from './views/admin.js';
import { loginScreen, changePasswordForm } from './views/login.js';

const root = document.getElementById('app');
let current = null;
let shell = null;
let idleTimer = null;
let started = false;

const ROUTES = [
  [/^$|^home$/, home], [/^drug\/(.+)$/, drug, ['id']], [/^stock$/, stock], [/^log$/, log], [/^quota$/, quota],
  [/^patients$/, patients, [], 'patient.view'], [/^patient\/new$/, newPatient, [], 'patient.edit'], [/^patient\/(.+)$/, patient, ['id'], 'patient.view'],
  [/^sync$/, syncView], [/^review$/, review, [], 'stock.review'], [/^more$/, more], [/^admin$/, admin, [], 'user.manage'],
];

const tabs = () => [
  ['#/', 'search', 'Search', /^$|^home$|^drug/],
  can_('stock.view') && ['#/stock', 'stock', 'Stock', /^stock/],
  can_('stock.log') && ['#/log', 'plus', 'Log', /^log/, true],
  can_('quota.view') && ['#/quota', 'gauge', 'Quota', /^quota/],
  can_('patient.view') && ['#/patients', 'users', 'Patients', /^patient/],
].filter(Boolean);

function route() {
  if (!state.user) return;
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const query = new URLSearchParams(qs);
  current?.cleanup?.();
  for (const [re, view, names = [], perm] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    if (perm && !can_(perm)) break;
    const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    params.onLogout = signOut;
    current = view(params, query);
    shell.title.textContent = current.title;
    clear(shell.main, current.el);
    shell.main.focus({ preventScroll: true });
    scrollTo(0, 0);
    paintChrome(path);
    return;
  }
  current = null;
  clear(shell.main, h('div', { class: 'empty' }, 'That page is not available to you.'));
  paintChrome(path);
}

function paintChrome(path = location.hash.replace(/^#\/?/, '').split('?')[0]) {
  const st = syncStatus();
  clear(shell.badge, icon(st.kind === 'offline' ? 'offline' : st.kind === 'attention' ? 'alert' : st.kind === 'synced' ? 'check' : 'sync'), st.label);
  shell.badge.className = `badge ${st.kind}`;
  clear(shell.tabbar, tabs().map(([href, ic, text, re, primary]) => h('a', { class: `tab${primary ? ' primary' : ''}`, href, 'aria-current': re.test(path) ? 'page' : null },
    primary ? h('span', { class: 'dot' }, icon(ic)) : icon(ic), text)));
}

function buildShell() {
  shell = {
    title: h('h1'),
    badge: h('a', { class: 'badge', href: '#/sync', 'aria-label': 'Sync status' }),
    main: h('main', { tabindex: '-1' }),
    tabbar: h('nav', { class: 'tabbar', 'aria-label': 'Main' }),
  };
  clear(root, h('div', { class: 'shell' },
    h('header', { class: 'topbar' }, shell.title, shell.badge, h('a', { class: 'icon-btn', href: '#/more', 'aria-label': 'Account' }, icon('user'))),
    shell.main, shell.tabbar));
}

function showLogin(message) {
  stopIdle();
  state.user = null;
  current = null;
  clear(root, loginScreen({ message, onDone: (r) => begin(r.user, r.config) }));
}

function forceChange(user) {
  clear(root, h('div', { class: 'login' }, changePasswordForm({ forced: true, onDone: async () => { const me = await get('/api/me'); begin(me.user, me.config); } })));
}

async function begin(user, config) {
  state.user = user;
  state.config = { ...state.config, ...config };
  if (user.must_change) { forceChange(user); return; }
  if (!started) { started = true; startNetworkWatch(); addEventListener('hashchange', route); subscribe(() => { if (state.user && shell) { paintChrome(); current?.update?.(); } }); }
  await loadLocal();
  buildShell();
  startIdle();
  const first = !state.drugs.length;
  if (first) clear(shell.main, h('div', { class: 'empty' }, 'Downloading the formulary'));
  try { await refresh(); } catch (e) { if (!e.offline) console.warn(e.message); }
  if (!location.hash) location.hash = '#/';
  route();
  syncSoon();
}

async function signOut(message) {
  try { await post('/api/logout'); } catch { /* offline: server session expires on its own */ }
  await wipePatients();
  await mainDb.del('meta', 'session');
  showLogin(typeof message === 'string' ? message : null);
}

function startIdle() {
  stopIdle();
  if (!can_('patient.view')) return;
  const limit = (state.config.idleLockMin || 5) * 60000;
  const reset = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => signOut('Signed out after being idle.'), limit); };
  for (const ev of ['pointerdown', 'keydown', 'scroll']) addEventListener(ev, reset, { passive: true });
  reset();
  startIdle.reset = reset;
}

function stopIdle() {
  clearTimeout(idleTimer);
  if (startIdle.reset) for (const ev of ['pointerdown', 'keydown', 'scroll']) removeEventListener(ev, startIdle.reset);
  startIdle.reset = null;
}

async function boot() {
  onUnauthorized(async () => { if (state.user) { await wipePatients(); showLogin('Your session ended. Please sign in again.'); } });
  setInterval(async () => {
    if (!state.user || navigator.onLine) return;
    const s = await mainDb.get('meta', 'session');
    if (s && Date.now() - s.lastOnlineAt > state.config.offlineDays * 86400000) signOut('Offline too long. Connect to the network and sign in again.');
  }, 60000);
  try {
    const me = await get('/api/me');
    await begin(me.user, me.config);
  } catch (e) {
    if (e.offline) {
      const s = await mainDb.get('meta', 'session');
      const cfg = (await mainDb.get('meta', 'config')) || state.config;
      if (s && Date.now() - s.lastOnlineAt < cfg.offlineDays * 86400000) { state.online = false; await begin(s.user, cfg); return; }
      showLogin('You are offline and there is no recent session on this device.');
    } else showLogin();
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
