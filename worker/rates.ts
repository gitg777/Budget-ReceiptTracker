// Daily exchange rates.
// Source checked on 2026-10-18: the open "currency-api" by fawazahmed0 (CC0, no key) carries ZWG
// and ~340 other currencies, updated daily. Two mirrors of the same data are tried first, then
// open.er-api.com. Every new value is compared with the last stored one and rejected if it
// jumps by more than 60% (protects history from a bad feed day).

import { COMMON_CURRENCIES, rateLooksSane } from '../shared/money';
import { nowIso } from './auth';

interface FetchedRates {
  date: string;
  provider: string;
  rates: Record<string, number>; // upper-case code -> units per USD
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { cf: { cacheTtl: 600 } } as RequestInit);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function fromCurrencyApi(url: string, provider: string): Promise<FetchedRates> {
  const body = await fetchJson(url);
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(body.usd ?? {})) {
    if (typeof value === 'number' && /^[a-z]{3}$/.test(code)) rates[code.toUpperCase()] = value;
  }
  // ZWL is the retired Zimbabwe dollar; the feed derives it from ZWG. Never use it.
  delete rates.ZWL;
  if (!rates.ZWG) throw new Error(`${provider} has no ZWG`);
  return { date: String(body.date), provider, rates };
}

async function fromErApi(): Promise<FetchedRates> {
  const body = await fetchJson('https://open.er-api.com/v6/latest/USD');
  const date = new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);
  const rates: Record<string, number> = { ...(body.rates ?? {}) };
  delete rates.ZWL;
  return { date, provider: 'open.er-api.com', rates };
}

export async function fetchLatestRates(): Promise<FetchedRates> {
  const attempts: Array<() => Promise<FetchedRates>> = [
    () => fromCurrencyApi('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', 'currency-api (jsdelivr)'),
    () => fromCurrencyApi('https://latest.currency-api.pages.dev/v1/currencies/usd.json', 'currency-api (pages.dev)'),
    fromErApi,
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      errors.push(String(e));
    }
  }
  throw new Error('All rate sources failed: ' + errors.join(' | '));
}

/** Currencies worth storing: the common list plus anything that has appeared on a receipt. */
async function wantedCurrencies(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare("SELECT DISTINCT currency FROM receipts WHERE currency <> 'USD'").all<{ currency: string }>();
  return [...new Set([...COMMON_CURRENCIES, ...results.map((r) => r.currency)])].filter((c) => c !== 'USD');
}

export async function refreshRates(db: D1Database): Promise<{ stored: number; provider: string; date: string; rejected: string[] }> {
  const fetched = await fetchLatestRates();
  const wanted = await wantedCurrencies(db);
  const rejected: string[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const code of wanted) {
    const rate = fetched.rates[code];
    if (!rate) continue;
    const prev = await db
      .prepare("SELECT rate_per_usd FROM exchange_rates WHERE account_id IS NULL AND currency = ? AND source = 'auto' ORDER BY rate_date DESC LIMIT 1")
      .bind(code)
      .first<{ rate_per_usd: number }>();
    if (!rateLooksSane(rate, prev?.rate_per_usd ?? null)) {
      rejected.push(`${code} ${rate} (was ${prev?.rate_per_usd})`);
      continue;
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO exchange_rates (account_id, currency, rate_per_usd, rate_date, source, provider, created_at)
           VALUES (NULL, ?, ?, ?, 'auto', ?, ?)
           ON CONFLICT DO UPDATE SET rate_per_usd = excluded.rate_per_usd, provider = excluded.provider, created_at = excluded.created_at`,
        )
        .bind(code, rate, fetched.date, fetched.provider, nowIso()),
    );
  }
  if (statements.length) await db.batch(statements);
  return { stored: statements.length, provider: fetched.provider, date: fetched.date, rejected };
}

export interface RateChoice {
  rate_per_usd: number;
  rate_date: string;
  source: 'auto' | 'manual';
  provider: string | null;
}

/**
 * The rate to suggest for a receipt: the owner's own rate for that day if they set one,
 * otherwise the latest automatic rate on or before the receipt date, otherwise the nearest after it.
 */
export async function suggestRate(db: D1Database, accountId: number, currency: string, date: string | null): Promise<RateChoice | null> {
  if (currency === 'USD') return { rate_per_usd: 1, rate_date: date ?? '', source: 'auto', provider: null };
  const day = date ?? new Date().toISOString().slice(0, 10);
  const manual = await db
    .prepare("SELECT rate_per_usd, rate_date, source, provider FROM exchange_rates WHERE account_id = ? AND currency = ? AND source = 'manual' AND rate_date <= ? ORDER BY rate_date DESC LIMIT 1")
    .bind(accountId, currency, day)
    .first<RateChoice>();
  if (manual && manual.rate_date === day) return manual;
  const before = await db
    .prepare("SELECT rate_per_usd, rate_date, source, provider FROM exchange_rates WHERE account_id IS NULL AND currency = ? AND rate_date <= ? ORDER BY rate_date DESC LIMIT 1")
    .bind(currency, day)
    .first<RateChoice>();
  if (before) return before;
  return db
    .prepare("SELECT rate_per_usd, rate_date, source, provider FROM exchange_rates WHERE account_id IS NULL AND currency = ? ORDER BY rate_date ASC LIMIT 1")
    .bind(currency)
    .first<RateChoice>();
}
