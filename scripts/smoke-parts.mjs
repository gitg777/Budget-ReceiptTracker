// Long receipts (several photos read as one), "Totals only", adding a missed part, and in-app feedback.
// Needs the same setup as smoke-credit.mjs: node scripts/mock-anthropic.mjs, and `wrangler dev` with .dev.vars:
//   ANTHROPIC_API_KEY=test
//   ANTHROPIC_BASE_URL=http://127.0.0.1:9999
import { execSync } from 'node:child_process';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const MOCK = 'http://127.0.0.1:9999';
const stamp = Date.now();
let failures = 0;
const check = (name, ok, extra) => {
  console.log(ok ? '  ok  ' : '  FAIL', name, ok ? '' : JSON.stringify(extra ?? ''));
  if (!ok) failures++;
};
const sql = (q) => execSync(`npx wrangler d1 execute budget-db --local --command "${q}"`, { stdio: 'pipe' });
const lastSent = () => fetch(MOCK + '/last').then((r) => r.json());

function client() {
  let cookie = '';
  return async (path, { method, body, form } = {}) => {
    const send = () => fetch(BASE + '/api' + path, {
      method: method ?? (body || form ? 'POST' : 'GET'),
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    // The local server can drop one connection right after the test edits its database directly.
    const res = await send().catch(() => new Promise((ok) => setTimeout(ok, 1500)).then(send));
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, type: res.headers.get('content-type') };
  };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photos = (n, extra = {}) => {
  const f = new FormData();
  for (let i = 0; i < n; i++) f.append('file', new Blob([png], { type: 'image/png' }), `part${i + 1}.png`);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};

const owner = client();
const email = `parts${stamp}@test.zw`;
await owner('/auth/register', { body: { email, password: 'longenough', display_name: 'Parts Test', account_name: 'Parts Test' } });

let r = await owner('/uploads', { form: photos(3, { client_id: `pt${stamp}a` }) });
check('3 photos of one long receipt come back as one receipt', r.data.ok === true && r.data.receipt_ids.length === 1, r.data);
let sent = await lastSent();
check('all 3 photos went to Claude in one request', sent.images === 3, sent);
check('Claude was told they are parts of ONE receipt', /parts of ONE long receipt/.test(sent.text), sent.text);
const uploadId = r.data.upload_id;
let rid = r.data.receipt_ids[0];
r = await owner(`/receipts/${rid}`);
check('receipt knows it has 3 photos', r.data.photo?.parts === 3 && r.data.photo.mode === 'full', r.data.photo);
r = await owner(`/uploads/${uploadId}/file?part=2`);
check('third photo can be opened', r.type === 'image/png', r.type);

r = await owner(`/uploads/${uploadId}/parts`, { form: photos(1) });
check('a missed part is added and everything is read again', r.data.ok === true && r.data.parts === 4 && r.data.receipt_ids.length === 1, r.data);
sent = await lastSent();
check('the re-read sends all 4 photos', sent.images === 4, sent);
rid = r.data.receipt_ids[0];
r = await owner(`/receipts/${rid}`);
check('old draft replaced by the new reading', r.data.photo?.parts === 4, r.data.photo);
check('a re-read is charged like any reading', (await owner('/me')).data.credit.balance_micros === 5_000_000 - 2 * 17_980);

r = await owner(`/receipts/${rid}`, { method: 'PUT', body: { save: true } });
r = await owner(`/uploads/${uploadId}/parts`, { form: photos(1) });
check('no adding photos once the receipt is saved', r.status === 400, r.data);

r = await owner('/uploads', { form: photos(2, { client_id: `pt${stamp}b`, mode: 'totals' }) });
sent = await lastSent();
check('Totals only is passed to Claude', r.data.ok === true && /Totals only/.test(sent.text), sent.text);
r = await owner('/uploads', { form: photos(7, { client_id: `pt${stamp}c` }) });
check('more than 6 photos refused', r.status === 400, r.data);
const pdf = new FormData();
pdf.append('file', new Blob(['%PDF-1.4\n%mock\n'], { type: 'application/pdf' }), 'invoice.pdf');
pdf.append('client_id', `pt${stamp}d`);
r = await owner('/uploads', { form: pdf });
sent = await lastSent();
check('a PDF is sent as a document', r.data.ok === true && sent.documents === 1 && sent.images === 0, sent);

const helperName = `helper${stamp}`;
await owner('/helpers', { body: { display_name: 'Tendai', username: helperName, pin: '4321', allowance: 50, period: 'weekly', carry_over: false } });
const helper = client();
await helper('/auth/login', { body: { login: helperName, password: '4321' } });
r = await helper('/feedback', { body: { kind: 'idea', message: 'Please add a fuel log.' } });
check('helper sends feedback', r.status === 200, r.data);
r = await helper('/feedback', { body: { kind: 'rant', message: 'x' } });
check('bad feedback refused', r.status === 400);
r = await helper('/feedback/mine');
check('helper sees what they sent', r.data.feedback?.[0]?.message === 'Please add a fuel log.' && r.data.feedback[0].status === 'new', r.data);
r = await owner('/admin/feedback');
check('only the operator can read all feedback', r.status === 403);
sql(`UPDATE users SET is_admin = 1 WHERE email = '${email}'`);
r = await owner('/admin/feedback');
const fb = r.data.feedback?.find((f) => f.message === 'Please add a fuel log.');
check('operator sees it with who sent it', fb && fb.display_name === 'Tendai' && fb.account_name === 'Parts Test', fb);
await owner(`/admin/feedback/${fb.id}`, { method: 'PATCH', body: { status: 'done' } });
r = await helper('/feedback/mine');
check('helper sees it was dealt with', r.data.feedback[0].status === 'done', r.data);

const share = await fetch(BASE + '/share', { method: 'POST', redirect: 'manual', body: photos(1) });
check('share link without the service worker just opens the app', share.status === 303 && share.headers.get('location') === '/#/home', share.status);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
