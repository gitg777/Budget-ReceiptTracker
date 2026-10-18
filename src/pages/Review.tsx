import { useEffect, useMemo, useState } from 'react';
import { api, type Me } from '../api';
import { fromCents, toCents, toUsdCents } from '../../shared/money';
import { Button, Card, ErrorText, Money, Notice, PageTitle, formatDate } from '../ui';

interface Item {
  raw_text: string | null;
  name: string;
  quantity: number | null;
  amount: string; // edited as text so "1." etc. can be typed
  category_id: number | null;
}

interface RateSuggestion {
  rate_per_usd: number;
  rate_date: string;
  source: 'auto' | 'manual';
  provider: string | null;
}

interface Edit {
  id: number;
  changes: string;
  reason: string | null;
  created_at: string;
  by_name: string;
}

interface Loaded {
  receipt: {
    id: number;
    status: 'draft' | 'saved';
    upload_id: number | null;
    merchant: string | null;
    receipt_date: string | null;
    currency: string;
    total_cents: number;
    rate_per_usd: number;
    rate_source: string;
    rate_date: string | null;
    category_id: number | null;
    payment_method: string | null;
    paid_by: 'owner' | 'float' | 'own';
    reimbursed_at: string | null;
    printed_rate: number | null;
    confidence: string | null;
    notes: string | null;
    edited: number;
    created_by: number;
    created_by_name: string;
    created_by_role: string;
  };
  items: Array<{ raw_text: string | null; name: string; quantity: number | null; amount_cents: number; category_id: number | null }>;
  edits: Edit[];
  rate_suggestion: RateSuggestion | null;
}

type RateChoice = 'auto' | 'receipt' | 'manual';

