// API for the Budget & Receipt Tracker. Everything under /api/*; the React app is served as static assets.

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { AppEnv, Env, SessionUser } from './types';
import {
  checkSecret, clearFailures, endSession, lockedMinutes, newPasswordHash, nowIso, randomToken,
  recordFailure, requireOwner, requireUser, startSession,
} from './auth';
import { extractReceipts, SUPPORTED_IMAGE_TYPES, type ExtractedReceipt } from './extract';
import { lastUsedRate, refreshRates, suggestRate } from './rates';
import { canRead, chargeReading, creditStatus, grantStartingCredit } from './credit';
import { applyInput, diff, InputError, type ItemRow, type ReceiptInput, type ReceiptRow } from './receipts';
import { DEFAULT_CATEGORIES, COMMON_CURRENCIES, toCents, toUsdCents } from '../shared/money';
import {
  allowanceRemaining, cashIsLow, currentPeriod, expectedCash, type AllowanceSettings, type Period,
} from '../shared/allowance';

const app = new Hono<AppEnv>();
const api = new Hono<AppEnv>();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const today = () => new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10); // Harare is UTC+2, no DST

async function body<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  try {
    return (await c.req.json()) as Partial<T>;
  } catch {
    return {};
  }
}

app.onError((err, c) => {
  if (err instanceof InputError) return c.json({ error: err.message }, 400);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server. Please try again.' }, 500);
});

// ---------------------------------------------------------------- auth

api.post('/auth/register', async (c) => {
  const b = await body<{ account_name: string; display_name: string; email: string; password: string; code: string }>(c);
  if (c.env.SIGNUP_CODE && (b.code ?? '').trim() !== c.env.SIGNUP_CODE) return c.json({ error: 'Wrong invite code. Ask the person who runs this app.' }, 403);
  const email = (b.email ?? '').trim().toLowerCase();
  const name = (b.display_name ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'Please enter a valid email address.' }, 400);
  if (!name) return c.json({ error: 'Please enter your name.' }, 400);
  if (!b.password || b.password.length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400);
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) return c.json({ error: 'That email already has an account. Please log in.' }, 409);

  const now = nowIso();
  const account = await c.env.DB.prepare('INSERT INTO accounts (name, created_at) VALUES (?, ?) RETURNING id')
    .bind((b.account_name ?? '').trim() || `${name}'s budget`, now)
    .first<{ id: number }>();
  const { hash, salt } = await newPasswordHash(b.password);
  const user = await c.env.DB.prepare(
    "INSERT INTO users (account_id, role, email, display_name, pass_hash, pass_salt, created_at) VALUES (?, 'owner', ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(account!.id, email, name, hash, salt, now)
    .first<{ id: number }>();
  await c.env.DB.batch([
    ...DEFAULT_CATEGORIES.map((cat, i) =>
      c.env.DB.prepare('INSERT INTO categories (account_id, name, sort) VALUES (?, ?, ?)').bind(account!.id, cat, i),
    ),
    ...(await grantStartingCredit(c.env, account!.id)),
  ]);
  await startSession(c, user!.id);
  return c.json({ ok: true });
});

api.post('/auth/login', async (c) => {
  const b = await body<{ login: string; password: string }>(c);
  const login = (b.login ?? '').trim().toLowerCase();
  if (!login || !b.password) return c.json({ error: 'Enter your email (or username) and password.' }, 400);
  const wait = await lockedMinutes(c.env.DB, login);
  if (wait) return c.json({ error: `Too many wrong attempts. Try again in ${wait} minutes.` }, 429);
  const user = await c.env.DB.prepare('SELECT id, pass_hash, pass_salt FROM users WHERE (email = ? OR username = ?) AND active = 1')
    .bind(login, login)
    .first<{ id: number; pass_hash: string; pass_salt: string }>();
  if (!user || !(await checkSecret(b.password, user.pass_hash, user.pass_salt))) {
    await recordFailure(c.env.DB, login);
    return c.json({ error: 'Wrong email/username or password.' }, 401);
  }
  await clearFailures(c.env.DB, login);
  await startSession(c, user.id);
  return c.json({ ok: true });
});

api.post('/auth/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

// Everything below needs a logged-in user.
api.use('/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  return requireUser(c, next);
});

api.post('/me/password', async (c) => {
  const user = c.get('user');
  const b = await body<{ current: string; next: string }>(c);
  const row = await c.env.DB.prepare('SELECT pass_hash, pass_salt FROM users WHERE id = ?').bind(user.id).first<{ pass_hash: string; pass_salt: string }>();
  if (!row || !b.current || !(await checkSecret(b.current, row.pass_hash, row.pass_salt))) return c.json({ error: 'Current password is wrong.' }, 400);
  const min = user.role === 'owner' ? 8 : 4;
  if (!b.next || b.next.length < min) return c.json({ error: `New password must be at least ${min} characters.` }, 400);
  const { hash, salt } = await newPasswordHash(b.next);
  await c.env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(hash, salt, user.id).run();
  return c.json({ ok: true });
});

async function categoriesFor(db: D1Database, accountId: number) {
  const { results } = await db
    .prepare('SELECT id, name, monthly_budget_cents, sort, active FROM categories WHERE account_id = ? ORDER BY sort, name')
    .bind(accountId)
    .all<{ id: number; name: string; monthly_budget_cents: number | null; sort: number; active: number }>();
  return results;
}

api.get('/me', async (c) => {
  const user = c.get('user');
  return c.json({
    user,
    categories: await categoriesFor(c.env.DB, user.account_id),
    currencies: COMMON_CURRENCIES,
    today: today(),
    credit: await creditStatus(c.env, user.account_id),
  });
});

// ---------------------------------------------------------------- categories

api.post('/categories', requireOwner, async (c) => {
  const user = c.get('user');
  const b = await body<{ name: string; monthly_budget: number | null }>(c);
  const name = (b.name ?? '').trim().slice(0, 40);
  if (!name) return c.json({ error: 'Enter a category name.' }, 400);
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM categories WHERE account_id = ?').bind(user.account_id).first<{ m: number }>();
  try {
    await c.env.DB.prepare('INSERT INTO categories (account_id, name, monthly_budget_cents, sort) VALUES (?, ?, ?, ?)')
      .bind(user.account_id, name, b.monthly_budget != null ? toCents(b.monthly_budget) : null, (max?.m ?? 0) + 1)
      .run();
  } catch {
    return c.json({ error: 'That category already exists.' }, 409);
  }
  return c.json({ categories: await categoriesFor(c.env.DB, user.account_id) });
});

