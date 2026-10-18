import { useEffect, useState, type FormEvent } from 'react';
import { api, type Me } from '../api';
import { fromCents } from '../../shared/money';
import { Bar, Button, Card, ErrorText, Money, Notice, PageTitle, formatDate } from '../ui';

interface HelperSummary {
  id: number;
  display_name: string;
  username: string;
  active: boolean;
  settings: { allowance_cents: number; period: 'weekly' | 'monthly' | 'none'; carry_over: boolean; starts_on: string };
  period: { start: string; end: string | null };
  allowance: { budget_cents: number; spent_cents: number; remaining_cents: number };
  cash_in_hand_cents: number;
  cash_low: boolean;
  owed_to_helper_cents: number;
  last_cash_up: { created_at: string; expected_cents: number; declared_cents: number; note: string | null } | null;
}

const periodWords = { weekly: 'per week', monthly: 'per month', none: 'one running float' };

export function Helpers({ me, id, go }: { me: Me; id: number | null; go: (to: string) => void }) {
  if (id) return <HelperDetail id={id} go={go} />;
  return <HelperList me={me} go={go} />;
}

function HelperList({ me, go }: { me: Me; go: (to: string) => void }) {
  const [helpers, setHelpers] = useState<HelperSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = () => api<{ helpers: HelperSummary[] }>('/helpers').then((d) => setHelpers(d.helpers), (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <PageTitle action={!adding && <Button onClick={() => setAdding(true)}>+ Add helper</Button>}>Helpers</PageTitle>
      <ErrorText>{error}</ErrorText>
      {adding && <HelperForm me={me} onDone={() => { setAdding(false); load(); }} />}
      {helpers?.length === 0 && !adding && (
        <Notice>
          Helpers are people who spend on your behalf (a housekeeper, driver, manager). They log in with a username and PIN, photograph receipts, and see only their own allowance and receipts.
        </Notice>
      )}
      {helpers?.map((h) => (
        <Card key={h.id} className={h.active ? '' : 'opacity-60'}>
          <button className="w-full space-y-2 text-left" onClick={() => go(`helpers/${h.id}`)}>
            <div className="flex justify-between">
              <span className="font-semibold">{h.display_name}{!h.active && ' (removed)'}</span>
              <span className="text-sm text-stone-500">@{h.username}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Allowance used</span>
              <span><Money cents={h.allowance.spent_cents} /> / <Money cents={h.allowance.budget_cents} /></span>
            </div>
            <Bar value={h.allowance.spent_cents} max={h.allowance.budget_cents} />
            <div className="flex justify-between text-sm">
              <span>Cash they should hold</span>
              <Money cents={h.cash_in_hand_cents} className={h.cash_low ? 'font-medium text-amber-700' : 'font-medium'} />
            </div>
            {h.owed_to_helper_cents > 0 && (
              <div className="flex justify-between text-sm text-teal-800">
                <span>You owe them (own-money receipts)</span>
                <Money cents={h.owed_to_helper_cents} />
              </div>
            )}
          </button>
        </Card>
      ))}
    </div>
  );
}

function HelperForm({ me, existing, onDone }: { me: Me; existing?: HelperSummary; onDone: () => void }) {
  const [f, setF] = useState({
    display_name: existing?.display_name ?? '',
    username: existing?.username ?? '',
    pin: '',
    allowance: existing ? String(fromCents(existing.settings.allowance_cents)) : '',
    period: existing?.settings.period ?? 'monthly',
    carry_over: existing?.settings.carry_over ?? true,
    starts_on: existing?.settings.starts_on ?? me.today,
  });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const body: Record<string, unknown> = {
      display_name: f.display_name,
      allowance: Number(f.allowance || 0),
      period: f.period,
      carry_over: f.carry_over,
      starts_on: f.starts_on,
    };
    if (!existing) body.username = f.username;
    if (f.pin) body.pin = f.pin;
    try {
      if (existing) await api(`/helpers/${existing.id}`, { method: 'PATCH', body });
      else await api('/helpers', { body });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <h2 className="font-semibold">{existing ? 'Edit helper' : 'New helper'}</h2>
        <div>
          <label htmlFor="hn">Name</label>
          <input id="hn" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} required />
        </div>
        {!existing && (
          <div>
            <label htmlFor="hu">Username (they type this to log in)</label>
            <input id="hu" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} required />
          </div>
        )}
        <div>
          <label htmlFor="hp">{existing ? 'New PIN (leave blank to keep)' : 'PIN (4–8 digits)'}</label>
          <input id="hp" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} required={!existing} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ha">Allowance (USD)</label>
            <input id="ha" inputMode="decimal" value={f.allowance} onChange={(e) => setF({ ...f, allowance: e.target.value })} />
          </div>
          <div>
            <label htmlFor="hper">Every</label>
            <select id="hper" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as typeof f.period })}>
              <option value="weekly">Week</option>
              <option value="monthly">Month</option>
              <option value="none">No period (one float)</option>
            </select>
          </div>
        </div>
        {f.period !== 'none' && (
          <label className="flex items-center gap-2 font-normal">
            <input type="checkbox" className="w-auto" checked={f.carry_over} onChange={(e) => setF({ ...f, carry_over: e.target.checked })} />
            Unspent allowance carries over to the next {f.period === 'weekly' ? 'week' : 'month'}
          </label>
        )}
        <div>
          <label htmlFor="hs">Allowance starts on</label>
          <input id="hs" type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} />
        </div>
        <p className="text-xs text-stone-500">
          The allowance is a spending limit. Cash is tracked separately: record each time you hand over cash, and the helper cashes up when they choose.
        </p>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button className="flex-1">{existing ? 'Save' : 'Add helper'}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

