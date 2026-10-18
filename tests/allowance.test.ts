import { describe, expect, it } from 'vitest';
import { allowanceRemaining, cashIsLow, currentPeriod, expectedCash, periodsElapsed } from '../shared/allowance';

const monthly = { allowance_cents: 10000, period: 'monthly' as const, carry_over: true, starts_on: '2026-08-15' };

describe('allowance periods', () => {
  it('monthly periods follow calendar months', () => {
    expect(currentPeriod(monthly, '2026-10-18')).toEqual({ start: '2026-10-01', end: '2026-11-01' });
    expect(currentPeriod(monthly, '2026-12-05')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });
  it('weekly periods start on the weekday of the start date', () => {
    const weekly = { ...monthly, period: 'weekly' as const, starts_on: '2026-10-05' }; // a Monday
    expect(currentPeriod(weekly, '2026-10-18')).toEqual({ start: '2026-10-12', end: '2026-10-19' });
    expect(periodsElapsed(weekly, '2026-10-18')).toBe(2);
  });
  it('counts months since the start, including the first', () => {
    expect(periodsElapsed(monthly, '2026-10-18')).toBe(3);
    expect(periodsElapsed(monthly, '2026-08-01')).toBe(0);
  });
});

describe('allowance remaining', () => {
  it('carry-over: unspent money flows forward', () => {
    // 3 months x $100 = $300, spent $220 in total
    expect(allowanceRemaining(monthly, '2026-10-18', 22000, 5000)).toEqual({ budget_cents: 30000, spent_cents: 22000, remaining_cents: 8000 });
  });
  it('no carry-over: only this period counts', () => {
    expect(allowanceRemaining({ ...monthly, carry_over: false }, '2026-10-18', 22000, 5000)).toEqual({ budget_cents: 10000, spent_cents: 5000, remaining_cents: 5000 });
  });
  it('overspending shows as negative', () => {
    expect(allowanceRemaining({ ...monthly, carry_over: false }, '2026-10-18', 0, 12500).remaining_cents).toBe(-2500);
  });
});

describe('cash in hand', () => {
  it('given minus returned minus float spending plus cash-up differences', () => {
    expect(expectedCash(5000, 1000, 2500, -200)).toBe(1300);
  });
  it('flags low cash at $2 or 10% of allowance', () => {
    expect(cashIsLow(150, 0)).toBe(true);
    expect(cashIsLow(900, 10000)).toBe(true);
    expect(cashIsLow(1100, 10000)).toBe(false);
  });
});