api.patch('/categories/:id', requireOwner, async (c) => {
  const user = c.get('user');
  const b = await body<{ name: string; monthly_budget: number | null; active: boolean }>(c);
  const id = Number(c.req.param('id'));
  const cat = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ? AND account_id = ?').bind(id, user.account_id).first<{ name: string; monthly_budget_cents: number | null; active: number }>();
  if (!cat) return c.json({ error: 'Category not found.' }, 404);
  const name = b.name !== undefined ? b.name.trim().slice(0, 40) || cat.name : cat.name;
  const budget = 'monthly_budget' in b ? (b.monthly_budget == null || (b.monthly_budget as unknown) === '' ? null : toCents(b.monthly_budget)) : cat.monthly_budget_cents;
  const active = b.active === undefined ? cat.active : b.active ? 1 : 0;
  await c.env.DB.prepare('UPDATE categories SET name = ?, monthly_budget_cents = ?, active = ? WHERE id = ?').bind(name, budget, active, id).run();
  return c.json({ categories: await categoriesFor(c.env.DB, user.account_id) });
});

// ---------------------------------------------------------------- uploads & extraction

async function receiptAccess(c: Context<AppEnv>, id: number): Promise<ReceiptRow | null> {
  const user = c.get('user');
  const r = await c.env.DB.prepare('SELECT * FROM receipts WHERE id = ? AND account_id = ?').bind(id, user.account_id).first<ReceiptRow>();
  if (!r) return null;
  if (user.role === 'helper' && r.created_by !== user.id) return null; // helpers only see their own
  return r;
}

async function createDrafts(env: Env, user: SessionUser, uploadId: number, extracted: ExtractedReceipt[]): Promise<number[]> {
  const cats = await categoriesFor(env.DB, user.account_id);
  const byName = new Map(cats.map((c) => [c.name, c.id]));
  const defaultPaidBy = user.role === 'owner' ? 'owner' : 'float';
  const ids: number[] = [];
  for (const x of extracted) {
    const currency = /^[A-Z]{3}$/.test(x.currency ?? '') ? (x.currency === 'ZWL' ? 'ZWG' : x.currency) : 'USD';
    const date = x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date <= today() ? x.date : null;
    const rate = await suggestRate(env.DB, user.account_id, currency, date);
    const ratePerUsd = rate?.rate_per_usd ?? 0;
    const totalCents = toCents(x.total);
    const now = nowIso();
    const row = await env.DB.prepare(
      `INSERT INTO receipts (account_id, created_by, upload_id, status, merchant, receipt_date, currency, total_cents,
         rate_per_usd, rate_source, rate_date, total_usd_cents, category_id, payment_method, paid_by, printed_rate,
         confidence, notes, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(
        user.account_id, user.id, uploadId, x.merchant, date, currency, totalCents,
        ratePerUsd, currency === 'USD' ? 'usd' : 'auto', rate?.rate_date ?? null, toUsdCents(totalCents, ratePerUsd),
        byName.get(x.category) ?? byName.get('Other') ?? null, x.payment_method, defaultPaidBy, x.printed_exchange_rate,
        x.confidence, x.notes, now, now,
      )
      .first<{ id: number }>();
    const rid = row!.id;
    ids.push(rid);
    if (x.items.length) {
      await env.DB.batch(
        x.items.map((it, i) =>
          env.DB.prepare(
            'INSERT INTO line_items (receipt_id, position, raw_text, name, quantity, amount_cents, amount_usd_cents, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ).bind(rid, i, it.raw_text, it.name || it.raw_text || 'Item', it.quantity, toCents(it.amount), toUsdCents(toCents(it.amount), ratePerUsd), byName.get(it.category) ?? null),
        ),
      );
    }
  }
  return ids;
}

async function runExtraction(env: Env, user: SessionUser, uploadId: number): Promise<{ ok: boolean; receipt_ids: number[]; error?: string }> {
  const upload = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(uploadId).first<{ r2_key: string; mime: string }>();
  const obj = upload && (await env.IMAGES.get(upload.r2_key));
  if (!upload || !obj) return { ok: false, receipt_ids: [], error: 'File not found.' };
  if (!env.ANTHROPIC_API_KEY) {
    await env.DB.prepare("UPDATE uploads SET status = 'failed', error = ? WHERE id = ?").bind('Receipt reading is not set up yet (no API key).', uploadId).run();
    return { ok: false, receipt_ids: [], error: 'Receipt reading is not set up yet. You can still enter the receipt by hand.' };
  }
  if (!(await canRead(env, user.account_id))) {
    await env.DB.prepare("UPDATE uploads SET status = 'failed', error = 'Out of reading credit.' WHERE id = ?").bind(uploadId).run();
    const who = user.role === 'owner' ? `Contact ${env.SUPPORT_CONTACT || 'the app administrator'} to top up` : 'Ask the owner to top up';
    return { ok: false, receipt_ids: [], error: `Reading credit is used up. ${who}, or type this receipt in by hand.` };
  }
  const cats = (await categoriesFor(env.DB, user.account_id)).filter((c) => c.active).map((c) => c.name);
  try {
    const result = await extractReceipts({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.EXTRACT_MODEL || 'claude-haiku-5-5',
      bytes: await obj.arrayBuffer(),
      mime: upload.mime,
      categories: cats,
    });
    await env.DB.prepare("UPDATE uploads SET status = 'done', error = NULL, model = ?, input_tokens = ?, output_tokens = ?, raw_json = ? WHERE id = ?")
      .bind(result.model, result.input_tokens, result.output_tokens, result.raw, uploadId)
      .run();
    await chargeReading(env, user.account_id, uploadId, result.model, result.input_tokens, result.output_tokens);
    // A retry replaces earlier drafts from the same upload (saved receipts are kept).
    await env.DB.prepare("DELETE FROM receipts WHERE upload_id = ? AND status = 'draft'").bind(uploadId).run();
    const ids = await createDrafts(env, user, uploadId, result.receipts);
    return { ok: true, receipt_ids: ids, error: ids.length ? undefined : 'No receipt found in this photo.' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('extraction failed', uploadId, message);
    await env.DB.prepare("UPDATE uploads SET status = 'failed', error = ? WHERE id = ?").bind(message.slice(0, 500), uploadId).run();
    return { ok: false, receipt_ids: [], error: 'Could not read this receipt. Try again, take a clearer photo, or enter it by hand.' };
  }
}

api.post('/uploads', async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const file = form.get('file');
  const clientId = String(form.get('client_id') ?? '');
  if (!(file instanceof File)) return c.json({ error: 'No file received.' }, 400);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) return c.json({ error: 'Bad upload id.' }, 400);
  const mime = file.type;
  if (!(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mime) && mime !== 'application/pdf') {
    return c.json({ error: 'Please upload a photo (JPEG/PNG) or a PDF.' }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'File is larger than 10 MB.' }, 400);

  // Same client_id again = the phone retried after a dropped connection. Return what we already have.
  const existing = await c.env.DB.prepare('SELECT id, status, error FROM uploads WHERE client_id = ? AND user_id = ?').bind(clientId, user.id).first<{ id: number; status: string; error: string | null }>();
  if (existing) {
    const { results } = await c.env.DB.prepare('SELECT id FROM receipts WHERE upload_id = ?').bind(existing.id).all<{ id: number }>();
    return c.json({ upload_id: existing.id, ok: existing.status === 'done', receipt_ids: results.map((r) => r.id), error: existing.error ?? undefined });
  }

  const key = `${user.account_id}/${today().slice(0, 7)}/${randomToken(12)}${mime === 'application/pdf' ? '.pdf' : ''}`;
  await c.env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: mime } });
  const up = await c.env.DB.prepare("INSERT INTO uploads (account_id, user_id, client_id, r2_key, mime, status, created_at) VALUES (?, ?, ?, ?, ?, 'processing', ?) RETURNING id")
    .bind(user.account_id, user.id, clientId, key, mime, nowIso())
    .first<{ id: number }>();
  const result = await runExtraction(c.env, user, up!.id);
  return c.json({ upload_id: up!.id, ...result });
});

api.get('/uploads/failed', async (c) => {
  // Photos that reached the server but could not be read and have no receipt yet.
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.error, u.created_at, u.mime FROM uploads u
      WHERE u.account_id = ? AND u.status = 'failed' AND (? = 'owner' OR u.user_id = ?)
        AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.upload_id = u.id)
      ORDER BY u.id DESC LIMIT 50`,
  ).bind(user.account_id, user.role, user.id).all();
  return c.json({ uploads: results });
});

