// Light / dark mode. "system" follows the phone's setting and changes with it.
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'budget-theme';

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(choice: ThemeChoice = getTheme()): void {
  const dark = choice === 'dark' || (choice === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a1a11' : '#10291b');
}

const listeners = new Set<(c: ThemeChoice) => void>();
/** Lets every Day/Night switch on screen show the same choice. */
export function onThemeChange(fn: (c: ThemeChoice) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: still applies for this visit */
  }
  applyTheme(choice);
  listeners.forEach((fn) => fn(choice));
}

media.addEventListener('change', () => applyTheme());
