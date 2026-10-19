import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Me } from './api';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Review } from './pages/Review';
import { ReceiptList } from './pages/ReceiptList';
import { Reports } from './pages/Reports';
import { Helpers } from './pages/Helpers';
import { Settings } from './pages/Settings';
import { CashUp } from './pages/CashUp';
import { Admin } from './pages/Admin';

const ME_KEY = 'budget-me';

function readCachedMe(): Me | null {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function useHashRoute(): [string[], (to: string) => void] {
  const parse = () => (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (to: string) => (location.hash = '#/' + to)];
}

export function App() {
  // The last known login is kept on the phone so the app opens (and can queue photos) with no signal.
  const [me, setMe] = useState<Me | null>(readCachedMe);
  const [checked, setChecked] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [route, go] = useHashRoute();

  const refreshMe = useCallback(async () => {
    try {
      const fresh = await api<Me>('/me');
      setMe(fresh);
      localStorage.setItem(ME_KEY, JSON.stringify(fresh));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        localStorage.removeItem(ME_KEY);
      }
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    refreshMe();
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, [refreshMe]);

  if (!me) {
    if (!checked) return <div className="p-8 text-center text-stone-500">Loading…</div>;
    return <Login onDone={refreshMe} />;
  }

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* offline: still forget locally */
    }
    localStorage.removeItem(ME_KEY);
    setMe(null);
    go('home');
  };

  const isOwner = me.user.role === 'owner';
  const [page, arg] = route;
  let content;
  switch (page) {
    case 'review':
      content = <Review me={me} id={Number(arg)} go={go} />;
      break;
    case 'receipts':
      content = <ReceiptList me={me} go={go} />;
      break;
    case 'reports':
      content = isOwner ? <Reports me={me} go={go} /> : null;
      break;
    case 'helpers':
      content = isOwner ? <Helpers me={me} id={arg ? Number(arg) : null} go={go} /> : null;
      break;
    case 'settings':
      content = <Settings me={me} onChange={refreshMe} logout={logout} />;
      break;
    case 'admin':
      content = me.user.is_admin ? <Admin /> : null;
      break;
    case 'cashup':
      content = !isOwner ? <CashUp go={go} /> : null;
      break;
    default:
      content = <Home me={me} go={go} online={online} onCreditChange={refreshMe} />;
  }

  const tabs = isOwner
    ? [
        ['home', 'Capture'],
        ['receipts', 'Receipts'],
        ['reports', 'Reports'],
        ['helpers', 'Helpers'],
        ['settings', 'More'],
      ]
    : [
        ['home', 'Capture'],
        ['receipts', 'My receipts'],
        ['cashup', 'Cash-up'],
        ['settings', 'More'],
      ];

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-24">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-surface/95 px-4 py-3 backdrop-blur">
        <span className="font-semibold text-teal-800">{me.user.account_name}</span>
        <span className="text-sm text-stone-500">
          {me.user.display_name}
          {!online && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-amber-900">Offline</span>}
        </span>
      </header>
      <main className="p-4">{content ?? <p>Not available.</p>}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-2xl">
          {tabs.map(([key, label]) => (
            <a
              key={key}
              href={'#/' + key}
              className={`flex-1 py-3 text-center text-sm font-medium ${page === key || (page === 'review' && key === 'home') ? 'text-teal-800' : 'text-stone-500'}`}
            >
              {label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