api.delete('/uploads/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const up = await c.env.DB.prepare('SELECT user_id, r2_key FROM uploads WHERE id = ? AND account_id = ?').bind(id, user.account_id).first<{ user_id: number; r2_key: string }>();
  if (!up || (user.role === 'helper' && up.user_id !== user.id)) return c.json({ error: 'Not found.' }, 404);
  const linked = await c.env.DB.prepare('SELECT 1 FROM receipts WHERE upload_id = ?').bind(id).first();
  if (linked) return c.json({ error: 'This photo belongs to a receipt. Delete the receipt instead.' }, 400);
  await c.env.IMAGES.delete(up.r2_key);
  await c.env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

api.post('/uploads/:id/retry', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const up = await c.env.DB.prepare('SELECT user_id FROM uploads WHERE id = ? AND account_id = ?').bind(id, user.account_id).first<{ user_id: number }>();
  if (!up || (user.role === 'helper' && up.user_id !== user.id)) return c.json({ error: 'Not found.' }, 404);
  return c.json({ upload_id: id, ...(await runExtraction(c.env, user, id)) });
});

api.get('/uploads/:id/file', async (c) => {
  const user = c.get('user');
  const up = await c.env.DB.prepare('SELECT user_id, r2_key, mime FROM uploads WHERE id = ? AND account_id = ?')
    .bind(Number(c.req.param('id')), user.account_id)
    .first<{ user_id: number; r2_key: string; mime: string }>();
  if (!up || (user.role === 'helper' && up.user_id !== user.id)) return c.json({ error: 'Not found.' }, 404);
  const obj = await c.env.IMAGES.get(up.r2_key);
  if (!obj) return c.json({ error: 'File missing.' }, 404);
  return new Response(obj.body, { headers: { 'content-type': up.mime, 'cache-control': 'private, max-age=86400' } });
});

// ---------------------------------------------------------------- receipts

