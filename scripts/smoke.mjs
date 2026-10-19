// End-to-end check of the API against a running dev server (no Claude key needed).
// Usage: npm run migrate:local && npx wrangler dev   (in another terminal)  then  node scripts/smoke.mjs
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const stamp = Date.now();
let failures = 0;

function client() {
  let cookie = '';
  return async (path, { method, body, form } = {}) => {
    const res = await fetch(BASE + '/api' + path, {
      method: method ?? (body || form ? 'POST' : 'GET'),
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}

function check(name, cond, extra) {
  if (cond) console.log('  ok  ', name);
  else {
    failures++;
    console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const owner = client();
const helper = client();
const today = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);

let r = await owner('/auth/register', { body: { email: 'bad', password: 'x', display_name: 'A' } });
check('register rejects bad email', r.status === 400);
r = await owner('/auth/register', { body: { email: `owner${stamp}@test.zw`, password: 'longenough', display_name: 'Owner', account_name: 'Home' } });
check('owner registers', r.status === 200, r.data);
r = await owner('/me');
check('13 default categories', r.data?.categories?.length === 13, r.data);
const cat = Object.fromEntries(r.data.categories.map((c) => [c.name, c.id]));
check('new account starts with $5 reading credit', r.data.credit?.balance_micros === 5_000_000 && !r.data.credit.unlimited, r.data.credit);
r = await owner('/credit');
check('owner sees the free-credit grant in the history', r.data.ledger?.[0]?.kind === 'grant', r.data);
r = await owner('/admin/accounts');
check('ordinary owner cannot open the operator screen', r.status === 403);

r = await owner('/helpers', { body: { display_name: 'Grace', username: `grace${stamp}`, pin: '1234', allowance: 100, period: 'monthly', carry_over: true, starts_on: today } });
check('owner adds helper', r.status === 200, r.data);
const helperId = r.data.id;
r = await owner('/rates', { body: { currency: 'ZWG', rate: 26.6, date: today } });
check('owner sets own ZWG rate', r.status === 200, r.data);
r = await owner(`/helpers/${helperId}/cash`, { body: { kind: 'given', amount: 50 } });
check('owner records $50 given', r.status === 200, r.data);

r = await helper('/auth/login', { body: { login: `grace${stamp}`, password: '1234' } });
check('helper logs in with PIN', r.status === 200, r.data);

// A tiny PNG. With no API key the reading fails cleanly and the photo is kept.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), 'r.png');
form.append('client_id', `smoke${stamp}`);
r = await helper('/uploads', { form });
check('upload stored, reading fails gracefully without key', r.status === 200 && r.data.ok === false && r.data.upload_id, r.data);
const uploadId = r.data.upload_id;
const form2 = new FormData();
form2.append('file', new Blob([png], { type: 'image/png' }), 'r.png');
form2.append('client_id', `smoke${stamp}`);
r = await helper('/uploads', { form: form2 });
check('same client_id does not duplicate', r.data.upload_id === uploadId, r.data);
r = await helper('/uploads/failed');
check('failed upload listed', r.data.uploads.some((u) => u.id === uploadId), r.data);
r = await helper(`/uploads/${uploadId}/file`);
check('helper can view own photo', r.status === 200 || r.data === null);

r = await helper('/receipts', { body: { upload_id: uploadId } });
const rid = r.data.id;
r = await helper(`/rates/suggest?currency=ZWG&date=${today}`);
check('suggested rate is the owner rate', r.data.suggestion?.rate_per_usd === 26.6, r.data);
r = await helper(`/receipts/${rid}`, {
  method: 'PUT',
  body: { merchant: 'Greenvale', receipt_date: today, currency: 'ZWG', total: 532, rate_per_usd: 26.6, rate_source: 'auto', category_id: cat.Groceries,
    paid_by: 'float', items: [{ name: 'Bread, white loaf', amount: 266, category_id: cat.Groceries }, { name: 'Milk, fresh, 2L', amount: 266 }], save: true },
});
check('helper saves ZWG receipt', r.status === 200 && r.data.status === 'saved', r.data);
r = await helper(`/receipts/${rid}`);
check('hand-typed receipt on an unread photo has no audit entry yet', r.data.edits.length === 0, r.data.edits);
check('ZWG 532 @ 26.6 = $20.00', r.data.receipt.total_usd_cents === 2000, r.data.receipt);
check('rate stored on receipt', r.data.receipt.rate_per_usd === 26.6 && r.data.receipt.rate_source === 'auto');

r = await helper('/receipts', { body: {} });
const rid2 = r.data.id;
r = await helper(`/receipts/${rid2}`, { method: 'PUT', body: { merchant: 'Tuckshop', receipt_date: today, currency: 'USD', total: 5, paid_by: 'own', items: [{ name: 'Airtime', amount: 5, category_id: cat['Airtime & Data'] }], save: true } });
check('helper saves own-money receipt', r.status === 200, r.data);
r = await helper(`/receipts/${rid2}`);
check('typed-in receipt has no audit entry', r.data.edits.length === 0 && r.data.receipt.edited === 0, r.data);

r = await helper(`/receipts/${rid}`, { method: 'PUT', body: { total: 558.6, items: [{ name: 'Bread, white loaf', amount: 292.6 }, { name: 'Milk, fresh, 2L', amount: 266 }], reason: 'bread was 292.60' } });
r = await helper(`/receipts/${rid}`);
check('edit recorded with reason and name', r.data.edits[0]?.reason === 'bread was 292.60' && r.data.edits[0]?.by_name === 'Grace' && r.data.receipt.edited === 1, r.data.edits);
check('edited total re-converted ($21.00)', r.data.receipt.total_usd_cents === 2100, r.data.receipt);

r = await helper('/my/summary');
check('allowance left 100 - 21 - 5 = $74', r.data.allowance.remaining_cents === 7400, r.data.allowance);
check('cash expected 50 - 21 = $29', r.data.cash_in_hand_cents === 2900, r.data);
check('owed back $5', r.data.owed_to_helper_cents === 500, r.data);

r = await helper('/my/cashup', { body: { declared: 28, hand_back: false, note: 'lost a coin' } });
check('cash-up records -$1 difference', r.data.difference_cents === -100, r.data);
r = await helper('/my/summary');
check('after cash-up expected cash = counted cash', r.data.cash_in_hand_cents === 2800, r.data);

r = await helper('/reports/month');
check('helper cannot see reports', r.status === 403);
r = await helper('/helpers');
check('helper cannot see helper list', r.status === 403);

r = await owner('/receipts', { body: {} });
const ownerReceipt = r.data.id;
r = await helper(`/receipts/${ownerReceipt}`);
check('helper cannot open owner receipt', r.status === 404);
r = await owner(`/receipts/${ownerReceipt}`, { method: 'PUT', body: { merchant: 'Puma', receipt_date: today, currency: 'USD', total: 40, category_id: cat.Fuel, items: [{ name: 'Diesel', amount: 40 }], save: true } });
check('owner saves fuel receipt', r.status === 200, r.data);

r = await owner(`/reports/month?month=${today.slice(0, 7)}`);
check('month total $66', r.data.totals.usd_cents === 6600, r.data.totals);
const groceries = r.data.by_category.find((x) => x.name === 'Groceries');
check('groceries = whole ZWG receipt ($21) incl. uncategorised milk line', groceries?.usd_cents === 2100, r.data.by_category);
r = await owner('/reports/search?q=milk');
check('search milk finds 1 line', r.data.items.length === 1 && r.data.item_total_usd_cents === 1000, r.data);

r = await owner('/helpers');
const h = r.data.helpers[0];
check('owner sees helper cash $28 and owes $5', h.cash_in_hand_cents === 2800 && h.owed_to_helper_cents === 500, h);
r = await owner(`/helpers/${helperId}/reimburse`, { method: 'POST' });
check('owner pays helper back', r.data.amount_cents === 500, r.data);
r = await helper(`/receipts/${rid2}`, { method: 'PUT', body: { total: 50 } });
check('helper cannot change a paid-back receipt', r.status === 400, r.data);

r = await owner(`/reports/export?from=${today.slice(0, 7)}-01&to=${today}`);
check('export has receipts, items, edits', r.data.receipts.length === 3 && r.data.items.length === 4 && r.data.edits.length >= 1, { r: r.data.receipts.length, i: r.data.items.length, e: r.data.edits.length });

r = await owner(`/helpers/${helperId}`, { method: 'PATCH', body: { active: false } });
r = await helper('/me');
check('removed helper is logged out at once', r.status === 401);

const stranger = client();
for (let i = 0; i < 8; i++) await stranger('/auth/login', { body: { login: `owner${stamp}@test.zw`, password: 'wrong' } });
r = await stranger('/auth/login', { body: { login: `owner${stamp}@test.zw`, password: 'longenough' } });
check('locked after 8 wrong passwords', r.status === 429, r.data);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
