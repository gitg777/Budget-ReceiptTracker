import { useEffect, useState, type FormEvent } from 'react';
import { api, type Me } from '../api';
import { downloadExcel } from '../excel';
import { Bar, Button, Card, ErrorText, Money, PageTitle, formatDate, monthEnd, monthLabel, shiftMonth } from '../ui';

interface MonthReport {
  month: string;
  totals: { receipts: number; usd_cents: number };
  by_category: Array<{ category_id: number | null; name: string | null; monthly_budget_cents: number | null; usd_cents: number }>;
  by_merchant: Array<{ merchant: string; receipts: number; usd_cents: number }>;
  by_person: Array<{ person: string; role: string; receipts: number; usd_cents: number }>;
  budgets: Array<{ id: number; name: string; monthly_budget_cents: number }>;
  trend: Array<{ month: string; usd_cents: number }>;
}

interface SearchResult {
  item_total_usd_cents: number;
  items: Array<{ name: string; raw_text: string | null; amount_usd_cents: number; receipt_date: string; merchant: string | null; receipt_id: number }>;
  by_month: Array<{ month: string; usd_cents: number }>;
  merchants: Array<{ merchant: string; receipts: number; usd_cents: number }>;
}

export function Reports({ me }: { me: Me; go: (to: string) => void }) {
  const [month, setMonth] = useState(me.today.slice(0, 7));
  const [report, setReport] = useState<MonthReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(null);
    api<MonthReport>(`/reports/month?month=${month}`).then(setReport, (e) => setError(e.message));
  }, [month]);

  // Budget vs actual: every category with a budget, plus any category with spending.
  const rows = (() => {
    if (!report) return [];
    const map = new Map<string, { name: string; budget: number | null; actual: number }>();
    for (const b of report.budgets) map.set(String(b.id), { name: b.name, budget: b.monthly_budget_cents, actual: 0 });
    for (const c of report.by_category) {
      const key = String(c.category_id);
      const existing = map.get(key);
      if (existing) existing.actual = c.usd_cents;
      else map.set(key, { name: c.name ?? 'Uncategorised', budget: c.monthly_budget_cents, actual: c.usd_cents });
    }
    return [...map.values()].sort((a, b) => b.actual - a.actual);
  })();
  const totalBudget = report?.budgets.reduce((s, b) => s + b.monthly_budget_cents, 0) ?? 0;
  const maxTrend = Math.max(1, ...(report?.trend.map((t) => t.usd_cents) ?? [1]));

  return (
    <div className="space-y-4">
      <PageTitle>Reports</PageTitle>
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button>
        <span className="font-medium">{monthLabel(month)}</span>
        <Button variant="secondary" disabled={month >= me.today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>›</Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {!report ? (
        <p className="text-stone-500">Loading…</p>
      ) : (
        <>
          <Card>
            <p className="text-sm text-stone-600">Spent this month (USD)</p>
            <p className="text-3xl font-semibold"><Money cents={report.totals.usd_cents} /></p>
            <p className="text-sm text-stone-500">
              {report.totals.receipts} receipts{totalBudget > 0 && <> · budget <Money cents={totalBudget} /></>}
            </p>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">By category</h2>
            {rows.length === 0 && <p className="text-sm text-stone-500">No spending recorded.</p>}
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.name}>
                  <div className="flex justify-between text-sm">
                    <span>{r.name}</span>
                    <span>
                      <Money cents={r.actual} className="font-medium" />
                      {r.budget != null && (
                        <span className={r.actual > r.budget ? 'text-red-700' : 'text-stone-500'}> / <Money cents={r.budget} /></span>
                      )}
                    </span>
                  </div>
                  {r.budget != null && <Bar value={r.actual} max={r.budget} />}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-stone-500">Set monthly budgets under More → Categories.</p>
          </Card>

          <ItemSearch month={month} />

          <Card>
            <h2 className="mb-2 font-semibold">Top shops</h2>
            <ul className="space-y-1 text-sm">
              {report.by_merchant.map((m) => (
                <li key={m.merchant} className="flex justify-between">
                  <span>{m.merchant} <span className="text-stone-500">×{m.receipts}</span></span>
                  <Money cents={m.usd_cents} />
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold">Who spent</h2>
            <ul className="space-y-1 text-sm">
              {report.by_person.map((p) => (
                <li key={p.person} className="flex justify-between">
                  <span>{p.person} <span className="text-stone-500">({p.role}, {p.receipts} receipts)</span></span>
                  <Money cents={p.usd_cents} />
                </li>
              ))}
            </ul>
            <a href="#/helpers" className="mt-2 block text-sm text-teal-800 underline">Helper allowances and cash →</a>
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold">Last 12 months</h2>
            <ul className="space-y-1">
              {report.trend.map((t) => (
                <li key={t.month} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 text-stone-600">{monthLabel(t.month).replace(/ (\d{4})$/, " '$1").replace("'20", "'")}</span>
                  <div className="h-3 rounded bg-teal-600" style={{ width: `${(t.usd_cents / maxTrend) * 60}%` }} />
                  <Money cents={t.usd_cents} className="text-xs" />
                </li>
              ))}
            </ul>
          </Card>

          <ExcelExport month={month} />
        </>
      )}
    </div>
  );
}

function ItemSearch({ month }: { month: string }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'month' | 'year' | 'all'>('month');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const [from, to] =
      scope === 'month' ? [`${month}-01`, `${month}-31`] : scope === 'year' ? [`${month.slice(0, 4)}-01-01`, `${month.slice(0, 4)}-12-31`] : ['0000-01-01', '9999-12-31'];
    try {
      setRes(await api<SearchResult>(`/reports/search?q=${encodeURIComponent(q)}&from=${from}&to=${to}`));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">How much on…?</h2>
      <form onSubmit={run} className="flex gap-2">
        <input placeholder="milk, fuel, bread, Fortwell…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="!w-28" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="month">Month</option>
          <option value="year">Year</option>
          <option value="all">All time</option>
        </select>
        <Button>Go</Button>
      </form>
      <ErrorText>{error}</ErrorText>
      {res && (
        <div className="space-y-3 text-sm">
          <p>
            Items matching “{q}”: <Money cents={res.item_total_usd_cents} className="font-semibold" /> ({res.items.length} lines)
          </p>
          {res.by_month.length > 1 && (
            <ul>
              {res.by_month.map((m) => (
                <li key={m.month} className="flex justify-between">
                  <span>{monthLabel(m.month)}</span>
                  <Money cents={m.usd_cents} />
                </li>
              ))}
            </ul>
          )}
          {res.merchants.length > 0 && (
            <div>
              <p className="font-medium">Shops matching “{q}”</p>
              {res.merchants.map((m) => (
                <p key={m.merchant} className="flex justify-between">
                  <span>{m.merchant} ×{m.receipts}</span>
                  <Money cents={m.usd_cents} />
                </p>
              ))}
            </div>
          )}
          <ul className="divide-y divide-stone-100">
            {res.items.slice(0, 50).map((it, i) => (
              <li key={i}>
                <a href={`#/review/${it.receipt_id}`} className="flex justify-between py-1">
                  <span>
                    {it.name}
                    <span className="block text-xs text-stone-500">{formatDate(it.receipt_date)} · {it.merchant}</span>
                  </span>
                  <Money cents={it.amount_usd_cents} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ExcelExport({ month }: { month: string }) {
  const [from, setFrom] = useState(`${month}-01`);
  const [to, setTo] = useState(monthEnd(month));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setFrom(`${month}-01`);
    setTo(monthEnd(month));
  }, [month]);
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Download to Excel</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="xf">From</label>
          <input id="xf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="xt">To</label>
          <input id="xt" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await downloadExcel(from, to);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Preparing…' : 'Download .xlsx'}
      </Button>
      <p className="text-xs text-stone-500">Three sheets: receipts, every item, and the change history.</p>
    </Card>
  );
}
