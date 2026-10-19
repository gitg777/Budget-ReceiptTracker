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
import { Capture } from './pages/Capture';
import { Help } from './pages/Help';
import { Feedback } from './pages/Feedback';
import { GitgMark } from './art';
import { CashIcon, ChartIcon, HomeIcon, MoreIcon, PeopleIcon, ReceiptIcon } from './icons';

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
    if (!checked) return <div className="p-8 text-center text-muted">Loading…</div>;
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
    case 'capture':
      content = <Capture go={go} />;
      break;
    case 'help':
      content = <Help me={me} />;
      break;
    case 'feedback':
      content = <Feedback me={me} />;
      break;
    case 'cashup':
      content = !isOwner ? <CashUp go={go} /> : null;
      break;
    default:
      content = <Home me={me} go={go} online={online} onCreditChange={refreshMe} />;
  }

  const tabs: Array<[string, string, typeof HomeIcon]> = isOwner
    ? [
        ['home', 'Home', HomeIcon],
        ['receipts', 'Receipts', ReceiptIcon],
        ['reports', 'Reports', ChartIcon],
        ['helpers', 'Helpers', PeopleIcon],
        ['settings', 'More', MoreIcon],
      ]
    : [
        ['home', 'Home', HomeIcon],
        ['receipts', 'My receipts', ReceiptIcon],
        ['cashup', 'Cash-up', CashIcon],
        ['settings', 'More', MoreIcon],
      ];
  // Which tab a screen belongs to.
  const activeTab = page === 'review' || page === 'capture' ? 'home' : page === 'help' || page === 'feedback' || page === 'admin' ? 'settings' : page;
  // Capture is a full-screen camera: no header or tabs.
  if (page === 'capture') return <div className="mx-auto min-h-dvh max-w-2xl">{content}</div>;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-24">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-band px-5 py-3 text-on-band">
        <a href="#/home" className="flex min-w-0 items-center gap-2.5">
          <GitgMark />
          <span className="truncate font-display text-[17px] font-semibold">{me.user.account_name}</span>
        </a>
        <span className="flex shrink-0 items-center gap-2 text-sm text-on-band-muted">
          {me.user.display_name}
          {!online && <span className="rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-on-gold">Offline</span>}
        </span>
      </header>
      <main className={page === 'home' || page === '' ? '' : 'p-4'}>{content ?? <p className="p-4">Not available.</p>}</main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-2xl px-2">
          {tabs.map(([key, label, Icon]) => {
            const on = activeTab === key || (key === 'home' && !tabs.some(([k]) => k === activeTab));
            return (
              <a
                key={key}
                href={'#/' + key}
                aria-current={on ? 'page' : undefined}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? 'font-semibold text-brand' : 'text-muted'}`}
              >
                <Icon />
                {label}
              </a>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