api.get('/receipts', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status');
  const month = c.req.query('month');
  const helperId = c.req.query('helper');
  const where = ['r.account_id = ?'];
  const args: unknown[] = [user.account_id];
  if (user.role === 'helper') {
    where.push('r.created_by = ?');
    args.push(user.id);
  } else if (helperId) {
    where.push('r.created_by = ?');
    args.push(Number(helperId));
  }
  if (status === 'draft' || status === 'saved') {
    where.push('r.status = ?');
    args.push(status);
  }
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    where.push("substr(COALESCE(r.receipt_date, r.created_at), 1, 7) = ?");
    args.push(month);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.status, r.merchant, r.receipt_date, r.currency, r.total_cents, r.total_usd_cents, r.category_id,
            r.paid_by, r.reimbursed_at, r.confidence, r.edited, r.upload_id, r.created_at, u.display_name AS created_by_name
       FROM receipts r JOIN users u ON u.id = r.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(r.receipt_date, substr(r.created_at, 1, 10)) DESC, r.id DESC LIMIT 300`,
  )
    .bind(...args)
    .all();
  return c.json({ receipts: results });
});

api.get('/receipts/:id', async (c) => {
  const r = await receiptAccess(c, Number(c.req.param('id')));
  if (!r) return c.json({ error: 'Receipt not found.' }, 404);
  const [{ results: items }, { results: edits }, creator] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM line_items WHERE receipt_id = ? ORDER BY position').bind(r.id).all<ItemRow>(),
    c.env.DB.prepare(
      'SELECT e.id, e.changes, e.reason, e.created_at, u.display_name AS by_name FROM receipt_edits e JOIN users u ON u.id = e.user_id WHERE receipt_id = ? ORDER BY e.id DESC',
    ).bind(r.id).all(),
    c.env.DB.prepare('SELECT display_name, role FROM users WHERE id = ?').bind(r.created_by).first<{ display_name: string; role: string }>(),
  ]);
  const suggestion = r.currency === 'USD' ? null : await suggestRate(c.env.DB, r.account_id, r.currency, r.receipt_date);
  const lastUsed = await lastUsedRate(c.env.DB, r.account_id, r.currency, r.id);
  return c.json({
    receipt: { ...r, created_by_name: creator?.display_name, created_by_role: creator?.role },
    items,
    edits,
    rate_suggestion: suggestion,
    last_used_rate: lastUsed,
  });
});

api.post('/receipts', async (c) => {
  // A blank draft for typing a receipt in by hand (no photo, or the photo couldn't be read).
  // upload_id keeps the photo linked when the reading failed.
  const user = c.get('user');
  const b = await body<{ upload_id: number }>(c);
  let uploadId: number | null = null;
  if (b.upload_id) {
    const up = await c.env.DB.prepare('SELECT user_id FROM uploads WHERE id = ? AND account_id = ?').bind(b.upload_id, user.account_id).first<{ user_id: number }>();
    if (!up || (user.role === 'helper' && up.user_id !== user.id)) return c.json({ error: 'Photo not found.' }, 404);
    uploadId = b.upload_id;
  }
  const now = nowIso();
  const row = await c.env.DB.prepare(
    "INSERT INTO receipts (account_id, created_by, upload_id, status, receipt_date, currency, paid_by, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, 'USD', ?, ?, ?) RETURNING id",
  )
    .bind(user.account_id, user.id, uploadId, today(), user.role === 'owner' ? 'owner' : 'float', now, now)
    .first<{ id: number }>();
  return c.json({ id: row!.id });
});

api.put('/receipts/:id', async (c) => {
  const user = c.get('user');
  const current = await receiptAccess(c, Number(c.req.param('id')));
  if (!current) return c.json({ error: 'Receipt not found.' }, 404);
  if (current.reimbursed_at && user.role === 'helper') return c.json({ error: 'This receipt has been paid back and can no longer be changed.' }, 400);
  const input = (await body<ReceiptInput>(c)) as ReceiptInput;
  const { results: currentItems } = await c.env.DB.prepare('SELECT * FROM line_items WHERE receipt_id = ? ORDER BY position').bind(current.id).all<ItemRow>();
  const catIds = new Set((await categoriesFor(c.env.DB, user.account_id)).map((x) => x.id));
  const { receipt: next, items } = applyInput(current, currentItems, input, user, catIds);

  // Audit trail: any change to a photo reading, and any change to a saved receipt, is recorded.
  const changes = diff(current, next, currentItems, items);
  // (A draft that Claude read has a confidence value; a hand-typed draft does not.)
  const logIt = changes.length > 0 && (current.status === 'saved' || current.confidence != null);
  if (logIt) next.edited = 1;

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE receipts SET status = ?, merchant = ?, receipt_date = ?, currency = ?, total_cents = ?, rate_per_usd = ?, rate_source = ?,
         rate_date = ?, total_usd_cents = ?, category_id = ?, payment_method = ?, paid_by = ?, notes = ?, edited = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      next.status, next.merchant, next.receipt_date, next.currency, next.total_cents, next.rate_per_usd, next.rate_source,
      next.rate_date, next.total_usd_cents, next.category_id, next.payment_method, next.paid_by, next.notes, next.edited, next.updated_at,
      next.id,
    ),
    c.env.DB.prepare('DELETE FROM line_items WHERE receipt_id = ?').bind(next.id),
    ...items.map((it) =>
      c.env.DB.prepare(
        'INSERT INTO line_items (receipt_id, position, raw_text, name, quantity, amount_cents, amount_usd_cents, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(next.id, it.position, it.raw_text, it.name, it.quantity, it.amount_cents, it.amount_usd_cents, it.category_id),
    ),
  ];
  if (logIt) {
    const reason = (input.reason ?? '').trim().slice(0, 300) || (current.status === 'draft' ? 'Corrected the photo reading' : null);
    stmts.push(
      c.env.DB.prepare('INSERT INTO receipt_edits (receipt_id, user_id, changes, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(next.id, user.id, JSON.stringify(changes), reason, nowIso()),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, id: next.id, status: next.status, edited: !!next.edited });
});

api.delete('/receipts/:id', async (c) => {
  const user = c.get('user');
  const r = await receiptAccess(c, Number(c.req.param('id')));
  if (!r) return c.json({ error: 'Receipt not found.' }, 404);
  if (r.status === 'saved' && user.role !== 'owner') return c.json({ error: 'Saved receipts can only be deleted by the owner.' }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM receipt_edits WHERE receipt_id = ?').bind(r.id),
    c.env.DB.prepare('DELETE FROM line_items WHERE receipt_id = ?').bind(r.id),
    c.env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(r.id),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- exchange rates

api.get('/rates/today', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT currency, rate_per_usd, rate_date, provider FROM exchange_rates e
      WHERE account_id IS NULL AND source = 'auto'
        AND rate_date = (SELECT MAX(rate_date) FROM exchange_rates x WHERE x.account_id IS NULL AND x.currency = e.currency AND x.source = 'auto')
      ORDER BY currency`,
  ).all();
  const { results: manual } = await c.env.DB.prepare(
    "SELECT currency, rate_per_usd, rate_date FROM exchange_rates WHERE account_id = ? AND source = 'manual' ORDER BY rate_date DESC LIMIT 30",
  ).bind(user.account_id).all();
  return c.json({ auto: results, manual });
});

api.get('/rates/suggest', async (c) => {
  // Going rate and last-used rate for a currency, for the rate choice on a receipt.
  const user = c.get('user');
  const currency = (c.req.query('currency') ?? 'USD').toUpperCase();
  const date = c.req.query('date') || null;
  const exclude = Number(c.req.query('exclude')) || null;
  return c.json({
    suggestion: await suggestRate(c.env.DB, user.account_id, currency, date),
    last_used: await lastUsedRate(c.env.DB, user.account_id, currency, exclude),
  });
});

