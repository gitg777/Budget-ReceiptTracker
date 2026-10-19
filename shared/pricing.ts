// What Anthropic charges per million tokens (USD), from Anthropic's published prices as of Oct 2026.
// $X per million tokens is the same as X micro-dollars per token, which is how credit is stored.
// Check console.anthropic.com/pricing when changing models; unknown models use the dearest row
// so the app never undercharges.

interface Rate {
  input: number;
  output: number;
  /** Price once a prompt passes 100K tokens (Haiku 5.5 only); receipts never get near this. */
  longInput?: number;
  longOutput?: number;
}

export const API_PRICES: Record<string, Rate> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

const FALLBACK: Rate = API_PRICES['claude-opus-5-5'];

/** Anthropic's charge for one request, in micro-dollars. */
export function apiCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(API_PRICES).find((k) => model === k || model.startsWith(k + '-'));
  const r = key ? API_PRICES[key] : FALLBACK;
  const long = inputTokens > 100_000 && r.longInput !== undefined;
  const inRate = long ? r.longInput! : r.input;
  const outRate = long ? r.longOutput! : r.output;
  return Math.ceil(inputTokens * inRate + outputTokens * outRate);
}

/** What the account pays: Anthropic's cost times the markup, rounded up to a whole micro-dollar. */
export function chargeMicros(costMicros: number, markup: number): number {
  return Math.ceil(costMicros * markup);
}

export const TOPUP_PACKS_USD = [1, 5, 10, 20] as const;

/** Estimated charge for one receipt before any real readings exist (measured 19 Oct 2026: 5,360 in / 726 out on Haiku). */
export const DEFAULT_RECEIPT_COST_MICROS = 899;

export function formatCredit(micros: number): string {
  const usd = micros / 1_000_000;
  return (usd < 0 ? '-$' : '$') + Math.abs(usd).toFixed(2);
}

export function receiptsFor(micros: number, perReceiptMicros: number): number {
  if (perReceiptMicros <= 0) return 0;
  return Math.max(0, Math.floor(micros / perReceiptMicros));
}
