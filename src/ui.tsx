import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { formatMoney } from '../shared/money';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-teal-700 text-white hover:bg-teal-600 disabled:bg-stone-300',
    secondary: 'bg-surface text-stone-800 border border-stone-300 hover:bg-stone-100 disabled:text-stone-400',
    danger: 'bg-surface text-red-700 border border-red-300 hover:bg-red-50',
    ghost: 'text-teal-800 hover:bg-teal-50',
  }[variant];
  return <button className={`rounded-lg px-4 py-2.5 text-base font-medium transition ${styles} ${className}`} {...props} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200 bg-surface p-4 shadow-sm ${className}`}>{children}</div>;
}

export function Money({ cents, currency = 'USD', className = '' }: { cents: number | null | undefined; currency?: string; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatMoney(cents ?? 0, currency)}</span>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{children}</p>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'good' }) {
  const styles = { info: 'bg-sky-50 text-sky-900', warn: 'bg-amber-50 text-amber-900', good: 'bg-emerald-50 text-emerald-900' }[tone];
  return <div className={`rounded-lg px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h1 className="text-xl font-semibold">{children}</h1>
      {action}
    </div>
  );
}

/** A horizontal bar for budget/actual comparisons. Goes red past 100%. */
export function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200">
      <div className={`h-full rounded-full ${over ? 'bg-red-600' : 'bg-teal-600'}`} style={{ width: `${over ? 100 : pct}%` }} />
    </div>
  );
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return 'No date';
  const dt = new Date(d.length === 10 ? d + 'T12:00:00' : d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function monthLabel(m: string): string {
  return new Date(m + '-15T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function monthEnd(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}