interface LedgerRow {
  id: number;
  kind: 'given' | 'returned' | 'adjustment' | 'reimbursed';
  amount_cents: number;
  note: string | null;
  created_at: string;
}

function HelperDetail({ id, go }: { id: number; go: (to: string) => void }) {
  const [data, setData] = useState<{ summary: HelperSummary; ledger: LedgerRow[] } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [editing, setEditing] = useState(false);
  const [cash, setCash] = useState({ kind: 'given' as 'given' | 'returned', amount: '', note: '' });
  const [error, setError] = useState('');
  const load = () => api<{ summary: HelperSummary; ledger: LedgerRow[] }>(`/helpers/${id}/ledger`).then(setData, (e) => setError(e.message));
  useEffect(() => {
    load();
    api<Me>('/me').then(setMe, () => undefined);
  }, [id]);

  if (!data) return <ErrorText>{error || 'Loading…'}</ErrorText>;
  const h = data.summary;

  const recordCash = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/helpers/${id}/cash`, { body: { kind: cash.kind, amount: Number(cash.amount), note: cash.note } });
      setCash({ ...cash, amount: '', note: '' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const ledgerWords = { given: 'Cash given', returned: 'Change returned', adjustment: 'Cash-up difference', reimbursed: 'Paid back (own money)' };

  return (
    <div className="space-y-4">
      <PageTitle action={<Button variant="secondary" onClick={() => go('helpers')}>Back</Button>}>{h.display_name}</PageTitle>
      {editing && me ? (
        <HelperForm me={me} existing={h} onDone={() => { setEditing(false); load(); }} />
      ) : (
        <Card className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Allowance</span>
            <span><Money cents={h.settings.allowance_cents} /> {periodWords[h.settings.period]}{h.settings.period !== 'none' && (h.settings.carry_over ? ', carries over' : ', resets')}</span>
          </div>
          <div className="flex justify-between">
            <span>Available now</span>
            <Money cents={h.allowance.remaining_cents} className={h.allowance.remaining_cents < 0 ? 'font-semibold text-red-700' : 'font-semibold'} />
          </div>
          <div className="flex justify-between">
            <span>Cash they should hold</span>
            <Money cents={h.cash_in_hand_cents} className="font-semibold" />
          </div>
          {h.last_cash_up && (
            <p className="text-stone-600">
              Last cash-up {formatDate(h.last_cash_up.created_at)}: counted <Money cents={h.last_cash_up.declared_cents} />, expected <Money cents={h.last_cash_up.expected_cents} />
              {h.last_cash_up.note && ` — “${h.last_cash_up.note}”`}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>Edit allowance / PIN</Button>
            <Button variant="secondary" onClick={() => go(`receipts`)}>Receipts</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(h.active ? `Remove ${h.display_name}? They will be logged out. Their receipts stay.` : `Restore ${h.display_name}?`)) return;
                await api(`/helpers/${id}`, { method: 'PATCH', body: { active: !h.active } });
                load();
              }}
            >
              {h.active ? 'Remove access' : 'Restore access'}
            </Button>
          </div>
        </Card>
      )}

      {h.owed_to_helper_cents > 0 && (
        <Card className="flex items-center justify-between gap-2">
          <span className="text-sm">
            You owe {h.display_name} <Money cents={h.owed_to_helper_cents} className="font-semibold" /> for receipts paid with their own money.
          </span>
          <Button
            onClick={async () => {
              if (!confirm('Mark these as paid back?')) return;
              await api(`/helpers/${id}/reimburse`, { method: 'POST' });
              load();
            }}
          >
            Paid back
          </Button>
        </Card>
      )}

      <Card>
        <form onSubmit={recordCash} className="space-y-3">
          <h2 className="font-semibold">Record cash</h2>
          <div className="grid grid-cols-2 gap-3">
            <select value={cash.kind} onChange={(e) => setCash({ ...cash, kind: e.target.value as 'given' | 'returned' })}>
              <option value="given">I gave cash</option>
              <option value="returned">They returned change</option>
            </select>
            <input inputMode="decimal" placeholder="USD amount" value={cash.amount} onChange={(e) => setCash({ ...cash, amount: e.target.value })} />
          </div>
          <input placeholder="Note (optional)" value={cash.note} onChange={(e) => setCash({ ...cash, note: e.target.value })} />
          <ErrorText>{error}</ErrorText>
          <Button className="w-full">Record</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Cash history</h2>
        {data.ledger.length === 0 && <p className="text-sm text-stone-500">Nothing yet.</p>}
        <ul className="divide-y divide-stone-100 text-sm">
          {data.ledger.map((l) => (
            <li key={l.id} className="flex justify-between py-2">
              <span>
                {ledgerWords[l.kind]}
                <span className="block text-xs text-stone-500">{formatDate(l.created_at)}{l.note && ` · ${l.note}`}</span>
              </span>
              <Money cents={l.amount_cents} className={l.kind === 'adjustment' && l.amount_cents < 0 ? 'text-red-700' : ''} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
