import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// PDF to text for the seed script. Needs poppler-utils (pdftotext).
export function pdfToText(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floorstock-'));
  try {
    const file = path.join(dir, 'list.pdf');
    fs.writeFileSync(file, buffer);
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', timeout: 20000, maxBuffer: 8_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('pdftotext is not installed . Install poppler-utils.');
    throw new Error('Could not read that PDF.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
