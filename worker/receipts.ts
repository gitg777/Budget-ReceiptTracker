// Saving receipts: validation, USD conversion, and the edit audit trail.

import { toCents, toUsdCents } from '../shared/money';
import type { SessionUser } from './types';
import { nowIso } from './auth';

export interface ItemInput {
  raw_text?: string | null;
  name: string;
  quantity?: number | null;
  amount: number; // in receipt currency, decimal
  category_id?: number | null;
}

export interface ReceiptInput {
  merchant?: string | null;
  receipt_date?: string | null;
  currency?: string;
  total?: number;
  rate_per_usd?: number;
  rate_source?: 'usd' | 'auto' | 'manual' | 'receipt';
  rate_date?: string | null;
  category_id?: number | null;
  payment_method?: string | null;
  paid_by?: 'owner' | 'float' | 'own';
  notes?: string | null;
  items?: ItemInput[];
  reason?: string | null;
  save?: boolean;
}

export interface ReceiptRow {
  id: number;
  account_id: number;
  created_by: number;
  upload_id: number | null;
  status: 'draft' | 'saved';
  merchant: string | null;
  receipt_date: string | null;
  currency: string;
  total_cents: number;
  rate_per_usd: number;
  rate_source: string;
  rate_date: string | null;
  total_usd_cents: number;
  category_id: number | null;
  payment_method: string | null;
  paid_by: string;
  reimbursed_at: string | null;
  printed_rate: number | null;
  confidence: string | null;
  notes: string | null;
  edited: number;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: number;
  receipt_id: number;
  position: number;
  raw_text: string | null;
  name: string;
  quantity: number | null;
  amount_cents: number;
  amount_usd_cents: number;
  category_id: number | null;
}

export class InputError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(s: unknown, max = 200): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().slice(0, max);
  return t || null;
}

/** Validates an edit and returns the full new state of the receipt and its items. */
export function applyInput(
  current: ReceiptRow,
  currentItems: ItemRow[],
  input: ReceiptInput,
  user: SessionUser,
  validCategoryIds: Set<number>,
): { receipt: ReceiptRow; items: Omit<ItemRow, 'id' | 'receipt_id'>[] } {
  const r: ReceiptRow = { ...current };
  if ('merchant' in input) r.merchant = clean(input.merchant);
  if ('receipt_date' in input) {
    const d = input.receipt_date;
    if (d && !DATE_RE.test(d)) throw new InputError('Date must be YYYY-MM-DD.');
    r.receipt_date = d || null;
  }
  if (input.currency) {
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new InputError('Currency must be a 3-letter code like USD or ZWG.');
    r.currency = input.currency;
  }
  if (input.total !== undefined) r.total_cents = toCents(input.total);
  if ('category_id' in input) {
    if (input.category_id != null && !validCategoryIds.has(input.category_id)) throw new InputError('Unknown category.');
    r.category_id = input.category_id ?? null;
  }
  if ('payment_method' in input) r.payment_method = clean(input.payment_method, 40);
  if ('notes' in input) r.notes = clean(input.notes, 500);
  if (input.paid_by) {
    if (!['owner', 'float', 'own'].includes(input.paid_by)) throw new InputError('Unknown payer.');
    if (user.role === 'owner' && input.paid_by !== 'owner' && current.created_by === user.id) {
      throw new InputError('Owner receipts are always paid by the owner.');
    }
    r.paid_by = input.paid_by;
  }

  // Exchange rate: USD is always 1. Otherwise a positive rate is required to save.
  if (r.currency === 'USD') {
    r.rate_per_usd = 1;
    r.rate_source = 'usd';
    r.rate_date = r.receipt_date;
  } else {
    if (input.rate_per_usd !== undefined) {
      const rate = Number(input.rate_per_usd);
      if (!Number.isFinite(rate) || rate <= 0) throw new InputError('Exchange rate must be a positive number.');
      r.rate_per_usd = rate;
    }
    if (input.rate_source) r.rate_source = input.rate_source;
    if ('rate_date' in input) r.rate_date = input.rate_date ?? null;
    if (r.rate_source === 'usd') r.rate_source = 'manual';
  }
  r.total_usd_cents = toUsdCents(r.total_cents, r.rate_per_usd);

  let items: Omit<ItemRow, 'id' | 'receipt_id'>[];
  if (input.items) {
    if (input.items.length > 300) throw new InputError('Too many lines on one receipt.');
    items = input.items.map((it, i) => {
      const name = clean(it.name, 120);
      if (!name) throw new InputError(`Line ${i + 1} needs a description.`);
      if (it.category_id != null && !validCategoryIds.has(it.category_id)) throw new InputError(`Line ${i + 1} has an unknown category.`);
      const amount = toCents(it.amount);
      const qty = it.quantity == null || it.quantity === ('' as unknown) ? null : Number(it.quantity);
      return {
        position: i,
        raw_text: clean(it.raw_text, 120),
        name,
        quantity: qty != null && Number.isFinite(qty) ? qty : null,
        amount_cents: amount,
        amount_usd_cents: toUsdCents(amount, r.rate_per_usd),
        category_id: it.category_id ?? null,
      };
    });
  } else {
    items = currentItems.map(({ id: _i, receipt_id: _r, ...rest }) => ({
      ...rest,
      amount_usd_cents: toUsdCents(rest.amount_cents, r.rate_per_usd),
    }));
  }

  if (input.save) {
    if (!r.receipt_date) throw new InputError('Please enter the receipt date.');
    if (r.total_cents === 0) throw new InputError('Please enter the total.');
    if (r.currency !== 'USD' && !(r.rate_per_usd > 0)) throw new InputError('Please choose an exchange rate.');
    r.status = 'saved';
  }
  r.updated_at = nowIso();
  return { receipt: r, items };
}

