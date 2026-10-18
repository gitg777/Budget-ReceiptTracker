import { useEffect, useState } from 'react';
import { api, type Me } from '../api';
import { Button, Card, ErrorText, Money, PageTitle, formatDate, monthLabel, shiftMonth } from '../ui';

interface Row {
  id: number;
  status: string;
  merchant: string | null;
  receipt_date: string | null;
  currency: string;
  total_cents: number;
  total_usd_cents: number;
  paid_by: string;
  reimbursed_at: string | null;
  edited: number;
  created_by_name: string;
}

export function ReceiptList({ me }: { me: Me; go: (to: string) => void }) {
  const [month, setMonth] = useState(me.today.slice(0, 7));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    api<{ receipts: Row[] }>(`/receipts?status=saved&month=${month}`).then((d) => setRows(d.receipts), (e) => setError(e.message));
  }, [month]);

  const total = rows?.reduce((s, r) => s + r.total_usd_cents, 0) ?? 0;

  return (
    <div className="space-y-4">
      <PageTitle>{me.user.role === 'owner' ? 'Receipts' : 'My receipts'}</PageTitle>
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button>
        <span className="font-medium">{monthLabel(month)}</span>
        <Button variant="secondary" disabled={month >= me.today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>›</Button>
      </div>
      <ErrorText>{error}</ErrorText>
      <Card>
        <div className="mb-2 flex justify-between font-semibold">
          <span>{rows?.length ?? '…'} receipts</span>
          <Money cents={total} />
        </div>
        <ul className="divide-y divide-stone-100">
          {rows?.map((r) => (
            <li key={r.id}>
              <a href={`#/review/${r.id}`} className="flex items-center justify-between gap-2 py-3">
                <span>
                  <span className="font-medium">{r.merchant ?? 'Unknown shop'}</span>
                  <span className="block text-sm text-stone-500">
                    {formatDate(r.receipt_date)}
                    {me.user.role === 'owner' && ` · ${r.created_by_name}`}
                    {r.paid_by === 'own' && (r.reimbursed_at ? ' · paid back' : ' · own money, owed')}
                    {r.edited === 1 && <span className="ml-1 text-amber-700">· edited</span>}
                  </span>
                </span>
                <span className="text-right">
                  <Money cents={r.total_usd_cents} className="font-medium" />
                  {r.currency !== 'USD' && <Money cents={r.total_cents} currency={r.currency} className="block text-xs text-stone-500" />}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {rows?.length === 0 && <p className="text-sm text-stone-500">No saved receipts this month.</p>}
      </Card>
    </div>
  );
}
