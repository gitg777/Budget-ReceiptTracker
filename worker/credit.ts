// Prepaid reading credit. Each receipt reading costs Anthropic's price times MARKUP,
// taken from the account's balance. New accounts start with FREE_CREDIT_USD.

import { apiCostMicros, chargeMicros, DEFAULT_RECEIPT_COST_MICROS, TOPUP_PACKS_USD } from '../shared/pricing';
import type { Env } from './types';
import { nowIso } from './auth';

export function markup(env: Env): number {
  const m = Number(env.MARKUP);
  return Number.isFinite(m) && m > 0 ? m : 20;
}

export function freeCreditMicros(env: Env): number {
  const usd = Number(env.FREE_CREDIT_USD);
  return Math.round((Number.isFinite(usd) && usd >= 0 ? usd : 5) * 1_000_000);
}

export async function grantStartingCredit(env: Env, accountId: number): Promise<D1PreparedStatement[]> {
  const amount = freeCreditMicros(env);
  return [
    env.DB.prepare('UPDATE accounts SET credit_micros = credit_micros + ? WHERE id = ?').bind(amount, accountId),
    env.DB.prepare("INSERT INTO credit_ledger (account_id, kind, amount_micros, note, created_at) VALUES (?, 'grant', ?, 'Free starting credit', ?)")
      .bind(accountId, amount, nowIso()),
  ];
}

/** True if the account may start another reading (unlimited, or balance above zero). */
export async function canRead(env: Env, accountId: number): Promise<boolean> {
  const a = await env.DB.prepare('SELECT credit_micros, unlimited FROM accounts WHERE id = ?').bind(accountId).first<{ credit_micros: number; unlimited: number }>();
  return !!a && (a.unlimited === 1 || a.credit_micros > 0);
}

/** Records what a reading cost and takes the charge from the account (unless unlimited). */
export async function chargeReading(env: Env, accountId: number, uploadId: number, model: string, inputTokens: number, outputTokens: number) {
  const cost = apiCostMicros(model, inputTokens, outputTokens);
  const a = await env.DB.prepare('SELECT unlimited FROM accounts WHERE id = ?').bind(accountId).first<{ unlimited: number }>();
  const charge = a?.unlimited ? 0 : chargeMicros(cost, markup(env));
  const stmts = [env.DB.prepare('UPDATE uploads SET cost_micros = ?, charge_micros = ? WHERE id = ?').bind(cost, charge, uploadId)];
  if (charge > 0) {
    stmts.push(
      env.DB.prepare('UPDATE accounts SET credit_micros = credit_micros - ? WHERE id = ?').bind(charge, accountId),
      env.DB.prepare("INSERT INTO credit_ledger (account_id, kind, amount_micros, upload_id, note, created_at) VALUES (?, 'usage', ?, ?, 'Receipt reading', ?)")
        .bind(accountId, -charge, uploadId, nowIso()),
    );
  }
  await env.DB.batch(stmts);
}

/** Average charge per reading, from this account's recent readings, else everyone's, else the measured default. */
async function perReceiptMicros(env: Env, accountId: number): Promise<number> {
  const mine = await env.DB.prepare(
    'SELECT AVG(cost_micros) AS avg FROM (SELECT cost_micros FROM uploads WHERE account_id = ? AND cost_micros IS NOT NULL ORDER BY id DESC LIMIT 30)',
  ).bind(accountId).first<{ avg: number | null }>();
  const all = mine?.avg
    ? null
    : await env.DB.prepare('SELECT AVG(cost_micros) AS avg FROM (SELECT cost_micros FROM uploads WHERE cost_micros IS NOT NULL ORDER BY id DESC LIMIT 100)').first<{ avg: number | null }>();
  const cost = mine?.avg ?? all?.avg ?? DEFAULT_RECEIPT_COST_MICROS;
  return Math.ceil(cost * markup(env));
}

export async function creditStatus(env: Env, accountId: number) {
  const a = await env.DB.prepare('SELECT credit_micros, unlimited FROM accounts WHERE id = ?').bind(accountId).first<{ credit_micros: number; unlimited: number }>();
  return {
    balance_micros: a?.credit_micros ?? 0,
    unlimited: a?.unlimited === 1,
    per_receipt_micros: await perReceiptMicros(env, accountId),
    packs_usd: TOPUP_PACKS_USD,
    contact: env.SUPPORT_CONTACT || 'the app administrator',
  };
}