api.post('/rates', requireOwner, async (c) => {
  const user = c.get('user');
  const b = await body<{ currency: string; rate: number; date: string }>(c);
  const currency = (b.currency ?? '').toUpperCase();
  const rate = Number(b.rate);
  const date = b.date ?? today();
  if (!/^[A-Z]{3}$/.test(currency) || currency === 'USD') return c.json({ error: 'Choose a currency other than USD.' }, 400);
  if (!(rate > 0)) return c.json({ error: 'Rate must be a positive number.' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'Date must be YYYY-MM-DD.' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO exchange_rates (account_id, currency, rate_per_usd, rate_date, source, provider, set_by, created_at)
     VALUES (?, ?, ?, ?, 'manual', 'owner', ?, ?)
     ON CONFLICT DO UPDATE SET rate_per_usd = excluded.rate_per_usd, set_by = excluded.set_by, created_at = excluded.created_at`,
  ).bind(user.account_id, currency, rate, date, user.id, nowIso()).run();
  return c.json({ ok: true });
});

api.post('/rates/refresh', requireOwner, async (c) => c.json(await refreshRates(c.env.DB)));

// ---------------------------------------------------------------- helpers, allowance, cash

interface HelperRow {
  id: number;
  display_name: string;
  username: string;
  active: number;
  allowance_cents: number;
  period: Period;
  carry_over: number;
  starts_on: string;
}

async function helperSummary(db: D1Database, h: HelperRow) {
  const settings: AllowanceSettings = { allowance_cents: h.allowance_cents, period: h.period, carry_over: !!h.carry_over, starts_on: h.starts_on };
  const day = today();
  const period = currentPeriod(settings, day);
  const spend = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN receipt_date >= ? THEN total_usd_cents END), 0) AS all_time,
       COALESCE(SUM(CASE WHEN receipt_date >= ? AND (? IS NULL OR receipt_date < ?) THEN total_usd_cents END), 0) AS this_period,
       COALESCE(SUM(CASE WHEN paid_by = 'float' THEN total_usd_cents END), 0) AS from_float,
       COALESCE(SUM(CASE WHEN paid_by = 'own' AND reimbursed_at IS NULL THEN total_usd_cents END), 0) AS owed
     FROM receipts WHERE created_by = ? AND status = 'saved'`,
  ).bind(h.starts_on, period.start, period.end, period.end, h.id).first<{ all_time: number; this_period: number; from_float: number; owed: number }>();
  const cash = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'given' THEN amount_cents END), 0) AS given,
            COALESCE(SUM(CASE WHEN kind = 'returned' THEN amount_cents END), 0) AS returned,
            COALESCE(SUM(CASE WHEN kind = 'adjustment' THEN amount_cents END), 0) AS adjustments
       FROM cash_ledger WHERE helper_id = ?`,
  ).bind(h.id).first<{ given: number; returned: number; adjustments: number }>();
  const allowance = allowanceRemaining(settings, day, spend!.all_time, spend!.this_period);
  const cashInHand = expectedCash(cash!.given, cash!.returned, spend!.from_float, cash!.adjustments);
  const lastCashUp = await db.prepare('SELECT * FROM cash_ups WHERE helper_id = ? ORDER BY id DESC LIMIT 1').bind(h.id).first();
  return {
    id: h.id,
    display_name: h.display_name,
    username: h.username,
    active: !!h.active,
    settings: { ...settings, carry_over: !!h.carry_over },
    period,
    allowance,
    cash_in_hand_cents: cashInHand,
    cash_low: cashIsLow(cashInHand, h.allowance_cents),
    owed_to_helper_cents: spend!.owed,
    last_cash_up: lastCashUp,
  };
}

const HELPER_SELECT = `SELECT u.id, u.display_name, u.username, u.active, s.allowance_cents, s.period, s.carry_over, s.starts_on
  FROM users u JOIN helper_settings s ON s.user_id = u.id`;

api.get('/helpers', requireOwner, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(`${HELPER_SELECT} WHERE u.account_id = ? ORDER BY u.active DESC, u.display_name`).bind(user.account_id).all<HelperRow>();
  return c.json({ helpers: await Promise.all(results.map((h) => helperSummary(c.env.DB, h))) });
});

api.post('/helpers', requireOwner, async (c) => {
  const user = c.get('user');
  const b = await body<{ display_name: string; username: string; pin: string; allowance: number; period: Period; carry_over: boolean; starts_on: string }>(c);
  const username = (b.username ?? '').trim().toLowerCase();
  const name = (b.display_name ?? '').trim();
  if (!name) return c.json({ error: 'Enter the helper’s name.' }, 400);
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return c.json({ error: 'Username: 3–30 letters or numbers, no spaces.' }, 400);
  if (!/^\d{4,8}$/.test(b.pin ?? '')) return c.json({ error: 'PIN must be 4 to 8 digits.' }, 400);
  const period: Period = b.period && ['weekly', 'monthly', 'none'].includes(b.period) ? b.period : 'monthly';
  const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').bind(username, username).first();
  if (taken) return c.json({ error: 'That username is taken. Try another.' }, 409);
  const { hash, salt } = await newPasswordHash(b.pin!);
  const row = await c.env.DB.prepare(
    "INSERT INTO users (account_id, role, username, display_name, pass_hash, pass_salt, created_at) VALUES (?, 'helper', ?, ?, ?, ?, ?) RETURNING id",
  ).bind(user.account_id, username, name, hash, salt, nowIso()).first<{ id: number }>();
  await c.env.DB.prepare('INSERT INTO helper_settings (user_id, allowance_cents, period, carry_over, starts_on) VALUES (?, ?, ?, ?, ?)')
    .bind(row!.id, toCents(b.allowance ?? 0), period, b.carry_over === false ? 0 : 1, /^\d{4}-\d{2}-\d{2}$/.test(b.starts_on ?? '') ? b.starts_on : today())
    .run();
  return c.json({ id: row!.id });
});

async function ownedHelper(c: Context<AppEnv>, id: number): Promise<HelperRow | null> {
  return c.env.DB.prepare(`${HELPER_SELECT} WHERE u.id = ? AND u.account_id = ? AND u.role = 'helper'`).bind(id, c.get('user').account_id).first<HelperRow>();
}

api.patch('/helpers/:id', requireOwner, async (c) => {
  const h = await ownedHelper(c, Number(c.req.param('id')));
  if (!h) return c.json({ error: 'Helper not found.' }, 404);
  const b = await body<{ display_name: string; pin: string; allowance: number; period: Period; carry_over: boolean; starts_on: string; active: boolean }>(c);
  const stmts: D1PreparedStatement[] = [];
  if (b.pin !== undefined) {
    if (!/^\d{4,8}$/.test(b.pin)) return c.json({ error: 'PIN must be 4 to 8 digits.' }, 400);
    const { hash, salt } = await newPasswordHash(b.pin);
    stmts.push(c.env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(hash, salt, h.id));
    stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(h.id));
  }
  if (b.display_name?.trim()) stmts.push(c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(b.display_name.trim(), h.id));
  if (b.active !== undefined) {
    stmts.push(c.env.DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, h.id));
    if (!b.active) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(h.id));
  }
  const period = b.period && ['weekly', 'monthly', 'none'].includes(b.period) ? b.period : h.period;
  stmts.push(
    c.env.DB.prepare('UPDATE helper_settings SET allowance_cents = ?, period = ?, carry_over = ?, starts_on = ? WHERE user_id = ?').bind(
      b.allowance !== undefined ? toCents(b.allowance) : h.allowance_cents,
      period,
      b.carry_over === undefined ? h.carry_over : b.carry_over ? 1 : 0,
      /^\d{4}-\d{2}-\d{2}$/.test(b.starts_on ?? '') ? b.starts_on : h.starts_on,
      h.id,
    ),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

api.post('/helpers/:id/cash', requireOwner, async (c) => {
  const h = await ownedHelper(c, Number(c.req.param('id')));
  if (!h) return c.json({ error: 'Helper not found.' }, 404);
  const b = await body<{ kind: 'given' | 'returned'; amount: number; note: string }>(c);
  const amount = toCents(b.amount ?? 0);
  if (!['given', 'returned'].includes(b.kind ?? '')) return c.json({ error: 'Choose cash given or cash returned.' }, 400);
  if (amount <= 0) return c.json({ error: 'Enter an amount.' }, 400);
  await c.env.DB.prepare('INSERT INTO cash_ledger (account_id, helper_id, kind, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(c.get('user').account_id, h.id, b.kind, amount, (b.note ?? '').slice(0, 200) || null, c.get('user').id, nowIso())
    .run();
  return c.json({ ok: true });
});

api.post('/helpers/:id/reimburse', requireOwner, async (c) => {
  const h = await ownedHelper(c, Number(c.req.param('id')));
  if (!h) return c.json({ error: 'Helper not found.' }, 404);
  const owed = await c.env.DB.prepare("SELECT COALESCE(SUM(total_usd_cents), 0) AS t FROM receipts WHERE created_by = ? AND paid_by = 'own' AND status = 'saved' AND reimbursed_at IS NULL")
    .bind(h.id).first<{ t: number }>();
  if (!owed?.t) return c.json({ error: 'Nothing is owed to this helper.' }, 400);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE receipts SET reimbursed_at = ? WHERE created_by = ? AND paid_by = 'own' AND status = 'saved' AND reimbursed_at IS NULL").bind(now, h.id),
    c.env.DB.prepare("INSERT INTO cash_ledger (account_id, helper_id, kind, amount_cents, note, created_by, created_at) VALUES (?, ?, 'reimbursed', ?, 'Paid back for own-money receipts', ?, ?)")
      .bind(c.get('user').account_id, h.id, owed.t, c.get('user').id, now),
  ]);
  return c.json({ ok: true, amount_cents: owed.t });
});

api.get('/helpers/:id/ledger', requireOwner, async (c) => {
  const h = await ownedHelper(c, Number(c.req.param('id')));
  if (!h) return c.json({ error: 'Helper not found.' }, 404);
  const [{ results: ledger }, { results: cashUps }] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM cash_ledger WHERE helper_id = ? ORDER BY id DESC LIMIT 100').bind(h.id).all(),
    c.env.DB.prepare('SELECT * FROM cash_ups WHERE helper_id = ? ORDER BY id DESC LIMIT 50').bind(h.id).all(),
  ]);
  return c.json({ summary: await helperSummary(c.env.DB, h), ledger, cash_ups: cashUps });
});

// The helper's own view: allowance, cash in hand, money owed back.
api.get('/my/summary', async (c) => {
  const user = c.get('user');
  if (user.role !== 'helper') return c.json({ error: 'Only for helpers.' }, 400);
  const h = await c.env.DB.prepare(`${HELPER_SELECT} WHERE u.id = ?`).bind(user.id).first<HelperRow>();
  if (!h) return c.json({ error: 'No allowance set up yet. Ask the owner.' }, 404);
  const summary = await helperSummary(c.env.DB, h);
  const { results: byCategory } = await c.env.DB.prepare(
    `SELECT COALESCE(c.name, 'Other') AS category, SUM(li.amount_usd_cents) AS usd_cents
       FROM line_items li JOIN receipts r ON r.id = li.receipt_id LEFT JOIN categories c ON c.id = COALESCE(li.category_id, r.category_id)
      WHERE r.created_by = ? AND r.status = 'saved' AND r.receipt_date >= ? AND (? IS NULL OR r.receipt_date < ?)
      GROUP BY 1 ORDER BY 2 DESC`,
  ).bind(user.id, summary.period.start, summary.period.end, summary.period.end).all();
  return c.json({ ...summary, by_category: byCategory });
});

api.post('/my/cashup', async (c) => {
  const user = c.get('user');
  if (user.role !== 'helper') return c.json({ error: 'Only for helpers.' }, 400);
  const h = await c.env.DB.prepare(`${HELPER_SELECT} WHERE u.id = ?`).bind(user.id).first<HelperRow>();
  if (!h) return c.json({ error: 'No allowance set up yet.' }, 404);
  const b = await body<{ declared: number; hand_back: boolean; note: string }>(c);
  const declared = toCents(b.declared ?? NaN);
  if (!Number.isFinite(Number(b.declared)) || declared < 0) return c.json({ error: 'Enter the cash you have now (0 if none).' }, 400);
  const summary = await helperSummary(c.env.DB, h);
  const expected = summary.cash_in_hand_cents;
  const now = nowIso();
  const note = (b.note ?? '').slice(0, 300) || null;
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('INSERT INTO cash_ups (account_id, helper_id, expected_cents, declared_cents, returned_cents, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(user.account_id, user.id, expected, declared, b.hand_back ? declared : 0, note, now),
  ];
  // The difference between counted and expected cash is recorded openly so the owner sees it.
  if (declared !== expected) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO cash_ledger (account_id, helper_id, kind, amount_cents, note, created_by, created_at) VALUES (?, ?, 'adjustment', ?, ?, ?, ?)")
        .bind(user.account_id, user.id, declared - expected, `Cash-up difference${note ? ': ' + note : ''}`, user.id, now),
    );
  }
  if (b.hand_back && declared > 0) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO cash_ledger (account_id, helper_id, kind, amount_cents, note, created_by, created_at) VALUES (?, ?, 'returned', ?, 'Change handed back at cash-up', ?, ?)")
        .bind(user.account_id, user.id, declared, user.id, now),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, expected_cents: expected, declared_cents: declared, difference_cents: declared - expected });
});

// ---------------------------------------------------------------- reports (owner only)

// Category totals use line items; any gap between the items and the receipt total
// (rounding, unread lines) is counted under the receipt's own category so totals always match.
const CATEGORY_SPEND_SQL = `
  WITH r AS (
    SELECT id, category_id, total_usd_cents FROM receipts
     WHERE account_id = ?1 AND status = 'saved' AND receipt_date >= ?2 AND receipt_date < ?3
  ),
  parts AS (
    SELECT COALESCE(li.category_id, r.category_id) AS category_id, li.amount_usd_cents AS usd
      FROM line_items li JOIN r ON r.id = li.receipt_id
    UNION ALL
    SELECT r.category_id, r.total_usd_cents - COALESCE((SELECT SUM(amount_usd_cents) FROM line_items WHERE receipt_id = r.id), 0)
      FROM r
  )
  SELECT parts.category_id, c.name, c.monthly_budget_cents, SUM(usd) AS usd_cents
    FROM parts LEFT JOIN categories c ON c.id = parts.category_id
   GROUP BY parts.category_id HAVING SUM(usd) <> 0 ORDER BY usd_cents DESC`;

function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return [start, end];
}

api.get('/reports/month', requireOwner, async (c) => {
  const user = c.get('user');
  const month = /^\d{4}-\d{2}$/.test(c.req.query('month') ?? '') ? c.req.query('month')! : today().slice(0, 7);
  const [start, end] = monthRange(month);
  const db = c.env.DB;
  const [{ results: byCategory }, totals, { results: byMerchant }, { results: byPerson }, { results: budgets }, { results: trend }] = await Promise.all([
    db.prepare(CATEGORY_SPEND_SQL).bind(user.account_id, start, end).all(),
    db.prepare("SELECT COUNT(*) AS receipts, COALESCE(SUM(total_usd_cents), 0) AS usd_cents FROM receipts WHERE account_id = ? AND status = 'saved' AND receipt_date >= ? AND receipt_date < ?")
      .bind(user.account_id, start, end).first<{ receipts: number; usd_cents: number }>(),
    db.prepare(
      "SELECT COALESCE(merchant, 'Unknown') AS merchant, COUNT(*) AS receipts, SUM(total_usd_cents) AS usd_cents FROM receipts WHERE account_id = ? AND status = 'saved' AND receipt_date >= ? AND receipt_date < ? GROUP BY 1 ORDER BY 3 DESC LIMIT 15",
    ).bind(user.account_id, start, end).all(),
    db.prepare(
      "SELECT u.display_name AS person, u.role, COUNT(*) AS receipts, SUM(r.total_usd_cents) AS usd_cents FROM receipts r JOIN users u ON u.id = r.created_by WHERE r.account_id = ? AND r.status = 'saved' AND r.receipt_date >= ? AND r.receipt_date < ? GROUP BY u.id ORDER BY 4 DESC",
    ).bind(user.account_id, start, end).all(),
    db.prepare('SELECT id, name, monthly_budget_cents FROM categories WHERE account_id = ? AND monthly_budget_cents IS NOT NULL').bind(user.account_id).all(),
    db.prepare(
      "SELECT substr(receipt_date, 1, 7) AS month, SUM(total_usd_cents) AS usd_cents FROM receipts WHERE account_id = ? AND status = 'saved' AND receipt_date >= date(?, '-11 months') AND receipt_date < ? GROUP BY 1 ORDER BY 1",
    ).bind(user.account_id, start, end).all(),
  ]);
  return c.json({ month, totals, by_category: byCategory, by_merchant: byMerchant, by_person: byPerson, budgets, trend });
});

api.get('/reports/search', requireOwner, async (c) => {
  // "How much did I spend on milk?" — searches item names, the printed text, and shop names.
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const from = c.req.query('from') ?? '0000-01-01';
  const to = c.req.query('to') ?? '9999-12-31';
  if (q.length < 2) return c.json({ error: 'Type at least 2 letters.' }, 400);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const { results: items } = await c.env.DB.prepare(
    `SELECT li.name, li.raw_text, li.quantity, li.amount_cents, li.amount_usd_cents, r.currency, r.receipt_date, r.merchant, r.id AS receipt_id
       FROM line_items li JOIN receipts r ON r.id = li.receipt_id
      WHERE r.account_id = ? AND r.status = 'saved' AND r.receipt_date >= ? AND r.receipt_date <= ?
        AND (lower(li.name) LIKE ? OR lower(COALESCE(li.raw_text, '')) LIKE ?)
      ORDER BY r.receipt_date DESC LIMIT 500`,
  ).bind(user.account_id, from, to, like, like).all<{ amount_usd_cents: number; receipt_date: string }>();
  const { results: merchants } = await c.env.DB.prepare(
    `SELECT merchant, COUNT(*) AS receipts, SUM(total_usd_cents) AS usd_cents FROM receipts
      WHERE account_id = ? AND status = 'saved' AND receipt_date >= ? AND receipt_date <= ? AND lower(COALESCE(merchant, '')) LIKE ?
      GROUP BY merchant ORDER BY 3 DESC LIMIT 20`,
  ).bind(user.account_id, from, to, like).all();
  const byMonth: Record<string, number> = {};
  for (const it of items) byMonth[it.receipt_date.slice(0, 7)] = (byMonth[it.receipt_date.slice(0, 7)] ?? 0) + it.amount_usd_cents;
  return c.json({
    q,
    item_total_usd_cents: items.reduce((s, it) => s + it.amount_usd_cents, 0),
    items,
    by_month: Object.entries(byMonth).sort().map(([month, usd_cents]) => ({ month, usd_cents })),
    merchants,
  });
});

api.get('/reports/export', requireOwner, async (c) => {
  // Raw rows for the Excel download (built in the browser).
  const user = c.get('user');
  const from = c.req.query('from') ?? '0000-01-01';
  const to = c.req.query('to') ?? '9999-12-31';
  const [{ results: receipts }, { results: items }, { results: edits }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.id, r.receipt_date, r.merchant, r.currency, r.total_cents, r.rate_per_usd, r.rate_source, r.rate_date, r.total_usd_cents,
              c.name AS category, r.payment_method, r.paid_by, r.reimbursed_at, u.display_name AS entered_by, r.edited, r.notes
         FROM receipts r JOIN users u ON u.id = r.created_by LEFT JOIN categories c ON c.id = r.category_id
        WHERE r.account_id = ? AND r.status = 'saved' AND r.receipt_date >= ? AND r.receipt_date <= ? ORDER BY r.receipt_date, r.id`,
    ).bind(user.account_id, from, to).all(),
    c.env.DB.prepare(
      `SELECT li.receipt_id, r.receipt_date, r.merchant, li.raw_text, li.name, li.quantity, r.currency, li.amount_cents, li.amount_usd_cents,
              COALESCE(c.name, rc.name) AS category
         FROM line_items li JOIN receipts r ON r.id = li.receipt_id
         LEFT JOIN categories c ON c.id = li.category_id LEFT JOIN categories rc ON rc.id = r.category_id
        WHERE r.account_id = ? AND r.status = 'saved' AND r.receipt_date >= ? AND r.receipt_date <= ? ORDER BY r.receipt_date, li.receipt_id, li.position`,
    ).bind(user.account_id, from, to).all(),
    c.env.DB.prepare(
      `SELECT e.receipt_id, e.created_at, u.display_name AS by_name, e.changes, e.reason FROM receipt_edits e
         JOIN receipts r ON r.id = e.receipt_id JOIN users u ON u.id = e.user_id
        WHERE r.account_id = ? AND r.receipt_date >= ? AND r.receipt_date <= ? ORDER BY e.id`,
    ).bind(user.account_id, from, to).all(),
  ]);
  return c.json({ receipts, items, edits });
});

