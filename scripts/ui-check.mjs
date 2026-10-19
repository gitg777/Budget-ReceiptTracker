// Clicks through the main screens on a phone-sized browser and saves screenshots.
// Needs `npx wrangler dev` running (with the mock reader for the long-receipt part:
// node scripts/mock-anthropic.mjs and .dev.vars as in smoke-credit.mjs).
// Usage: node scripts/ui-check.mjs <screenshot-dir>     DARK=1 for Night mode.
// Chromium's fake camera (a moving test pattern) stands in for the phone camera.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: process.env.DARK ? 'dark' : 'light', permissions: ['camera'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
const shot = (n, fullPage = true) => page.screenshot({ path: `${out}/${n}.png`, fullPage });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

await page.goto(BASE);
await shot('01-login', false);
await page.getByText('New here? Create an owner account').click();
await page.getByLabel('Your name').fill('Clinton');
await page.getByLabel('Budget name').fill('Hillside home');
await page.getByLabel('Email').fill(`ui${Date.now()}@test.zw`);
await page.getByLabel('Password (8+ characters)').fill('longenough');
await page.getByRole('button', { name: 'Create owner account' }).click();
await page.getByText('Snap receipt').waitFor();
await page.waitForTimeout(400);
await shot('02-home');

// Long receipt: two photos with the overlap guide, then read as one.
await page.getByText('Snap receipt').click();
await page.getByRole('button', { name: 'Take photo' }).waitFor();
await page.waitForTimeout(1500); // camera warms up
await shot('03-capture', false);
await page.getByRole('button', { name: 'Take photo' }).click();
await page.getByRole('button', { name: 'Take next part' }).waitFor();
await page.waitForTimeout(300);
await shot('04-capture-second-part', false);
await page.getByRole('button', { name: 'Take next part' }).click();
await page.getByText('Done — read all 2 photos as one receipt').click();
await page.getByText('Check and save below').waitFor({ timeout: 15000 });
await shot('05-home-after-reading');

// The mock reading adds up; make it not add up to show the totals check.
await page.locator('a[href^="#/review/"]').first().click();
await page.getByLabel('Total paid (USD)').waitFor();
await page.getByLabel('Total paid (USD)').fill('9.60');
await page.waitForTimeout(200);
await shot('06-review-totals-check');
await page.getByRole('button', { name: 'Save receipt' }).click();
await page.getByText('Snap receipt').waitFor();

// A ZiG receipt typed in, to show the rate choice.
await page.getByRole('button', { name: 'Type one in' }).click();
await page.getByLabel('Shop / paid to').fill('OK Mart');
await page.getByLabel('Currency').selectOption('ZWG');
await page.getByLabel('Total paid (ZWG)').fill('1284');
await page.getByPlaceholder('e.g. 26.5').fill('26.6');
await page.waitForTimeout(200);
await shot('07-review-rate');

await page.goto(BASE + '/#/help');
await page.getByText('How it works').first().waitFor();
await shot('08-help');
await page.goto(BASE + '/#/feedback');
await page.getByLabel('Your message').fill('The camera is great. Could it beep when it takes the photo?');
await page.getByRole('button', { name: 'Idea' }).click();
await page.getByRole('button', { name: 'Send', exact: true }).click();
await page.getByText("Thank you, it's been sent.").waitFor();
await shot('09-feedback');
await page.goto(BASE + '/#/settings');
await page.getByText('How it works').waitFor();
await shot('10-more');
await page.goto(BASE + '/#/reports');
await page.getByText('By category').waitFor().catch(() => undefined);
await shot('11-reports');

// Night mode from the switch on Home.
await page.goto(BASE + '/#/home');
await page.getByRole('button', { name: 'Night' }).click();
await page.waitForTimeout(300);
await shot('12-home-night');
await page.getByRole('button', { name: 'Same as phone' }).click();

console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
await browser.close();
