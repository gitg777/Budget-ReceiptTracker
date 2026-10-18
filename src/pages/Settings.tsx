import { useEffect, useState, type FormEvent } from 'react';
import { api, type Me } from '../api';
import { fromCents } from '../../shared/money';
import { Button, Card, ErrorText, Notice, PageTitle, formatDate } from '../ui';

export function Settings({ me, onChange, logout }: { me: Me; onChange: () => void; logout: () => void }) {
  const isOwner = me.user.role === 'owner';
  return (
    <div className="space-y-4">
      <PageTitle>More</PageTitle>
      {isOwner && <Rates me={me} />}
      {isOwner && <Categories me={me} onChange={onChange} />}
      <Password me={me} />
      <InstallHint />
      <Button variant="secondary" className="w-full" onClick={logout}>Log out</Button>
    </div>
  );
}

interface RateRow {
  currency: string;
  rate_per_usd: number;
  rate_date: string;
  provider?: string;
}

function Rates({ me }: { me: Me }) {
  const [auto, setAuto] = useState<RateRow[]>([]);
  const [manual, setManual] = useState<RateRow[]>([]);
  const [f, setF] = useState({ currency: 'ZWG', rate: '', date: me.today });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const load = () => api<{ auto: RateRow[]; manual: RateRow[] }>('/rates/today').then((d) => { setAuto(d.auto); setManual(d.manual); }, () => undefined);
  useEffect(() => {
    load();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/rates', { body: { currency: f.currency, rate: Number(f.rate), date: f.date } });
      setF({ ...f, rate: '' });
      setMsg('Saved. New receipts in that currency on that day will suggest your rate.');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refresh = async () => {
    setError('');
    try {
      const r = await api<{ stored: number; provider: string; date: string; rejected: string[] }>('/rates/refresh', { method: 'POST' });
      setMsg(`Fetched ${r.stored} rates for ${formatDate(r.date)} from ${r.provider}.${r.rejected.length ? ' Rejected as suspicious: ' + r.rejected.join(', ') : ''}`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const shown = auto.filter((r) => me.currencies.includes(r.currency));
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Exchange rates (per 1 USD)</h2>
      {shown.length === 0 ? (
        <p className="text-sm text-stone-500">No automatic rates yet. They are fetched twice a day; tap “Fetch now” to get them immediately.</p>
      ) : (
        <ul className="text-sm">
          {shown.map((r) => (
            <li key={r.currency} className="flex justify-between">
              <span>{r.currency}</span>
              <span className="tabular-nums">{r.rate_per_usd.toFixed(4)} <span className="text-xs text-stone-500">{formatDate(r.rate_date)}</span></span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stone-500">
        Automatic rates come from a free public feed and follow the official interbank rate closely, but are not published by the RBZ. Set your own rate below if you use a different one.
      </p>
      <Button variant="secondary" onClick={refresh}>Fetch now</Button>
      <form onSubmit={save} className="space-y-2 border-t border-stone-100 pt-3">
        <p className="text-sm font-medium">Set my own rate for a day</p>
        <div className="grid grid-cols-3 gap-2">
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {me.currencies.filter((c) => c !== 'USD').map((c) => <option key={c}>{c}</option>)}
          </select>
          <input inputMode="decimal" placeholder="Rate" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </div>
        <Button className="w-full">Save my rate</Button>
      </form>
      {manual.length > 0 && (
        <ul className="text-sm text-stone-600">
          {manual.map((r, i) => (
            <li key={i}>{formatDate(r.rate_date)}: {r.currency} {r.rate_per_usd}</li>
          ))}
        </ul>
      )}
      {msg && <Notice tone="good">{msg}</Notice>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function Categories({ me, onChange }: { me: Me; onChange: () => void }) {
  const [name, setName] = useState('');
  const [budgets, setBudgets] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    setBudgets(Object.fromEntries(me.categories.map((c) => [c.id, c.monthly_budget_cents == null ? '' : String(fromCents(c.monthly_budget_cents))])));
  }, [me.categories]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/categories', { body: { name } });
      setName('');
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveBudget = async (id: number) => {
    const v = budgets[id];
    await api(`/categories/${id}`, { method: 'PATCH', body: { monthly_budget: v === '' ? null : Number(v) } });
    onChange();
  };

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Categories and monthly budgets (USD)</h2>
      <ul className="space-y-2">
        {me.categories.map((c) => (
          <li key={c.id} className={`flex items-center gap-2 ${c.active ? '' : 'opacity-50'}`}>
            <span className="flex-1 text-sm">{c.name}</span>
            <input
              className="!w-28"
              inputMode="decimal"
              placeholder="No budget"
              value={budgets[c.id] ?? ''}
              onChange={(e) => setBudgets({ ...budgets, [c.id]: e.target.value })}
              onBlur={() => saveBudget(c.id)}
            />
            <button
              className="text-xs text-stone-500 underline"
              onClick={async () => {
                await api(`/categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } });
                onChange();
              }}
            >
              {c.active ? 'Hide' : 'Show'}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input placeholder="New category, e.g. Rent" value={name} onChange={(e) => setName(e.target.value)} />
        <Button>Add</Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function Password({ me }: { me: Me }) {
  const [f, setF] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const word = me.user.role === 'owner' ? 'password' : 'PIN';
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api('/me/password', { body: f });
      setF({ current: '', next: '' });
      setMsg(`${word === 'PIN' ? 'PIN' : 'Password'} changed.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Card>
      <form onSubmit={save} className="space-y-2">
        <h2 className="font-semibold">Change {word}</h2>
        <input type="password" placeholder={`Current ${word}`} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        <input type="password" placeholder={`New ${word}`} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        {msg && <Notice tone="good">{msg}</Notice>}
        <ErrorText>{error}</ErrorText>
        <Button className="w-full">Change</Button>
      </form>
    </Card>
  );
}

function InstallHint() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  if (standalone) return null;
  return (
    <Notice>
      To put this app on your home screen: in Chrome tap ⋮ → “Add to Home screen”. On iPhone (Safari) tap Share → “Add to Home Screen”.
    </Notice>
  );
}
