import { useEffect, useState, type FormEvent } from 'react';
import { api, type Me } from '../api';
import { Button, Card, ErrorText, Notice, PageTitle, Segmented, formatDate } from '../ui';
import { ChatIcon } from '../icons';

type Kind = 'problem' | 'idea' | 'question' | 'praise';

interface Sent {
  id: number;
  kind: Kind;
  message: string;
  status: 'new' | 'read' | 'done';
  created_at: string;
}

const KINDS: Array<[Kind, string]> = [
  ['problem', 'Problem'],
  ['idea', 'Idea'],
  ['question', 'Question'],
  ['praise', 'Praise'],
];

const PROMPTS: Record<Kind, string> = {
  problem: 'What happened, and what did you expect? e.g. "The total on my OK Mart receipt was read as 21 instead of 12."',
  idea: 'What would make the app more useful for you?',
  question: 'What would you like to know?',
  praise: 'What do you like?',
};

const STATUS: Record<Sent['status'], string> = { new: 'Sent', read: 'Seen', done: 'Dealt with' };

export function Feedback({ me }: { me: Me }) {
  const [kind, setKind] = useState<Kind>('problem');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Sent[]>([]);

  const load = () => api<{ feedback: Sent[] }>('/feedback/mine').then((d) => setSent(d.feedback), () => undefined);
  useEffect(() => {
    load();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // A little context helps reproduce problems; nothing personal is included.
      const appInfo = `${window.innerWidth}x${window.innerHeight} · ${matchMedia('(display-mode: standalone)').matches ? 'installed' : 'browser'} · ${navigator.userAgent.slice(0, 200)}`;
      await api('/feedback', { body: { kind, message, app_info: appInfo } });
      setMessage('');
      setDone(true);
      load();
    } catch (err) {
      setError(navigator.onLine ? (err as Error).message : 'No signal. Try again when you are online, or use WhatsApp below.');
    } finally {
      setBusy(false);
    }
  };

  const link = me.credit?.contact_link;
  return (
    <div className="space-y-4">
      <PageTitle>Send feedback</PageTitle>
      <p className="text-sm text-muted">Tell us what's not working, what's confusing, or what you'd like. It goes straight to the person who runs the app.</p>

      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Segmented<Kind> label="Kind of feedback" value={kind} onChange={setKind} options={KINDS} />
          <div>
            <label htmlFor="fb">Your message</label>
            <textarea id="fb" rows={5} value={message} placeholder={PROMPTS[kind]} onChange={(e) => { setMessage(e.target.value); setDone(false); }} />
          </div>
          {done && <Notice tone="good">Thank you, it's been sent.</Notice>}
          <ErrorText>{error}</ErrorText>
          <Button variant="gold" className="min-h-13 w-full" disabled={busy || message.trim().length < 3}>
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </form>
      </Card>

      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="flex min-h-13 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-brand font-semibold text-brand">
          <ChatIcon size={20} /> Rather chat? {me.credit.contact}
        </a>
      )}

      {sent.length > 0 && (
        <Card className="py-2">
          <h2 className="pt-2 font-semibold">What you've sent</h2>
          <ul className="divide-y divide-line text-sm">
            {sent.map((f) => (
              <li key={f.id} className="py-2.5">
                <p className="flex justify-between gap-2 text-xs text-muted">
                  <span>{KINDS.find(([k]) => k === f.kind)?.[1]} · {formatDate(f.created_at)}</span>
                  <span className={f.status === 'done' ? 'font-semibold text-brand' : ''}>{STATUS[f.status]}</span>
                </p>
                <p className="mt-0.5 whitespace-pre-line text-ink">{f.message}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
