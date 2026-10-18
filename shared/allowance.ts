// Helper allowance and cash-float arithmetic, kept free of database code so it can be tested.

export type Period = 'weekly' | 'monthly' | 'none';

export interface AllowanceSettings {
  allowance_cents: number;
  period: Period;
  carry_over: boolean;
  starts_on: string; // YYYY-MM-DD
}

/** Start (inclusive) and end (exclusive) of the period that contains `today`, as YYYY-MM-DD. */
export function currentPeriod(s: AllowanceSettings, today: string): { start: string; end: string | null } {
  if (s.period === 'none') return { start: s.starts_on, end: null };
  if (s.period === 'monthly') {
    const [y, m] = today.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { start, end };
  }
  // weekly: weeks run from the weekday of starts_on
  const startMs = Date.parse(s.starts_on + 'T00:00:00Z');
  const todayMs = Date.parse(today + 'T00:00:00Z');
  const week = 7 * 86400000;
  const n = Math.max(0, Math.floor((todayMs - startMs) / week));
  const start = new Date(startMs + n * week).toISOString().slice(0, 10);
  const end = new Date(startMs + (n + 1) * week).toISOString().slice(0, 10);
  return { start, end };
}

/** How many periods have begun from starts_on up to and including today's period. */
export function periodsElapsed(s: AllowanceSettings, today: string): number {
  if (s.period === 'none') return 1;
  if (today < s.starts_on) return 0;
  if (s.period === 'monthly') {
    const [y1, m1] = s.starts_on.split('-').map(Number);
    const [y2, m2] = today.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1) + 1;
  }
  const days = (Date.parse(today) - Date.parse(s.starts_on)) / 86400000;
  return Math.floor(days / 7) + 1;
}

/**
 * Allowance still available.
 * - carry_over: every period adds one allowance; unspent money flows forward (and overspending carries too).
 * - no carry_over: only this period's allowance minus this period's spending.
 */
export function allowanceRemaining(
  s: AllowanceSettings,
  today: string,
  spentAllTimeCents: number,
  spentThisPeriodCents: number,
): { budget_cents: number; spent_cents: number; remaining_cents: number } {
  if (s.carry_over || s.period === 'none') {
    const budget = s.allowance_cents * periodsElapsed(s, today);
    return { budget_cents: budget, spent_cents: spentAllTimeCents, remaining_cents: budget - spentAllTimeCents };
  }
  return {
    budget_cents: s.allowance_cents,
    spent_cents: spentThisPeriodCents,
    remaining_cents: s.allowance_cents - spentThisPeriodCents,
  };
}

/** Cash the helper should be holding: cash given - cash returned - receipts paid from the float + cash-up adjustments. */
export function expectedCash(given: number, returned: number, spentFromFloat: number, adjustments: number): number {
  return given - returned - spentFromFloat + adjustments;
}

/** True when the helper should be nudged to cash up or ask for more cash. */
export function cashIsLow(expectedCents: number, allowanceCents: number): boolean {
  const threshold = Math.max(200, Math.round(allowanceCents * 0.1)); // $2 or 10% of allowance
  return expectedCents < threshold;
}
