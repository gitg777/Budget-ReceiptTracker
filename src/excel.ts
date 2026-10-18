// Builds the Excel download in the browser (no server work, works with whatever the report returned).
import { api } from './api';

type Cell = string | number | null;

export async function downloadExcel(from: string, to: string): Promise<void> {
  const [{ default: writeXlsxFile }, data] = await Promise.all([
    import('write-excel-file/browser'),
    api<{ receipts: any[]; items: any[]; edits: any[] }>(`/reports/export?from=${from}&to=${to}`),
  ]);
  const c = (cents: number | null) => (cents == null ? null : Math.round(cents) / 100);
  const bold = (s: string) => ({ value: s, fontWeight: 'bold' as const });

  const receipts: Cell[][] = data.receipts.map((r) => [
    r.id, r.receipt_date, r.merchant, r.category, r.currency, c(r.total_cents), r.rate_per_usd, r.rate_source, r.rate_date,
    c(r.total_usd_cents), r.payment_method, r.paid_by, r.reimbursed_at, r.entered_by, r.edited ? 'yes' : '', r.notes,
  ]);
  const items: Cell[][] = data.items.map((i) => [
    i.receipt_id, i.receipt_date, i.merchant, i.name, i.raw_text, i.quantity, i.category, i.currency, c(i.amount_cents), c(i.amount_usd_cents),
  ]);
  const edits: Cell[][] = data.edits.map((e) => [
    e.receipt_id, e.created_at, e.by_name, e.reason,
    (JSON.parse(e.changes) as Array<{ field: string; from: unknown; to: unknown }>).map((ch) => `${ch.field}: ${ch.from ?? ''} → ${ch.to ?? ''}`).join('; '),
  ]);

  await writeXlsxFile([
    {
      sheet: 'Receipts',
      stickyRowsCount: 1,
      data: [
        ['Receipt #', 'Date', 'Shop', 'Category', 'Currency', 'Total', 'Rate per USD', 'Rate source', 'Rate date', 'Total USD', 'Payment', 'Paid by', 'Paid back on', 'Entered by', 'Edited', 'Notes'].map(bold),
        ...receipts,
      ],
    },
    {
      sheet: 'Items',
      stickyRowsCount: 1,
      data: [['Receipt #', 'Date', 'Shop', 'Item', 'As printed', 'Qty', 'Category', 'Currency', 'Amount', 'Amount USD'].map(bold), ...items],
    },
    {
      sheet: 'Changes',
      stickyRowsCount: 1,
      data: [['Receipt #', 'When', 'Who', 'Reason', 'What changed (amounts in cents)'].map(bold), ...edits],
    },
  ]).toFile(`receipts_${from}_to_${to}.xlsx`);
}
