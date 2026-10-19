import { describe, expect, it } from 'vitest';
import { apiCostMicros, chargeMicros, formatCredit, receiptsFor } from '../shared/pricing';

describe('reading cost', () => {
  it('matches the first real reading (5,360 in / 726 out on Haiku 5.5)', () => {
    expect(apiCostMicros('claude-haiku-5-5', 5360, 726)).toBe(899); // $0.000899
    expect(chargeMicros(899, 20)).toBe(17980); // about 1.8 cents
  });
  it('uses Sonnet prices when the model is switched', () => {
    expect(apiCostMicros('claude-sonnet-5-5', 5360, 726)).toBe(17980);
  });
  it('never undercharges for an unknown model', () => {
    expect(apiCostMicros('claude-something-new', 1000, 1000)).toBe(24000);
  });
  it('shows money and receipt counts', () => {
    expect(formatCredit(5_000_000)).toBe('$5.00');
    expect(formatCredit(-17_980)).toBe('-$0.02');
    expect(receiptsFor(5_000_000, 17_980)).toBe(278);
    expect(receiptsFor(-1, 17_980)).toBe(0);
  });
});