// ---------------------------------------------------------------- reading credit

api.get('/credit', requireOwner, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT kind, amount_micros, note, created_at FROM credit_ledger WHERE account_id = ? ORDER BY id DESC LIMIT 30',
  ).bind(user.account_id).all();
  return c.json({ ...(await creditStatus(c.env, user.account_id)), ledger: results });
});

// ---------------------------------------------------------------- operator (admin) — every account

async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (!c.get('user').is_admin) return c.json({ error: 'Not allowed.' }, 403);
  await next();
}

api.get('/admin/accounts', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.credit_micros, a.unlimited, a.created_at,
            (SELECT display_name FROM users WHERE account_id = a.id AND role = 'owner' ORDER BY id LIMIT 1) AS owner_name,
            (SELECT email FROM users WHERE account_id = a.id AND role = 'owner' ORDER BY id LIMIT 1) AS owner_email,
            (SELECT COUNT(*) FROM users WHERE account_id = a.id AND role = 'helper') AS helpers,
            (SELECT COUNT(*) FROM uploads WHERE account_id = a.id AND status = 'done') AS readings,
            (SELECT COALESCE(SUM(cost_micros), 0) FROM uploads WHERE account_id = a.id) AS cost_micros,
            (SELECT COALESCE(SUM(charge_micros), 0) FROM uploads WHERE account_id = a.id) AS charged_micros,
            (SELECT COALESCE(SUM(amount_micros), 0) FROM credit_ledger WHERE account_id = a.id AND kind = 'topup') AS topups_micros,
            (SELECT MAX(created_at) FROM uploads WHERE account_id = a.id) AS last_reading
       FROM accounts a ORDER BY a.id DESC`,
  ).all();
  return c.json({ accounts: results });
});

api.post('/admin/accounts/:id/credit', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const b = await body<{ amount_usd: number; note: string; kind: 'topup' | 'adjust' }>(c);
  const amount = Math.round(Number(b.amount_usd) * 1_000_000);
  if (!Number.isFinite(amount) || amount === 0) return c.json({ error: 'Enter an amount in USD.' }, 400);
  const kind = b.kind === 'adjust' || amount < 0 ? 'adjust' : 'topup';
  const exists = await c.env.DB.prepare('SELECT 1 FROM accounts WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'Account not found.' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE accounts SET credit_micros = credit_micros + ? WHERE id = ?').bind(amount, id),
    c.env.DB.prepare('INSERT INTO credit_ledger (account_id, kind, amount_micros, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, kind, amount, (b.note ?? '').slice(0, 200) || null, c.get('user').id, nowIso()),
  ]);
  return c.json({ ok: true });
});

api.patch('/admin/accounts/:id', requireAdmin, async (c) => {
  const b = await body<{ unlimited: boolean }>(c);
  await c.env.DB.prepare('UPDATE accounts SET unlimited = ? WHERE id = ?').bind(b.unlimited ? 1 : 0, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      refreshRates(env.DB).then(
        (r) => console.log('rates refreshed', JSON.stringify(r)),
        (e) => console.error('rate refresh failed', String(e)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;

export { app };
