import { useEffect, useState } from 'react';
import { api } from '../api';
import { toCents } from '../../shared/money';
import { Button, Card, ErrorText, Money, Notice, PageTitle, formatDate } from '../ui';

interface Summary {
  cash_in_hand_cents: number;
  owed_to_helper_cents: number;
  allowance: { budget_cents: number; spent_cents: number; remaining_cents: number };
  period: { start: string; end: string | null };
  last_cash_up: { created_at: string; declared_cents: number; expected_cents: number } | null;
  by_category: Array<{ category: string; usd_cents: number }>;
}

export function CashUp({ go }: { go: (to: string) => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [declared, setDeclared] = useState('');
  const [handBack, setHandBack] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ difference_cents: number } | null>(null);

  const load = () => api<Summary>('/my/summary').then(setS, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    setError('');
    if (declared.trim() === '') {
      setError('Count your cash and enter the amount (0 if none).');
      return;
    }
    try {
      const r = await api<{ difference_cents: number }>('/my/cashup', { body: { declared: toCents(declared) / 100, hand_back: handBack, note } });
      setResult(r);
      setDeclared('');
      setNote('');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!s) return <ErrorText>{error || 'Loading…'}</ErrorText>;

  return (
    <div className="space-y-4">
      <PageTitle>Cash-up</PageTitle>
      <Card className="space-y-2">
        <div className="flex justify-between">
          <span>Cash you should have</span>
          <Money cents={s.cash_in_hand_cents} className="text-lg font-semibold" />
        </div>
        {s.owed_to_helper_cents > 0 && (
          <div className="flex justify-between text-sm">
            <span>Owed back to you</span>
            <Money cents={s.owed_to_helper_cents} />
          </div>
        )}
        {s.last_cash_up && <p className="text-xs text-stone-500">Last cash-up: {formatDate(s.last_cash_up.created_at)}</p>}
      </Card>

      {result && (
        <Notice tone={result.difference_cents === 0 ? 'good' : 'warn'}>
          {result.difference_cents === 0
            ? 'Balanced. Thank you.'
            : `Recorded. You have ${(Math.abs(result.difference_cents) / 100).toFixed(2)} USD ${result.difference_cents > 0 ? 'more' : 'less'} than expected. The owner can see this. If a receipt is missing, add it now.`}
        </Notice>
      )}

      <Card className="space-y-3">
        <p className="text-sm text-stone-600">Count the cash you are holding now (in USD) and enter it. Add any missing receipts first.</p>
        <div>
          <label htmlFor="dec">Cash I have now (USD)</label>
          <input id="dec" inputMode="decimal" value={declared} onChange={(e) => setDeclared(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 font-normal">
          <input type="checkbox" className="w-auto" checked={handBack} onChange={(e) => setHandBack(e.target.checked)} />
          I am handing this change back to the owner now
        </label>
        <div>
          <label htmlFor="note">Note (optional)</label>
          <input id="note" value={note} placeholder="e.g. lost a receipt for bread, 1.20" onChange={(e) => setNote(e.target.value)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <Button className="w-full" onClick={submit}>Record cash-up</Button>
        <Button variant="secondary" className="w-full" onClick={() => go('home')}>Add a missing receipt</Button>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">This period by category</h2>
        {s.by_category.length === 0 && <p className="text-sm text-stone-500">No receipts yet.</p>}
        <ul className="space-y-1 text-sm">
          {s.by_category.map((c) => (
            <li key={c.category} className="flex justify-between">
              <span>{c.category}</span>
              <Money cents={c.usd_cents} />
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t border-stone-100 pt-2 font-medium">
          <span>Allowance left</span>
          <Money cents={s.allowance.remaining_cents} />
        </div>
      </Card>
    </div>
  );
}
