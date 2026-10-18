import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Button, Card, ErrorText } from '../ui';

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
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-1 text-center text-2xl font-semibold text-teal-800">Receipts & Budget</h1>
      <p className="mb-6 text-center text-stone-500">Photograph receipts. See where the money goes.</p>
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
          <Button className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create owner account'}
          </Button>
        </form>
      </Card>
      <button className="mt-4 text-sm text-teal-800 underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an owner account' : 'Already have an account? Log in'}
      </button>
      <p className="mt-2 text-center text-xs text-stone-500">Helpers: ask the owner for your username and PIN.</p>
    </div>
  );
}
