// Money helpers shared by the app and the Worker.
// Amounts are whole cents; rates are "units of currency per 1 USD".

export function toCents(value: number | string | null | undefined): number {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Convert an amount in some currency to USD cents using the rate for that receipt. */
export function toUsdCents(cents: number, ratePerUsd: number): number {
  if (!ratePerUsd || ratePerUsd <= 0) return 0;
  return Math.round(cents / ratePerUsd);
}

export function formatMoney(cents: number, currency = 'USD'): string {
  const value = fromCents(cents).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'USD' ? `$${value}` : `${currency} ${value}`;
}

export const COMMON_CURRENCIES = ['USD', 'ZWG', 'ZAR', 'BWP', 'ZMW', 'MZN', 'GBP', 'EUR'] as const;

export const DEFAULT_CATEGORIES = [
  'Groceries', 'Fuel', 'Transport', 'Household', 'Utilities', 'Airtime & Data', 'School',
  'Medical', 'Eating Out', 'Clothing', 'Personal Care', 'Donations', 'Other',
] as const;

// Sanity band for an exchange rate: refuse anything wildly off yesterday's value.
export function rateLooksSane(newRate: number, previous: number | null): boolean {
  if (!Number.isFinite(newRate) || newRate <= 0) return false;
  if (!previous) return true;
  const ratio = newRate / previous;
  return ratio > 0.6 && ratio < 1.6;
}
