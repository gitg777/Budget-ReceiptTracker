import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchLatestRates } from '../worker/rates';

// Real response from the currency-api feed on 2026-10-18 (trimmed to a few currencies).
const sample = JSON.parse(readFileSync(new URL('./fixtures/currency-api-usd-2026-10-18.json', import.meta.url), 'utf8'));

afterEach(() => vi.unstubAllGlobals());

describe('fetchLatestRates', () => {
  it('reads ZWG from the feed and drops the retired ZWL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(sample))));
    const r = await fetchLatestRates();
    expect(r.date).toBe('2026-10-18');
    expect(r.rates.ZWG).toBeCloseTo(26.6136, 3);
    expect(r.rates.ZWL).toBeUndefined();
    expect(r.provider).toMatch(/jsdelivr/);
  });

  it('falls back to the mirror when the first source is down', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('jsdelivr') ? new Response('down', { status: 503 }) : new Response(JSON.stringify(sample)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchLatestRates();
    expect(r.provider).toMatch(/pages\.dev/);
  });

  it('fails loudly when every source is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await expect(fetchLatestRates()).rejects.toThrow(/All rate sources failed/);
  });
});
