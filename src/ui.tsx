import { useEffect, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { formatMoney } from '../shared/money';
import { getTheme, onThemeChange, setTheme, type ThemeChoice } from './theme';

type Variant = 'primary' | 'gold' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  // forest green: ordinary actions
  primary: 'bg-brand text-on-brand hover:opacity-90 disabled:opacity-40',
  // gold: the one main action on a screen (snap, save, read)
  gold: 'bg-gold text-on-gold hover:bg-gold-hover disabled:opacity-40',
  secondary: 'bg-transparent text-brand border-[1.5px] border-brand hover:bg-teal-50 disabled:opacity-40',
  danger: 'bg-transparent text-red-700 border-[1.5px] border-red-300 hover:bg-red-50',
  ghost: 'text-brand hover:bg-teal-50',
};

const BUTTON_BASE = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] px-4 py-2.5 text-base font-semibold transition';

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

/** A link that looks like a button (for moving to another screen). */
export function LinkButton({ variant = 'primary', className = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[18px] border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function Money({ cents, currency = 'USD', className = '' }: { cents: number | null | undefined; currency?: string; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatMoney(cents ?? 0, currency)}</span>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-[14px] bg-red-50 px-3 py-2 text-sm text-red-800">{children}</p>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'good' }) {
  const styles = {
    info: 'bg-ground-2 text-ink',
    warn: 'bg-amber-50 text-amber-900 border border-gold',
    good: 'bg-emerald-50 text-emerald-900',
  }[tone];
  return <div className={`rounded-[14px] px-3 py-2.5 text-sm ${styles}`}>{children}</div>;
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h1 className="text-2xl font-extrabold tracking-tight">{children}</h1>
      {action}
    </div>
  );
}

/** A horizontal bar for budget/actual comparisons: green, gold near the limit, red past it. */
export function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;
  const colour = over ? 'bg-red-600' : pct >= 85 ? 'bg-gold' : 'bg-leaf';
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-ground-2">
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${over ? 100 : pct}%` }} />
    </div>
  );
}

/** Day / Night / Same as phone. Shown on Home and in More. */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>(getTheme);
  useEffect(() => onThemeChange(setChoice), []);
  const options: Array<[ThemeChoice, string]> = [
    ['system', 'Same as phone'],
    ['light', 'Day'],
    ['dark', 'Night'],
  ];
  return (
    <div role="group" aria-label="Look" className="grid grid-cols-3 gap-1 rounded-[14px] bg-ground-2 p-1">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          onClick={() => setTheme(value)}
          className={`min-h-11 rounded-[10px] text-sm font-semibold transition ${choice === value ? 'bg-brand text-on-brand' : 'text-body'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** A choice between a few options (segmented control). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid gap-1 rounded-[14px] bg-ground-2 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`min-h-11 rounded-[10px] px-2 text-sm font-semibold transition ${value === v ? 'bg-brand text-on-brand' : 'text-body'}`}
        >
          {text}
        </button>
      ))}
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
