// Bundles the Firebase SDK into public/vendor and writes public/sw.js with the shell file list and a build hash.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');

await build({
  entryPoints: [path.join(root, 'scripts/firebase-entry.js')],
  bundle: true, format: 'esm', minify: true, target: 'es2020', legalComments: 'none',
  outfile: path.join(pub, 'vendor/firebase.js'),
});

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!e.name.startsWith('.') && !/^sw(\.template)?\.js$/.test(e.name)) files.push(p);
  }
};
walk(pub);
files.sort();
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(f).update(fs.readFileSync(f));
const shell = ['/', ...files.map((f) => `/${path.relative(pub, f).split(path.sep).join('/')}`).filter((u) => u !== '/index.html')];
const sw = fs.readFileSync(path.join(pub, 'sw.template.js'), 'utf8')
  .replace('__BUILD__', hash.digest('hex').slice(0, 12))
  .replace('__SHELL__', JSON.stringify(shell));
fs.writeFileSync(path.join(pub, 'sw.js'), sw);
console.log(`built vendor/firebase.js (${(fs.statSync(path.join(pub, 'vendor/firebase.js')).size / 1024).toFixed(0)} KB) and sw.js (${shell.length} shell files)`);
