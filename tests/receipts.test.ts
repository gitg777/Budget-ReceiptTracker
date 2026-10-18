import { describe, expect, it } from 'vitest';
import { applyInput, diff, InputError, type ReceiptRow } from '../worker/receipts';
import { toCents, toUsdCents, rateLooksSane } from '../shared/money';

const helper = { id: 2, account_id: 1, account_name: 'Home', role: 'helper' as const, display_name: 'Grace', email: null, username: 'grace' };
const owner = { ...helper, id: 1, role: 'owner' as const, display_name: 'Owner' };

const base: ReceiptRow = {
  id: 10, account_id: 1, created_by: 2, upload_id: 5, status: 'draft', merchant: 'Fortwell', receipt_date: '2026-10-17',
  currency: 'ZWG', total_cents: 26600, rate_per_usd: 26.6, rate_source: 'auto', rate_date: '2026-10-17', total_usd_cents: 1000,
  category_id: 1, payment_method: null, paid_by: 'float', reimbursed_at: null, printed_rate: null, confidence: 'high', notes: null,
  edited: 0, created_at: '', updated_at: '',
};
const cats = new Set([1, 2, 3]);

describe('money', () => {
  it('converts and rounds', () => {
    expect(toCents('12.345')).toBe(1235);
    expect(toCents('$1,200.50')).toBe(120050);
    expect(toUsdCents(26600, 26.6)).toBe(1000);
    expect(toUsdCents(100, 0)).toBe(0);
  });
  it('rejects wild rate jumps', () => {
    expect(rateLooksSane(26.7, 26.6)).toBe(true);
    expect(rateLooksSane(66500, 26.6)).toBe(false); // the old ZWL number
    expect(rateLooksSane(-1, null)).toBe(false);
  });
});

describe('applyInput', () => {
  it('converts ZWG to USD with the chosen rate and keeps it on the receipt', () => {
    const { receipt, items } = applyInput(base, [], { total: 532, rate_per_usd: 26.6, rate_source: 'manual', items: [{ name: 'Bread', amount: 532 }], save: true }, helper, cats);
    expect(receipt.total_usd_cents).toBe(2000);
    expect(receipt.rate_source).toBe('manual');
    expect(receipt.status).toBe('saved');
    expect(items[0].amount_usd_cents).toBe(2000);
  });
  it('USD receipts always use rate 1', () => {
    const { receipt } = applyInput(base, [], { currency: 'USD', total: 12.5, rate_per_usd: 99 }, helper, cats);
    expect(receipt.rate_per_usd).toBe(1);
    expect(receipt.total_usd_cents).toBe(1250);
  });
  it('refuses to save without a date or total', () => {
    expect(() => applyInput({ ...base, receipt_date: null }, [], { save: true }, helper, cats)).toThrow(InputError);
    expect(() => applyInput(base, [], { total: 0, save: true }, helper, cats)).toThrow(/total/);
  });
  it('refuses unknown categories (another account’s ids)', () => {
    expect(() => applyInput(base, [], { category_id: 99 }, helper, cats)).toThrow(/category/);
  });
  it('owner receipts cannot be marked as helper money', () => {
    expect(() => applyInput({ ...base, created_by: 1 }, [], { paid_by: 'own' }, owner, cats)).toThrow(InputError);
  });
});

describe('audit diff', () => {
  it('records changed fields and lines', () => {
    const { receipt, items } = applyInput(base, [], { total: 300, items: [{ name: 'Milk', amount: 300 }] }, helper, cats);
    const changes = diff(base, receipt, [{ name: 'Milk', amount_cents: 26600, category_id: null }], items);
    expect(changes.map((c) => c.field)).toEqual(['Total', 'Line 1 amount']);
    expect(changes[0]).toEqual({ field: 'Total', from: 26600, to: 30000 });
  });
  it('is empty when nothing changed', () => {
    const { receipt, items } = applyInput(base, [], {}, helper, cats);
    expect(diff(base, receipt, [], items)).toEqual([]);
  });
});
