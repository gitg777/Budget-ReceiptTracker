import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCredit } from '../../shared/pricing';
import { Button, Card, ErrorText, Notice, PageTitle, formatDate } from '../ui';

interface AccountRow {
  id: number;
  name: string;
  owner_name: string | null;
  owner_email: string | null;
  helpers: number;
  credit_micros: number;
  unlimited: number;
  readings: number;
  cost_micros: number;
  charged_micros: number;
  topups_micros: number;
  last_reading: string | null;
  created_at: string;
}

// Operator screen: every account, its credit, what its readings cost you, and top-ups.
export function Admin() {
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api<{ accounts: AccountRow[] }>('/admin/accounts').then((d) => setRows(d.accounts), (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const add = async (a: AccountRow, usd: number) => {
    if (!confirm(`Add $${usd} reading credit to ${a.name}?`)) return;
    setError('');
    try {
      await api(`/admin/accounts/${a.id}/credit`, { body: { amount_usd: usd, note: `Top-up $${usd}` } });
      setMsg(`Added $${usd} to ${a.name}.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const custom = async (a: AccountRow) => {
    const v = prompt(`Amount in USD for ${a.name} (use a minus sign to take credit away):`);
    if (!v) return;
    const note = prompt('Note (optional, e.g. "EcoCash ref 123")') ?? '';
    try {
      await api(`/admin/accounts/${a.id}/credit`, { body: { amount_usd: Number(v), note } });
      setMsg(`Updated ${a.name}.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const totals = rows?.reduce((t, r) => ({ cost: t.cost + r.cost_micros, charged: t.charged + r.charged_micros, topups: t.topups + r.topups_micros }), { cost: 0, charged: 0, topups: 0 });

  return (
    <div className="space-y-4">
      <PageTitle>Accounts and credit</PageTitle>
      {totals && (
        <Card className="grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <p className="text-stone-500">Anthropic cost</p>
            <p className="font-semibold">{formatCredit(totals.cost)}</p>
          </div>
          <div>
            <p className="text-stone-500">Charged to users</p>
            <p className="font-semibold">{formatCredit(totals.charged)}</p>
          </div>
          <div>
            <p className="text-stone-500">Top-ups added</p>
            <p className="font-semibold">{formatCredit(totals.topups)}</p>
          </div>
        </Card>
      )}
      {msg && <Notice tone="good">{msg}</Notice>}
      <ErrorText>{error}</ErrorText>
      {rows?.map((a) => (
        <Card key={a.id} className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{a.name}</p>
              <p className="text-sm text-stone-500">
                {a.owner_name} · {a.owner_email} · {a.helpers} helper{a.helpers === 1 ? '' : 's'}
              </p>
            </div>
            <span className={`text-right font-semibold ${a.credit_micros <= 0 && !a.unlimited ? 'text-red-700' : ''}`}>
              {a.unlimited ? 'Unlimited' : formatCredit(a.credit_micros)}
            </span>
          </div>
          <p className="text-xs text-stone-500">
            {a.readings} readings · cost you {formatCredit(a.cost_micros)} · charged {formatCredit(a.charged_micros)} · last used {a.last_reading ? formatDate(a.last_reading) : 'never'} · joined {formatDate(a.created_at)}
          </p>
          {!a.unlimited && (
            <div className="flex flex-wrap gap-2">
              {[1, 5, 10, 20].map((usd) => (
                <Button key={usd} variant="secondary" onClick={() => add(a, usd)}>+${usd}</Button>
              ))}
              <Button variant="ghost" onClick={() => custom(a)}>Other…</Button>
            </div>
          )}
          <button
            className="text-xs text-stone-500 underline"
            onClick={async () => {
              if (!confirm(a.unlimited ? `Start charging ${a.name} for readings again?` : `Stop charging ${a.name} for readings?`)) return;
              await api(`/admin/accounts/${a.id}`, { method: 'PATCH', body: { unlimited: !a.unlimited } });
              load();
            }}
          >
            {a.unlimited ? 'Make this account pay for readings' : 'Make this account unlimited (free readings)'}
          </button>
        </Card>
      ))}
    </div>
  );
}
