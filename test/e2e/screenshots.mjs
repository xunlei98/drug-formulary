import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.DEMO_PASSWORD;
const DRUG = process.env.DEMO_DRUG || 'A10BX12000T1001';
const OUT = 'docs/screens';
if (!PASSWORD) throw new Error('Run against the demo database: DEMO_PASSWORD=... node test/e2e/screenshots.mjs');

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
fs.mkdirSync(OUT, { recursive: true });

async function session(user, size) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE + '/');
  await page.waitForSelector('input[name=username]');
  return { context, page };
}
async function login(page, user) {
  await page.fill('input[name=username]', user);
  await page.fill('input[name=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  await page.waitForTimeout(800);
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(900); };

const phone = { width: 390, height: 844 };
{
  const { context, page } = await session('x', phone);
  await page.screenshot({ path: `${OUT}/01-login.png` });
  await login(page, 'demo.pharm');
  await page.fill('input[type=search]', 'empagli');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/02-drug-search.png` });
  await go(page, `#/drug/${DRUG}`);
  await page.screenshot({ path: `${OUT}/03-drug-detail.png` });
  await page.evaluate(() => window.scrollTo(0, 560));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/03b-drug-detail-stock.png` });
  await go(page, '#/patients');
  await page.screenshot({ path: `${OUT}/04-patients.png` });
  await go(page, '#/quota');
  await page.screenshot({ path: `${OUT}/07-quota.png` });
  await context.close();
}
{
  const { context, page } = await session('x', phone);
  await login(page, 'demo.ward');
  await go(page, `#/log?drug=${DRUG}`);
  await page.getByRole('button', { name: 'Transfer' }).click();
  await page.selectOption('select[aria-label=From]', { index: 1 });
  await page.selectOption('select[aria-label=To]', { index: 2 });
  await page.fill('input[aria-label=Quantity]', '5');
  await page.screenshot({ path: `${OUT}/05-log-movement-390.png` });
  await context.close();
}
{
  const { context, page } = await session('x', phone);
  await login(page, 'admin');
  await go(page, '#/admin');
  await page.screenshot({ path: `${OUT}/06-admin-users.png` });
  await context.close();
}
{
  const { context, page } = await session('x', { width: 1280, height: 860 });
  await login(page, 'demo.pharm');
  await go(page, `#/drug/${DRUG}`);
  await page.screenshot({ path: `${OUT}/08-drug-detail-desktop.png` });
  await context.close();
}
await browser.close();
console.log('Screenshots written to', OUT);
