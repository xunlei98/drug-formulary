// Screenshots of the drug gallery and the drug information page on the live site (phone 390 px and desktop).
//   SECRETS=<file> [BASE=...] [DRUG=02.0001.02] node scripts/screens-druginfo.js   (writes docs/screens/15-drug-info-*.png, 16-gallery-*.png)
// Signs in as demo.pharm with the password from SECRETS; never prints it.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'https://limbang-formulary.web.app';
const DRUG = process.env.DRUG || '02.0001.02';
const USER = 'demo.pharm';
const OUT = new URL('../docs/screens/', import.meta.url).pathname;
const lines = fs.readFileSync(process.env.SECRETS, 'utf8').split('\n').map((l) => l.split(' ')).filter((p) => p[0] === USER);
const PW = (lines.filter((p) => p[1] === 'current:').pop() || lines.filter((p) => p[1] === 'temporary:').pop())[2];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const [tag, width, height] of [['390', 390, 844], ['desktop', 1440, 900]]) {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'light' })).newPage();
  await page.goto(BASE + '/');
  await page.fill('input[name=username]', USER);
  await page.fill('input[name=password]', PW);
  await page.click('button[type=submit]');
  await page.locator('.topbar').waitFor({ timeout: 30000 });
  await page.locator('a.dcard').first().waitFor({ timeout: 60000 });
  await page.fill('input[type=search]', 'acet');
  await page.waitForTimeout(3000); // let the pictures load
  await page.screenshot({ path: `${OUT}16-gallery-${tag}.png`, fullPage: false });
  await page.evaluate((d) => { location.hash = `#/drug/${encodeURIComponent(d)}`; }, DRUG);
  await page.locator('.prow').first().waitFor();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}15-drug-info-${tag}.png`, fullPage: true });
  const text = await page.locator('.props').innerText();
  console.log(tag, /Indications\s+\S/.test(text) && /Dosage\s+\S/.test(text) ? 'Indications and Dosage shown' : 'MISSING Indications/Dosage');
}
await browser.close();
