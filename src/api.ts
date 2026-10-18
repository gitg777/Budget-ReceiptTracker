// Small wrapper around fetch for the /api endpoints.

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** True when the request never reached the server (no signal, server down). */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof ApiError && e.status >= 500);
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), credentials: 'same-origin' };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch('/api' + path, init);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface Category {
  id: number;
  name: string;
  monthly_budget_cents: number | null;
  sort: number;
  active: number;
}

export interface Me {
  user: { id: number; account_id: number; account_name: string; role: 'owner' | 'helper'; display_name: string; email: string | null; username: string | null };
  categories: Category[];
  currencies: string[];
  today: string;
}
