// Downloads Drive and imgur drug pictures, writes compressed WebP files to public/drugs/,
// and rewrites public/shared/drug-photos.local.js so the app serves those copies.
//   node scripts/host-drug-photos.js --yes
// Reads the live formulary. Needs GOOGLE_APPLICATION_CREDENTIALS, or a `firebase login` on this machine.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { projectId, flag } from './admin-init.js';
import { photoJobs, isOldFormularyOnly } from '../public/shared/druginfo.js';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'public/drugs');
const sourcesPath = path.join(dir, '.sources.json');
const photosPath = path.join(root, 'public/shared/drug-photos.local.js');
const WIDTH = 800;
const QUALITY = 68;

if (!flag('yes')) {
  console.error('This reads the live formulary and writes public/drugs. Re-run with --yes.');
  process.exit(2);
}

const drugs = await loadDrugs();
const jobs = photoJobs(drugs.filter((d) => !isOldFormularyOnly(d)));
fs.mkdirSync(dir, { recursive: true });
const previous = fs.existsSync(sourcesPath) ? JSON.parse(fs.readFileSync(sourcesPath, 'utf8')) : {};
const sources = {};
const photos = {};
let downloaded = 0;
let kept = 0;
let failed = 0;

for (const job of jobs) {
  const dest = path.join(dir, job.file);
  sources[job.file] = job.src;
  if (previous[job.file] === job.src && fs.existsSync(dest)) { kept++; mark(photos, job); continue; }
  try {
    const buf = await fetchImage(job.src);
    const out = await sharp(buf).rotate().resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
    fs.writeFileSync(dest, out);
    downloaded++;
    mark(photos, job);
  } catch (e) {
    failed++;
    console.error(`skip ${job.no_kod} ${job.kind}: ${e.message}`);
  }
}

const keep = new Set(Object.keys(sources));
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.webp') || keep.has(name)) continue;
  fs.unlinkSync(path.join(dir, name));
}
fs.writeFileSync(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
const body = Object.keys(photos).sort().map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(photos[k])},`).join('\n');
fs.writeFileSync(photosPath, `// This hospital's hosted pictures. Not part of the shared repository.\nexport const DRUG_PHOTOS = {\n${body}\n};\n`);
const bytes = [...keep].reduce((n, name) => n + (fs.existsSync(path.join(dir, name)) ? fs.statSync(path.join(dir, name)).size : 0), 0);
console.log(`Photos: ${jobs.length} hostable, ${downloaded} compressed, ${kept} unchanged, ${failed} failed. ${Math.round(bytes / 1024)} KB in public/drugs.`);

function mark(photos, job) {
  photos[job.no_kod] = { ...(photos[job.no_kod] || {}), [job.kind]: true };
}

async function fetchImage(url, tried = false) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 80)}`);
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (type.startsWith('image/')) return buf;
  const id = !tried && /googleusercontent\.com\/d\/([^/=]+)/.exec(url);
  if (id) return fetchImage(`https://drive.google.com/uc?export=download&id=${id[1]}`, true);
  throw new Error(`not an image (${type || 'no type'})`);
}

async function loadDrugs() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const { initializeApp, applicationDefault } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const id = projectId();
    const app = initializeApp({ projectId: id, credential: applicationDefault() });
    const snap = await getFirestore(app).collection('formulary').get();
    return snap.docs.flatMap((d) => d.data().items || []);
  }
  const { getAccessToken, getGlobalDefaultAccount } = require('firebase-tools/lib/auth.js');
  const acct = getGlobalDefaultAccount();
  if (!acct?.tokens?.refresh_token) throw new Error('Run firebase login, or set GOOGLE_APPLICATION_CREDENTIALS.');
  const tok = await getAccessToken(acct.tokens.refresh_token, []);
  const id = projectId();
  const drugs = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${id}/databases/(default)/documents/formulary`);
    url.searchParams.set('pageSize', '20');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!res.ok) throw new Error(`Firestore ${res.status}`);
    const body = await res.json();
    for (const doc of body.documents || []) drugs.push(...itemsOf(doc));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return drugs;
}

function str(v) { return v?.stringValue || ''; }
function itemsOf(doc) {
  return (doc.fields?.items?.arrayValue?.values || []).map((item) => {
    const f = item.mapValue?.fields || {};
    const info = {};
    for (const [k, v] of Object.entries(f.info?.mapValue?.fields || {})) {
      if (v.stringValue != null) info[k] = v.stringValue;
    }
    return { no_kod: str(f.no_kod), source: str(f.source), info };
  });
}
