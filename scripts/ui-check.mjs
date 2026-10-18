// Clicks through the main screens on a phone-sized browser and saves screenshots.
// Needs `npx wrangler dev` running. Usage: node scripts/ui-check.mjs <screenshot-dir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });

await page.goto(BASE);
await page.getByText('New here? Create an owner account').click();
await page.getByLabel('Your name').fill('Clinton');
await page.getByLabel('Budget name').fill('Hillside home');
await page.getByLabel('Email').fill(`ui${Date.now()}@test.zw`);
await page.getByLabel('Password (8+ characters)').fill('longenough');
await shot('01-register');
await page.getByRole('button', { name: 'Create owner account' }).click();
await page.getByText('Add a receipt').waitFor();
await shot('02-home');

// Offline: a photo is queued on the phone, not lost.
await ctx.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.locator('input[type=file][multiple]').setInputFiles({ name: 'slip.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
await page.getByText('Waiting to send').waitFor();
await shot('03-offline-queued');
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.getByText('Could not read').waitFor({ timeout: 15000 });
await shot('04-back-online-unreadable');

// Type it in against the photo, in ZWG with my own rate.
await page.getByRole('button', { name: 'Type it in' }).click();
await page.getByText('Check and save').waitFor();
await page.getByLabel('Shop / paid to').fill('Fortwell Wholesale');
await page.getByLabel('Currency').selectOption('ZWG');
await page.getByLabel('Total paid (ZWG)').fill('1197.5');
await page.getByLabel('Category').selectOption({ label: 'Household' });
await page.getByRole('button', { name: '+ Add a line' }).click();
await page.getByLabel('Item', { exact: true }).fill('Washing powder, Hippo, 10kg');
await page.getByLabel('Amount', { exact: true }).fill('1197.5');
await page.getByText('My own rate:').click();
await page.getByPlaceholder('e.g. 26.5').fill('26.5');
await shot('05-review-zwg');
await page.getByRole('button', { name: 'Save receipt' }).click();
await page.getByText('Add a receipt').waitFor();

await page.goto(BASE + '/#/receipts');
await page.getByText('Fortwell Wholesale').waitFor();
await shot('06-receipts');

await page.goto(BASE + '/#/reports');
await page.getByText('By category').waitFor();
await page.getByPlaceholder('milk, fuel, bread, Fortwell…').fill('washing');
await page.getByRole('button', { name: 'Go' }).click();
await page.getByText('Items matching').waitFor();
await shot('07-reports');

await page.goto(BASE + '/#/helpers');
await page.getByRole('button', { name: '+ Add helper' }).click();
await page.getByLabel('Name', { exact: true }).fill('Grace');
await page.getByLabel('Username (they type this to log in)').fill(`grace${Date.now()}`);
await page.getByLabel('PIN (4–8 digits)').fill('4321');
await page.getByLabel('Allowance (USD)').fill('150');
await shot('08-add-helper');
await page.getByRole('button', { name: 'Add helper' }).click();
await page.getByText('Allowance used').waitFor();
await page.getByText('Allowance used').click();
await page.getByText('Record cash').waitFor();
await shot('09-helper-detail');

await page.goto(BASE + '/#/settings');
await page.getByText('Categories and monthly budgets').waitFor();
await shot('10-settings');

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.goto(BASE + '/#/reports').then(() => page.getByRole('button', { name: 'Download .xlsx' }).click()),
]);
await download.saveAs(`${out}/export.xlsx`);

console.log(errors.length ? 'browser errors:\n' + errors.join('\n') : 'no browser errors');
await browser.close();
