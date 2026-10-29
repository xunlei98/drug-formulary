import { h, clear, icon } from './dom.js';
import { state, subscribe, can_, loadLocal, syncSoon, syncStatus, startNetworkWatch, startLive, stopLive, flushBeforeSignOut, audit, saveSession } from './store.js';
import { mainDb } from './idb.js';
import { auth, db, wipeCache } from './fb.js';
import { onAuthStateChanged, signOut as fbSignOut, doc, getDoc, updateDoc, serverTimestamp } from '/vendor/firebase.js';
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
  clear(root, loginScreen({ message, onDone: () => { freshLogin = true; } }));
}

let freshLogin = false;

const toUser = (uid, email, d) => ({
  uid, email, username: d.username, display_name: d.name || d.username, role: d.role, location_id: d.location || null, must_change: !!d.must_change,
});
const usable = (d) => d && !d.disabled && ['admin', 'pharmacist', 'ward'].includes(d.role);

function forceChange() {
  clear(root, h('div', { class: 'login' }, changePasswordForm({ forced: true, username: state.user.username, onDone: async () => {
    await updateDoc(doc(db(), `users/${state.user.uid}`), { must_change: false });
    state.user.must_change = false;
    await begin();
  } })));
}

// Signed in with Firebase Auth. The users/{uid} document decides the role; without it the account gets nothing.
async function enter(u) {
  const session = await mainDb.get('meta', 'session');
  let snap;
  try { snap = await getDoc(doc(db(), `users/${u.uid}`)); } catch (e) {
    return signOut(navigator.onLine ? `Could not load your account (${e.code || e.message}).` : 'You are offline and there is no recent session on this device.');
  }
  const d = snap.exists() ? snap.data() : null;
  if (!usable(d)) return signOut('This account has no access. Ask the pharmacy administrator.');
  const days = (await mainDb.get('meta', 'config'))?.offlineDays || state.config.offlineDays;
  if (snap.metadata.fromCache && (!session || session.uid !== u.uid || Date.now() - session.lastOnlineAt > days * 86400000)) {
    return signOut('Offline too long. Connect to the network and sign in again.');
  }
  state.user = toUser(u.uid, u.email, d);
  state.lastOnlineAt = snap.metadata.fromCache ? session.lastOnlineAt : Date.now();
  if (!snap.metadata.fromCache) {
    await saveSession();
    updateDoc(snap.ref, { last_login: serverTimestamp() }).catch(() => {});
    if (freshLogin) audit('login');
  }
  if (state.user.must_change) { forceChange(); return; }
  await begin();
}

// Role or location changes take effect on reload; disabling an account signs it out at once.
function onUserChange(d) {
  if (!state.user) return;
  if (!usable(d)) { signOut('Your account was disabled.'); return; }
  if (d.role !== state.user.role || (d.location || null) !== state.user.location_id) location.reload();
}

let routing = false;
async function begin() {
  if (!started) { started = true; startNetworkWatch(); subscribe(() => { if (state.user && shell) { paintChrome(); current?.update?.(); } }); }
  await loadLocal();
  buildShell();
  clear(shell.main, h('div', { class: 'empty' }, state.drugs.length ? 'Loading' : 'Downloading the formulary'));
  await startLive(onUserChange).catch((e) => console.warn('live:', e.code || e.message));
  mainDb.put('meta', state.config, 'config').catch(() => {});
  startIdle();
  if (!location.hash) location.hash = '#/';
  route();
  // Routing starts only now, so a tap during loading is not rendered twice and a half-filled form is never replaced.
  if (!routing) { routing = true; addEventListener('hashchange', route); }
  syncSoon();
}

// Sign-out pushes pending writes (5 s at most), signs out of Firebase, then wipes the Firestore cache,
// so no patient record stays on the device. Unsynced movements stay in our own outbox for the next sign-in.
let signingOut = false;
async function signOut(message) {
  if (signingOut) return;
  signingOut = true;
  stopIdle();
  clear(root, h('div', { class: 'login' }, h('p', { class: 'sub' }, 'Signing out')));
  try { if (state.user) await flushBeforeSignOut(); } catch { /* keep going */ }
  stopLive();
  await fbSignOut(auth).catch(() => {});
  await wipeCache();
  await mainDb.del('meta', 'session').catch(() => {});
  if (typeof message === 'string') sessionStorage.setItem('fm-msg', message);
  location.reload();
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

function boot() {
  const message = sessionStorage.getItem('fm-msg');
  sessionStorage.removeItem('fm-msg');
  setInterval(() => {
    if (state.user && !navigator.onLine && Date.now() - state.lastOnlineAt > state.config.offlineDays * 86400000) signOut('Offline too long. Connect to the network and sign in again.');
  }, 60000);
  let first = true;
  onAuthStateChanged(auth, (u) => {
    if (u && !state.user) enter(u).catch((e) => signOut(e.message));
    else if (!u && (first || state.user)) { if (state.user) signOut(); else showLogin(message); }
    first = false;
  });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
