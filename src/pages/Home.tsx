import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Me } from '../api';
import { compressImage } from '../image';
import { addToQueue, listQueue, onQueueChange, processQueue, removeFromQueue, retryItem, type QueuedPhoto } from '../queue';
import { Button, Card, ErrorText, Money, Notice, PageTitle, formatDate, Bar } from '../ui';

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

export function Home({ me, go, online }: { me: Me; go: (to: string) => void; online: boolean }) {
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [failed, setFailed] = useState<FailedUpload[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

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
      await loadServer();
    }
  }, [loadServer]);

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

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setMessage('');
    for (const file of Array.from(files)) {
      if (file.type === 'application/pdf' && file.size > 10 * 1024 * 1024) {
        setError(`${file.name} is larger than 10 MB.`);
        continue;
      }
      const blob = await compressImage(file);
      await addToQueue(blob, file.name || 'receipt.jpg');
    }
    setMessage(navigator.onLine ? 'Reading… this takes a few seconds per photo.' : 'Saved on this phone. It will be sent when you have signal.');
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
    <div className="space-y-4">
      {me.user.role === 'helper' && <HelperAllowance go={go} />}

      <PageTitle>Add a receipt</PageTitle>
      <div className="grid grid-cols-2 gap-3">
        <Button className="py-6 text-lg" onClick={() => camera.current?.click()}>
          📷 Take photo
        </Button>
        <Button variant="secondary" className="py-6 text-lg" onClick={() => picker.current?.click()}>
          🖼 Choose file
        </Button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      <button className="text-sm text-teal-800 underline" onClick={() => manual()}>
        No photo? Type a receipt in by hand
      </button>
      <p className="text-xs text-stone-500">Tip: flat surface, good light, whole receipt in the frame. One photo can hold several receipts.</p>

      {message && <Notice tone="good">{message}</Notice>}
      <ErrorText>{error}</ErrorText>

      {queue.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Waiting to send ({queue.length})</h2>
          {!online && <p className="mb-2 text-sm text-amber-800">No signal. Photos are safe on this phone and will send automatically.</p>}
          <ul className="divide-y divide-stone-100">
            {queue.map((q) => (
              <li key={q.client_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {q.name} · {formatDate(q.created_at)}
                  <span className="ml-2 text-stone-500">{q.state === 'sending' ? 'Sending…' : q.state === 'error' ? q.error : 'Waiting'}</span>
                </span>
                {q.state === 'error' && (
                  <span className="flex gap-2">
                    <Button variant="ghost" onClick={() => retryItem(q.client_id).then(send)}>Retry</Button>
                    <Button variant="ghost" onClick={() => removeFromQueue(q.client_id).then(() => listQueue().then(setQueue))}>Remove</Button>
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
          <ul className="divide-y divide-stone-100">
            {failed.map((u) => (
              <li key={u.id} className="space-y-2 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <a href={`/api/uploads/${u.id}/file`} target="_blank" rel="noreferrer" className="text-teal-800 underline">View photo</a>
                  <span className="text-stone-500">{formatDate(u.created_at)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => api(`/uploads/${u.id}/retry`, { method: 'POST' }).then(loadServer, (e) => setError(e.message))}>Try again</Button>
                  <Button variant="secondary" onClick={() => manual(u.id)}>Type it in</Button>
                  <Button variant="danger" onClick={() => api(`/uploads/${u.id}`, { method: 'DELETE' }).then(loadServer)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-semibold">To check and save ({drafts.length})</h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing waiting. Receipts appear here after they are read.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {drafts.map((d) => (
              <li key={d.id}>
                <a href={`#/review/${d.id}`} className="flex items-center justify-between py-3">
                  <span>
                    <span className="font-medium">{d.merchant ?? 'Unknown shop'}</span>
                    <span className="block text-sm text-stone-500">
                      {formatDate(d.receipt_date)}
                      {me.user.role === 'owner' && ` · ${d.created_by_name}`}
                      {d.confidence === 'low' && <span className="ml-2 text-amber-700">Check carefully</span>}
                    </span>
                  </span>
                  <Money cents={d.total_cents} currency={d.currency} className="font-medium" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
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
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-stone-600">Allowance left {s.settings.carry_over ? '(carries over)' : periodName}</span>
        <Money cents={s.allowance.remaining_cents} className={`text-xl font-semibold ${s.allowance.remaining_cents < 0 ? 'text-red-700' : ''}`} />
      </div>
      <Bar value={s.allowance.spent_cents} max={s.allowance.budget_cents} />
      <div className="flex justify-between text-sm">
        <span>Cash you should have</span>
        <Money cents={s.cash_in_hand_cents} className="font-medium" />
      </div>
      {s.owed_to_helper_cents > 0 && (
        <div className="flex justify-between text-sm">
          <span>Owed back to you (own money)</span>
          <Money cents={s.owed_to_helper_cents} className="font-medium text-teal-800" />
        </div>
      )}
      {s.cash_low && (
        <Notice tone="warn">
          Cash is running low. Do a cash-up and ask for more cash. If you must pay with your own money, choose “My own money” when you save the receipt, and it will be paid back.
          <Button variant="secondary" className="mt-2 w-full" onClick={() => go('cashup')}>Cash up now</Button>
        </Notice>
      )}
    </Card>
  );
}
