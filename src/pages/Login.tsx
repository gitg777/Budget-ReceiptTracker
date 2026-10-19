import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Button, Card, ErrorText } from '../ui';
import { GitgMark, MatoboHero } from '../art';

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ login: '', password: '', display_name: '', account_name: '', email: '', code: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await api('/auth/login', { body: { login: f.login, password: f.password } });
      else await api('/auth/register', { body: { email: f.email, password: f.password, display_name: f.display_name, account_name: f.account_name, code: f.code } });
      onDone();
    } catch (err) {
      setError(err instanceof TypeError ? 'No connection. You need signal to log in the first time.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col">
      <section className="relative h-52 overflow-hidden bg-band text-on-band">
        <MatoboHero className="absolute inset-0 h-full w-full" />
        <div className="relative flex flex-col gap-2 px-5 pt-6">
          <GitgMark size={40} />
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-on-band">Receipts &amp; Budget</h1>
          <p className="max-w-[55%] text-sm text-[#d3ddd5]">Photograph receipts. See where the money goes.</p>
        </div>
      </section>
      <div className="flex flex-1 flex-col px-4 pb-6">
      <Card>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'login' ? (
            <>
              <div>
                <label htmlFor="login">Email or username</label>
                <input id="login" autoComplete="username" autoCapitalize="none" value={f.login} onChange={set('login')} required />
              </div>
              <div>
                <label htmlFor="pw">Password or PIN</label>
                <input id="pw" type="password" autoComplete="current-password" value={f.password} onChange={set('password')} required />
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="name">Your name</label>
                <input id="name" value={f.display_name} onChange={set('display_name')} required />
              </div>
              <div>
                <label htmlFor="acct">Budget name (e.g. "Home" or "Lodge")</label>
                <input id="acct" value={f.account_name} onChange={set('account_name')} />
              </div>
              <div>
                <label htmlFor="email">Email</label>
                <input id="email" type="email" autoComplete="email" value={f.email} onChange={set('email')} required />
              </div>
              <div>
                <label htmlFor="pw2">Password (8+ characters)</label>
                <input id="pw2" type="password" autoComplete="new-password" minLength={8} value={f.password} onChange={set('password')} required />
              </div>
              <div>
                <label htmlFor="code">Invite code (if you were given one)</label>
                <input id="code" autoCapitalize="none" value={f.code} onChange={set('code')} />
              </div>
            </>
          )}
          <ErrorText>{error}</ErrorText>
          <Button variant="gold" className="min-h-13 w-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create owner account'}
          </Button>
        </form>
      </Card>
      <button className="mt-4 min-h-11 text-sm font-semibold text-brand underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an owner account' : 'Already have an account? Log in'}
      </button>
      <p className="mt-2 text-center text-xs text-muted">Helpers: ask the owner for your username and PIN.</p>
      </div>
    </div>
  );
}