export function Review({ me, id, go }: { me: Me; id: number; go: (to: string) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [total, setTotal] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [paidBy, setPaidBy] = useState<'owner' | 'float' | 'own'>('owner');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [rateChoice, setRateChoice] = useState<RateChoice>('auto');
  const [manualRate, setManualRate] = useState('');
  const [suggestion, setSuggestion] = useState<RateSuggestion | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const cats = me.categories.filter((c) => c.active);
  const isHelperReceipt = data?.receipt.created_by_role === 'helper';

  useEffect(() => {
    api<Loaded>(`/receipts/${id}`).then((d) => {
      const r = d.receipt;
      setData(d);
      setMerchant(r.merchant ?? '');
      setDate(r.receipt_date ?? '');
      setCurrency(r.currency);
      setTotal(r.total_cents ? String(fromCents(r.total_cents)) : '');
      setCategoryId(r.category_id);
      setPaidBy(r.paid_by);
      setPaymentMethod(r.payment_method ?? '');
      setNotes(r.notes ?? '');
      setItems(d.items.map((it) => ({ ...it, amount: String(fromCents(it.amount_cents)) })));
      setSuggestion(d.rate_suggestion);
      if (r.rate_source === 'manual') {
        setRateChoice('manual');
        setManualRate(String(r.rate_per_usd));
      } else if (r.rate_source === 'receipt') setRateChoice('receipt');
      else setRateChoice('auto');
    }, (e) => setError(e.message));
  }, [id]);

  // When the currency or date changes, look up the rate of the day again.
  useEffect(() => {
    if (!data || currency === 'USD' || !/^[A-Z]{3}$/.test(currency)) return;
    api<{ suggestion: RateSuggestion | null }>(`/rates/suggest?currency=${currency}&date=${date}`).then((s) => setSuggestion(s.suggestion), () => undefined);
  }, [currency, date, data]);

  const rate = useMemo(() => {
    if (currency === 'USD') return 1;
    if (rateChoice === 'manual') return Number(manualRate) || 0;
    if (rateChoice === 'receipt') return data?.receipt.printed_rate ?? 0;
    return suggestion?.rate_per_usd ?? 0;
  }, [currency, rateChoice, manualRate, suggestion, data]);

  const totalCents = toCents(total);
  const itemsCents = items.reduce((s, it) => s + toCents(it.amount), 0);
  const mismatch = items.length > 0 && Math.abs(itemsCents - totalCents) > 1;

  if (error && !data) return <ErrorText>{error}</ErrorText>;
  if (!data) return <p className="text-stone-500">Loading…</p>;
  const r = data.receipt;
  const locked = me.user.role === 'helper' && !!r.reimbursed_at;

  const updateItem = (i: number, patch: Partial<Item>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const save = async () => {
    setError('');
    if (currency !== 'USD' && !(rate > 0)) {
      setError('Choose an exchange rate for ' + currency + ' (no automatic rate is available yet — type one in).');
      return;
    }
    setBusy(true);
    try {
      await api(`/receipts/${id}`, {
        method: 'PUT',
        body: {
          merchant,
          receipt_date: date || null,
          currency,
          total: totalCents / 100,
          rate_per_usd: rate,
          rate_source: currency === 'USD' ? 'usd' : rateChoice,
          rate_date: currency === 'USD' ? date : rateChoice === 'auto' ? suggestion?.rate_date ?? null : date,
          category_id: categoryId,
          payment_method: paymentMethod || null,
          paid_by: paidBy,
          notes: notes || null,
          items: items.map((it) => ({ ...it, amount: toCents(it.amount) / 100 })),
          reason: reason || null,
          save: true,
        },
      });
      go(r.status === 'draft' ? 'home' : 'receipts');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(r.status === 'draft' ? 'Throw away this receipt?' : 'Delete this saved receipt and its history? This cannot be undone.')) return;
    try {
      await api(`/receipts/${id}`, { method: 'DELETE' });
      go(r.status === 'draft' ? 'home' : 'receipts');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const currencyOptions = [...new Set([...me.currencies, currency])];

  return (
    <div className="space-y-4">
      <PageTitle>{r.status === 'draft' ? 'Check and save' : 'Receipt'}</PageTitle>

      {r.upload_id && (
        <a href={`/api/uploads/${r.upload_id}/file`} target="_blank" rel="noreferrer" className="block">
          <img src={`/api/uploads/${r.upload_id}/file`} alt="Receipt" className="max-h-80 w-full rounded-xl border border-stone-200 bg-stone-100 object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <span className="text-sm text-teal-800 underline">Open full photo</span>
        </a>
      )}

      {r.status === 'draft' && r.confidence === 'low' && <Notice tone="warn">The photo was hard to read. Please check every number.</Notice>}
      {r.notes && r.status === 'draft' && <Notice>{r.notes}</Notice>}
      {r.edited === 1 && <Notice tone="warn">This receipt has been changed after it was read or saved. See the history below.</Notice>}
      {locked && <Notice>This receipt has been paid back, so it can no longer be changed.</Notice>}
      {me.user.role === 'owner' && <p className="text-sm text-stone-500">Entered by {r.created_by_name}</p>}

      <Card className="space-y-3">
        <div>
          <label htmlFor="m">Shop / paid to</label>
          <input id="m" value={merchant} onChange={(e) => setMerchant(e.target.value)} disabled={locked} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="d">Date</label>
            <input id="d" type="date" value={date} max={me.today} onChange={(e) => setDate(e.target.value)} disabled={locked} />
          </div>
          <div>
            <label htmlFor="cur">Currency</label>
            <select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={locked}>
              {currencyOptions.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="t">Total paid ({currency})</label>
            <input id="t" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} disabled={locked} />
          </div>
          <div>
            <label htmlFor="cat">Category</label>
            <select id="cat" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)} disabled={locked}>
              <option value="">—</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {currency !== 'USD' && (
          <div className="space-y-2 rounded-lg bg-stone-50 p-3">
            <p className="text-sm font-medium">Exchange rate ({currency} per 1 USD)</p>
            <label className="flex items-start gap-2 font-normal">
              <input type="radio" className="mt-1 w-auto" checked={rateChoice === 'auto'} onChange={() => setRateChoice('auto')} disabled={!suggestion || locked} />
              <span>
                {suggestion ? (
                  <>
                    Rate of the day: <b>{suggestion.rate_per_usd.toFixed(4)}</b>
                    <span className="block text-xs text-stone-500">
                      {suggestion.source === 'manual' ? 'Your own rate' : 'Automatic'} · {formatDate(suggestion.rate_date)}
                      {suggestion.rate_date !== date && date && ' (closest available)'}
                    </span>
                  </>
                ) : (
                  <span className="text-stone-500">No automatic rate for {currency} yet</span>
                )}
              </span>
            </label>
            {r.printed_rate && (
              <label className="flex items-start gap-2 font-normal">
                <input type="radio" className="mt-1 w-auto" checked={rateChoice === 'receipt'} onChange={() => setRateChoice('receipt')} disabled={locked} />
                <span>Rate printed on the receipt: <b>{r.printed_rate}</b></span>
              </label>
            )}
            <label className="flex items-center gap-2 font-normal">
              <input type="radio" className="w-auto" checked={rateChoice === 'manual'} onChange={() => setRateChoice('manual')} disabled={locked} />
              <span className="shrink-0">My own rate:</span>
              <input inputMode="decimal" value={manualRate} placeholder="e.g. 26.5" onFocus={() => setRateChoice('manual')} onChange={(e) => setManualRate(e.target.value)} disabled={locked} />
            </label>
            <p className="text-sm">
              = <Money cents={toUsdCents(totalCents, rate)} className="font-semibold" /> USD
            </p>
          </div>
        )}

        {isHelperReceipt ? (
          <div>
            <label htmlFor="pb">Paid with</label>
            <select id="pb" value={paidBy} onChange={(e) => setPaidBy(e.target.value as 'float' | 'own')} disabled={locked}>
              <option value="float">Cash I was given</option>
              <option value="own">My own money (claim it back)</option>
            </select>
          </div>
        ) : null}
        <div>
          <label htmlFor="pm">Payment method (optional)</label>
          <input id="pm" value={paymentMethod} placeholder="Cash, Swipe, EcoCash…" onChange={(e) => setPaymentMethod(e.target.value)} disabled={locked} />
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Items ({items.length})</h2>
          <span className={`text-sm ${mismatch ? 'text-amber-700' : 'text-stone-500'}`}>
            Items add up to <Money cents={itemsCents} currency={currency} />
          </span>
        </div>
        {mismatch && (
          <Notice tone="warn">
            Items add up to {(itemsCents / 100).toFixed(2)} but the total is {(totalCents / 100).toFixed(2)}. The difference will be counted under the receipt’s category.
          </Notice>
        )}
        {items.map((it, i) => (
          <div key={i} className="space-y-2 border-t border-stone-100 pt-3">
            {it.raw_text && <p className="font-mono text-xs text-stone-500">{it.raw_text}</p>}
            <div className="flex gap-2">
              <input aria-label="Item" value={it.name} onChange={(e) => updateItem(i, { name: e.target.value })} disabled={locked} />
              <input aria-label="Amount" className="!w-28" inputMode="decimal" value={it.amount} onChange={(e) => updateItem(i, { amount: e.target.value })} disabled={locked} />
            </div>
            <div className="flex gap-2">
              <select aria-label="Item category" value={it.category_id ?? ''} onChange={(e) => updateItem(i, { category_id: e.target.value ? Number(e.target.value) : null })} disabled={locked}>
                <option value="">Same as receipt</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {!locked && (
                <Button variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove line">✕</Button>
              )}
            </div>
          </div>
        ))}
        {!locked && (
          <Button variant="secondary" className="w-full" onClick={() => setItems([...items, { raw_text: null, name: '', quantity: null, amount: '', category_id: null }])}>
            + Add a line
          </Button>
        )}
      </Card>

      {!locked && (
        <Card className="space-y-3">
          <div>
            <label htmlFor="notes">Notes (optional)</label>
            <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {(r.status === 'saved' || r.upload_id) && (
            <div>
              <label htmlFor="why">If you changed anything, say why (optional)</label>
              <input id="why" value={reason} placeholder="e.g. photo was blurred, total was 12 not 21" onChange={(e) => setReason(e.target.value)} />
              <p className="mt-1 text-xs text-stone-500">Changes are recorded with your name so the owner can see them.</p>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : r.status === 'draft' ? 'Save receipt' : 'Save changes'}
          </Button>
          {(r.status === 'draft' || me.user.role === 'owner') && (
            <Button variant="danger" className="w-full" onClick={remove}>
              {r.status === 'draft' ? 'Throw away' : 'Delete receipt'}
            </Button>
          )}
        </Card>
      )}

      {data.edits.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Change history</h2>
          <ul className="space-y-3 text-sm">
            {data.edits.map((e) => (
              <li key={e.id}>
                <p className="font-medium">
                  {e.by_name} · {formatDate(e.created_at)}
                </p>
                {e.reason && <p className="italic text-stone-600">“{e.reason}”</p>}
                <ul className="list-disc pl-5 text-stone-700">
                  {(JSON.parse(e.changes) as Array<{ field: string; from: unknown; to: unknown }>).map((ch, i) => (
                    <li key={i}>
                      {ch.field}: {show(ch.field, ch.from, me)} → {show(ch.field, ch.to, me)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// Audit entries keep raw values (cents, ids); turn them into words for display.
function show(field: string, v: unknown, me: Me): string {
  if (v === null || v === undefined || v === '') return '(blank)';
  if (field === 'Total' || /amount$/.test(field)) return (Number(v) / 100).toFixed(2);
  if (/category$/i.test(field)) return me.categories.find((c) => c.id === v)?.name ?? '(none)';
  if (/added|removed/.test(field)) {
    const s = String(v);
    const cut = s.lastIndexOf(' ');
    return cut > 0 ? `${s.slice(0, cut)} ${(Number(s.slice(cut + 1)) / 100).toFixed(2)}` : s;
  }
  if (field === 'Paid by') return v === 'own' ? 'own money' : v === 'float' ? 'cash given' : 'owner';
  return String(v);
}
