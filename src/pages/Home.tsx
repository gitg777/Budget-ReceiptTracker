import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Me } from '../api';
import { compressImage } from '../image';
import { addToQueue, listQueue, onQueueChange, partsOf, processQueue, removeFromQueue, retryItem, type QueuedPhoto } from '../queue';
import { Button, Card, ErrorText, LinkButton, Money, Notice, ThemeSwitch, formatDate, Bar } from '../ui';
import { formatMoney } from '../../shared/money';
import { MatoboHero } from '../art';
import { CameraIcon, CloseIcon, FileIcon, HelpIcon, PencilIcon } from '../icons';
import { formatCredit, receiptsFor } from '../../shared/pricing';
import type { CreditStatus } from '../api';

interface DraftRow {
  id: number;
  merchant: string | null;
  receipt_date: string | null;
  currency: string;
  total_cents: number;
  confidence: string | null;
  created_by_name: string;
}

interface FailedUpload {
  id: number;
  error: string | null;
  created_at: string;
}

export function Home({ me, go, online, onCreditChange }: { me: Me; go: (to: string) => void; online: boolean; onCreditChange: () => void }) {
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [failed, setFailed] = useState<FailedUpload[]>([]);
  const [message, setMessage] = useState(() => takeFlash());
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const isOwner = me.user.role === 'owner';

  const loadServer = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([api<{ receipts: DraftRow[] }>('/receipts?status=draft'), api<{ uploads: FailedUpload[] }>('/uploads/failed')]);
      setDrafts(d.receipts);
      setFailed(f.uploads);
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  const send = useCallback(async () => {
    const results = await processQueue();
    if (results.length) {
      const found = results.reduce((n, r) => n + r.receipt_ids.length, 0);
      setMessage(found ? `Read ${found} receipt${found === 1 ? '' : 's'}. Check and save below.` : '');
      const failed = results.find((r) => !r.ok && r.error);
      if (failed) setError(failed.error!);
      await loadServer();
      onCreditChange(); // balance changed
    }
  }, [loadServer, onCreditChange]);

  useEffect(() => {
    const refresh = () => listQueue().then(setQueue);
    refresh();
    const off = onQueueChange(refresh);
    loadServer();
    send();
    const timer = setInterval(send, 60000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [loadServer, send]);

  useEffect(() => {
    if (online) send();
  }, [online, send]);

  // Files from the phone (gallery, PDFs, screenshots, e-receipts): each file is its own receipt.
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setMessage('');
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024 && file.type === 'application/pdf') {
        setError(`${file.name} is larger than 10 MB.`);
        continue;
      }
      const blob = await compressImage(file);
      await addToQueue(blob, file.name || 'receipt.jpg');
    }
    setMessage(navigator.onLine ? 'Reading… this takes a few seconds per receipt.' : 'Saved on this phone. It will be sent when you have signal.');
    send();
  };

  const manual = async (uploadId?: number) => {
    try {
      const r = await api<{ id: number }>('/receipts', { body: uploadId ? { upload_id: uploadId } : {} });
      go(`review/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <section className="relative h-44 overflow-hidden bg-band text-on-band">
        <MatoboHero className="absolute inset-0 h-full w-full" />
        <div className="relative px-5 pt-4">{isOwner ? <OwnerHeadline me={me} /> : <HelperHeadline />}</div>
      </section>

      <div className="space-y-4 px-4 pb-4">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Look</p>
          <ThemeSwitch />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <LinkButton variant="gold" href="#/capture" className="min-h-14 text-[16px]">
            <CameraIcon size={20} /> Snap receipt
          </LinkButton>
          <Button variant="secondary" className="min-h-14 text-[16px]" onClick={() => manual()}>
            <PencilIcon size={20} /> Type one in
          </Button>
        </div>
        <button className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-ground-2 text-sm font-semibold text-ink" onClick={() => picker.current?.click()}>
          <FileIcon size={18} /> Upload a file, PDF or screenshot
        </button>
        <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />

        {message && <Notice tone="good">{message}</Notice>}
        <ErrorText>{error}</ErrorText>
        <CreditWarning me={me} />
        <FirstTime />

        {queue.length > 0 && (
          <Card>
            <h2 className="mb-2 font-semibold">Waiting to send ({queue.length})</h2>
            {!online && <p className="mb-2 text-sm text-amber-800">No signal. Photos are safe on this phone and will send automatically.</p>}
            <ul className="divide-y divide-line">
              {queue.map((q) => (
                <li key={q.client_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {partsOf(q).length > 1 ? `Long receipt, ${partsOf(q).length} photos` : q.name} · {formatDate(q.created_at)}
                    {q.mode === 'totals' && ' · totals only'}
                    <span className="ml-2 text-muted">{q.state === 'sending' ? 'Sending…' : q.state === 'error' ? q.error : 'Waiting'}</span>
                  </span>
                  {q.state === 'error' && (
                    <span className="flex gap-2">
                      <Button variant="ghost" onClick={() => retryItem(q.client_id).then(send)}>Retry</Button>
                      <Button variant="ghost" onClick={() => removeFromQueue(q.client_id)}>Remove</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {failed.length > 0 && (
          <Card>
            <h2 className="mb-2 font-semibold">Could not read</h2>
            <ul className="divide-y divide-line">
              {failed.map((u) => (
                <li key={u.id} className="space-y-2 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <a href={`/api/uploads/${u.id}/file`} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">View photo</a>
                    <span className="text-muted">{formatDate(u.created_at)}</span>
                  </div>
                  {u.error && <p className="text-muted">{u.error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => api<{ ok: boolean; error?: string }>(`/uploads/${u.id}/retry`, { method: 'POST' }).then((r) => { if (!r.ok && r.error) setError(r.error); loadServer(); onCreditChange(); }, (e) => setError(e.message))}>Try again</Button>
                    <Button variant="secondary" onClick={() => manual(u.id)}>Type it in</Button>
                    <Button variant="danger" onClick={() => api(`/uploads/${u.id}`, { method: 'DELETE' }).then(loadServer)}>Delete</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="py-2">
          <h2 className="pt-2 font-semibold">To check and save ({drafts.length})</h2>
          {drafts.length === 0 ? (
            <p className="py-2 text-sm text-muted">Nothing waiting. Receipts appear here after they are read.</p>
          ) : (
            <ul className="divide-y divide-line">
              {drafts.map((d) => (
                <li key={d.id}>
                  <a href={`#/review/${d.id}`} className="flex min-h-14 items-center gap-3 py-2.5">
                    <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.confidence === 'low' ? 'bg-gold' : 'bg-leaf'}`} />
                    <span className="flex-1">
                      <span className="font-semibold text-ink">{d.merchant ?? 'Unknown shop'}</span>
                      <span className="block text-xs text-muted">
                        {formatDate(d.receipt_date)}
                        {isOwner && ` · ${d.created_by_name}`}
                        {d.confidence === 'low' && <span className="ml-2 font-semibold text-amber-700">Check carefully</span>}
                      </span>
                    </span>
                    <Money cents={d.total_cents} currency={d.currency} className="font-semibold text-ink" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isOwner ? <CreditTile me={me} /> : <HelperAllowance go={go} />}
      </div>
    </div>
  );
}

/** One-off messages passed from another screen (e.g. Capture → "Reading…"). */
function takeFlash(): string {
  try {
    const m = sessionStorage.getItem('budget-flash') ?? '';
    sessionStorage.removeItem('budget-flash');
    return m;
  } catch {
    return '';
  }
}

export function flash(message: string) {
  try {
    sessionStorage.setItem('budget-flash', message);
  } catch {
    /* private mode: no message */
  }
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// This month's spending against the total of the category budgets.
function OwnerHeadline({ me }: { me: Me }) {
  const [spent, setSpent] = useState<number | null>(null);
  useEffect(() => {
    api<{ totals: { usd_cents: number } }>('/reports/month').then((r) => setSpent(r.totals.usd_cents), () => undefined);
  }, []);
  const budget = me.categories.filter((c) => c.active).reduce((n, c) => n + (c.monthly_budget_cents ?? 0), 0);
  const month = new Date().toLocaleDateString('en-GB', { month: 'long' });
  return (
    <div className="flex max-w-[60%] flex-col gap-1">
      <span className="text-[13px] text-on-band-muted">{greeting()} · {month}</span>
      <span className="font-display text-[34px] leading-none font-extrabold tracking-tight">{spent == null ? '—' : formatMoney(spent, 'USD')}</span>
      <span className="text-[13px] text-[#d3ddd5]">{budget > 0 ? `spent of ${formatMoney(budget, 'USD')} budget` : 'spent this month'}</span>
      {budget > 0 && spent != null && (
        <div className="mt-1.5 h-2 w-40 rounded-full bg-band-2">
          <div className={`h-2 rounded-full ${spent > budget ? 'bg-red-600' : 'bg-gold'}`} style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function HelperHeadline() {
  const [s, setS] = useState<MySummary | null>(null);
  useEffect(() => {
    api<MySummary>('/my/summary').then(setS, () => undefined);
  }, []);
  return (
    <div className="flex max-w-[60%] flex-col gap-1">
      <span className="text-[13px] text-on-band-muted">{greeting()}</span>
      <span className="font-display text-[34px] leading-none font-extrabold tracking-tight">{s ? formatMoney(s.allowance.remaining_cents, 'USD') : '—'}</span>
      <span className="text-[13px] text-[#d3ddd5]">allowance left</span>
    </div>
  );
}

function FirstTime() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('budget-help-seen') === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const close = () => {
    try {
      localStorage.setItem('budget-help-seen', '1');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };
  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-band-2 p-3 pl-4 text-on-band">
      <HelpIcon />
      <a href="#/help" onClick={close} className="flex-1 text-sm">
        <b className="block">New here? See how it works</b>
        <span className="text-on-band-muted">Two minutes: snapping, long receipts, rates, helpers.</span>
      </a>
      <button type="button" aria-label="Hide this" onClick={close} className="flex h-11 w-11 items-center justify-center rounded-[12px] text-on-band-muted">
        <CloseIcon size={18} />
      </button>
    </div>
  );
}

interface MySummary {
  settings: { allowance_cents: number; period: string; carry_over: boolean };
  allowance: { budget_cents: number; spent_cents: number; remaining_cents: number };
  cash_in_hand_cents: number;
  cash_low: boolean;
  owed_to_helper_cents: number;
}

function HelperAllowance({ go }: { go: (to: string) => void }) {
  const [s, setS] = useState<MySummary | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<MySummary>('/my/summary').then(setS, (e) => setErr(e.message));
  }, []);
  if (err) return <Notice tone="warn">{err}</Notice>;
  if (!s) return null;
  const periodName = s.settings.period === 'weekly' ? 'this week' : s.settings.period === 'monthly' ? 'this month' : 'so far';
  return (
    <div className="space-y-2.5">
      {s.cash_low && (
        <Notice tone="warn">
          Cash is getting low. Count what you have and cash up, or pay with your own money (choose “My own money” when you save) and claim it back.
          <Button variant="gold" className="mt-2 w-full" onClick={() => go('cashup')}>Cash up now</Button>
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Tile label="Allowance left" value={<Money cents={s.allowance.remaining_cents} className={s.allowance.remaining_cents < 0 ? 'text-red-700' : ''} />} note={s.settings.carry_over ? 'carries over' : periodName}>
          <Bar value={s.allowance.spent_cents} max={s.allowance.budget_cents} />
        </Tile>
        <Tile href="#/cashup" label="Cash you should have" value={<Money cents={s.cash_in_hand_cents} />} note={s.owed_to_helper_cents > 0 ? `owed back ${formatMoney(s.owed_to_helper_cents, 'USD')}` : 'tap to cash up'} />
      </div>
    </div>
  );
}

function Tile({ label, value, note, href, children }: { label: string; value: ReactNode; note?: ReactNode; href?: string; children?: ReactNode }) {
  const body = (
    <>
      <span className="text-xs text-muted">{label}</span>
      <span className="font-display text-[22px] font-extrabold text-ink">{value}</span>
      {note && <span className="text-xs font-semibold text-brand">{note}</span>}
      {children}
    </>
  );
  const cls = 'flex flex-col gap-1 rounded-[18px] border border-line bg-surface px-3.5 py-3';
  return href ? <a href={href} className={cls}>{body}</a> : <div className={cls}>{body}</div>;
}

// Owner: reading credit and the helpers' cash at a glance.
function CreditTile({ me }: { me: Me }) {
  const [cash, setCash] = useState<{ cash: number; owed: number; n: number } | null>(null);
  useEffect(() => {
    api<{ helpers: Array<{ cash_in_hand_cents: number; owed_to_helper_cents: number; active: number }> }>('/helpers').then((d) => {
      const active = d.helpers.filter((h) => h.active !== 0);
      setCash({ cash: active.reduce((n, h) => n + h.cash_in_hand_cents, 0), owed: active.reduce((n, h) => n + h.owed_to_helper_cents, 0), n: active.length });
    }, () => undefined);
  }, []);
  const c = me.credit;
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Tile
        href="#/settings"
        label="Reading credit"
        value={!c || c.unlimited ? 'Unlimited' : formatCredit(c.balance_micros)}
        note={!c || c.unlimited ? 'no limit on this account' : `≈ ${receiptsFor(c.balance_micros, c.per_receipt_micros).toLocaleString()} receipts`}
      />
      <Tile
        href="#/helpers"
        label={cash?.n ? `Helpers' cash (${cash.n})` : 'Helpers'}
        value={cash?.n ? <Money cents={cash.cash} /> : '—'}
        note={cash?.n ? (cash.owed > 0 ? `owed back ${formatMoney(cash.owed, 'USD')}` : 'all square') : 'add a helper'}
      />
    </div>
  );
}

// Reading credit warnings. Helpers only hear about credit when it runs low.
function CreditWarning({ me }: { me: Me }) {
  const c = me.credit;
  if (!c || c.unlimited) return null;
  const left = receiptsFor(c.balance_micros, c.per_receipt_micros);
  const owner = me.user.role === 'owner';
  if (c.balance_micros <= 0) {
    return (
      <Notice tone="warn">
        Reading credit is used up, so photos can't be read automatically. {owner ? <>Contact <Contact c={c} /> to top up.</> : 'Ask the owner to top up.'} You can still type receipts in by hand.
      </Notice>
    );
  }
  if (left < 20) {
    return (
      <Notice tone="warn">
        Reading credit is running low: about {left} receipt{left === 1 ? '' : 's'} left. {owner ? <>Contact <Contact c={c} /> to top up.</> : 'Let the owner know.'}
      </Notice>
    );
  }
  return null;
}

export function Contact({ c }: { c: CreditStatus }) {
  return c.contact_link ? (
    <a href={c.contact_link} target="_blank" rel="noreferrer" className="font-medium underline">
      {c.contact}
    </a>
  ) : (
    <b>{c.contact}</b>
  );
}
