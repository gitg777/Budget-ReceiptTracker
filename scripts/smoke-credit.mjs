// Checks reading credit end to end against the mock Anthropic API.
// Needs: node scripts/mock-anthropic.mjs, and `wrangler dev` with .dev.vars:
//   ANTHROPIC_API_KEY=test
//   ANTHROPIC_BASE_URL=http://127.0.0.1:9999
import { execSync } from 'node:child_process';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const stamp = Date.now();
let failures = 0;
const check = (name, ok, extra) => {
  console.log(ok ? '  ok  ' : '  FAIL', name, ok ? '' : JSON.stringify(extra ?? ''));
  if (!ok) failures++;
};
const sql = (q) => execSync(`npx wrangler d1 execute budget-db --local --command "${q}"`, { stdio: 'pipe' });

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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = (c, id) => {
  const f = new FormData();
  f.append('file', new Blob([png], { type: 'image/png' }), 'r.png');
  f.append('client_id', id);
  return c('/uploads', { form: f });
};

const owner = client();
const email = `credit${stamp}@test.zw`;
await owner('/auth/register', { body: { email, password: 'longenough', display_name: 'Credit Test', account_name: 'Credit Test' } });
let r = await upload(owner, `cr${stamp}a`);
check('photo is read and one receipt drafted', r.data.ok === true && r.data.receipt_ids.length === 1, r.data);
r = await owner('/me');
check('charged 20 x $0.000899 = $0.01798', r.data.credit.balance_micros === 5_000_000 - 17_980, r.data.credit);
check('estimate uses the real cost: about 278 receipts per $5', Math.floor(5_000_000 / r.data.credit.per_receipt_micros) === 278, r.data.credit);
r = await owner('/credit');
check('reading shows in the credit history', r.data.ledger[0].kind === 'usage' && r.data.ledger[0].amount_micros === -17_980, r.data.ledger);

const acct = (await owner('/me')).data.user.account_id;
sql(`UPDATE accounts SET credit_micros = 0 WHERE id = ${acct}`);
r = await upload(owner, `cr${stamp}b`);
check('no credit: reading refused with a top-up message', r.data.ok === false && /used up/.test(r.data.error), r.data);
r = await owner('/receipts', { body: {} });
check('typing a receipt in still works with no credit', r.status === 200 && r.data.id, r.data);

sql(`UPDATE users SET is_admin = 1 WHERE email = '${email}'`);
r = await owner('/admin/accounts');
const mine = r.data.accounts?.find((a) => a.id === acct);
check('operator sees the account with its Anthropic cost', mine && mine.cost_micros === 899 && mine.charged_micros === 17_980, mine);
r = await owner(`/admin/accounts/${acct}/credit`, { body: { amount_usd: 5, note: 'EcoCash test' } });
r = await owner('/me');
check('operator top-up of $5 lands', r.data.credit.balance_micros === 5_000_000, r.data.credit);
r = await owner(`/uploads/${(await owner('/uploads/failed')).data.uploads[0].id}/retry`, { method: 'POST' });
check('the refused photo reads after the top-up', r.data.ok === true, r.data);
await owner(`/admin/accounts/${acct}`, { method: 'PATCH', body: { unlimited: true } });
const before = (await owner('/me')).data.credit.balance_micros;
await upload(owner, `cr${stamp}c`);
check('unlimited account is not charged', (await owner('/me')).data.credit.balance_micros === before);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