const TRACKED: Array<[keyof ReceiptRow, string]> = [
  ['merchant', 'Shop'],
  ['receipt_date', 'Date'],
  ['currency', 'Currency'],
  ['total_cents', 'Total'],
  ['rate_per_usd', 'Exchange rate'],
  ['category_id', 'Category'],
  ['paid_by', 'Paid by'],
  ['payment_method', 'Payment method'],
];

export interface Change {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

/** Lists what changed between two versions, for the audit trail. Money stays in cents. */
export function diff(
  before: ReceiptRow,
  after: ReceiptRow,
  itemsBefore: Array<Pick<ItemRow, 'name' | 'amount_cents' | 'category_id'>>,
  itemsAfter: Array<Pick<ItemRow, 'name' | 'amount_cents' | 'category_id'>>,
): Change[] {
  const changes: Change[] = [];
  for (const [key, label] of TRACKED) {
    if ((before[key] ?? null) !== (after[key] ?? null)) {
      changes.push({ field: label, from: before[key] as never, to: after[key] as never });
    }
  }
  const fmt = (it: Pick<ItemRow, 'name' | 'amount_cents' | 'category_id'>) => `${it.name}|${it.amount_cents}|${it.category_id ?? ''}`;
  const max = Math.max(itemsBefore.length, itemsAfter.length);
  for (let i = 0; i < max; i++) {
    const a = itemsBefore[i];
    const b = itemsAfter[i];
    if (!a && b) changes.push({ field: `Line ${i + 1} added`, from: null, to: `${b.name} ${b.amount_cents}` });
    else if (a && !b) changes.push({ field: `Line ${i + 1} removed`, from: `${a.name} ${a.amount_cents}`, to: null });
    else if (a && b && fmt(a) !== fmt(b)) {
      if (a.name !== b.name) changes.push({ field: `Line ${i + 1} description`, from: a.name, to: b.name });
      if (a.amount_cents !== b.amount_cents) changes.push({ field: `Line ${i + 1} amount`, from: a.amount_cents, to: b.amount_cents });
      if ((a.category_id ?? null) !== (b.category_id ?? null)) changes.push({ field: `Line ${i + 1} category`, from: a.category_id, to: b.category_id });
    }
  }
  return changes;
}
