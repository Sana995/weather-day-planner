import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLiveEvents, _clearEventsCache } from '../src/events.js';

const PANEL_BODY = {
  events_results: [
    {
      title: 'Festival Lent',
      date: { start_date: 'Aug 5', when: 'Aug 5 – 16' },
      venue: { name: 'Lent, Maribor' },
    },
    { date: { when: 'Fri, 20:00' } }, // titleless — dropped
    {
      title: 'Open-air cinema night',
      date: { start_date: 'Aug 8' },
      address: ['Trg Leona Štuklja, Maribor'],
    },
  ],
};

const EMPTY_PANEL = { error: "Google hasn't returned any results for this query." };

const SERP_BODY = {
  organic_results: [
    { title: 'Vsi dogodki in prireditve', snippet: 'Letni kino Minoriti · 15. 7. 2026 → 22. 8. 2026' },
    { title: 'No snippet here' }, // snippetless — dropped
    { title: 'Festival Maribor 2026', snippet: 'The festival will open with an inaugural concert on 8 August 2026' },
  ],
};

describe('getLiveEvents', () => {
  beforeEach(() => {
    process.env.SERPAPI_API_KEY = 'serp-key';
    _clearEventsCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns [] without fetching when the key is unset', async () => {
    delete process.env.SERPAPI_API_KEY;
    const fn = vi.fn();
    vi.stubGlobal('fetch', fn);
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns normalized panel listings when google_events answers, without a fallback call', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => PANEL_BODY });
    vi.stubGlobal('fetch', fn);
    const events = await getLiveEvents('Maribor', 'SI', '2026-08-09');
    expect(fn).toHaveBeenCalledTimes(1);
    const url = fn.mock.calls[0][0];
    expect(url).toContain('engine=google_events');
    expect(url).toContain('q=Events+in+Maribor');
    expect(url).toContain('gl=si');
    expect(fn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(events).toEqual([
      { title: 'Festival Lent', when: 'Aug 5 – 16', venue: 'Lent, Maribor' },
      { title: 'Open-air cinema night', when: 'Aug 8', venue: 'Trg Leona Štuklja, Maribor' },
    ]);
  });

  it('falls back to organic search snippets scoped to the requested month', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => EMPTY_PANEL })
      .mockResolvedValueOnce({ ok: true, json: async () => SERP_BODY });
    vi.stubGlobal('fetch', fn);
    const events = await getLiveEvents('Maribor', 'SI', '2026-08-09');
    expect(fn).toHaveBeenCalledTimes(2);
    const url = fn.mock.calls[1][0];
    expect(url).toContain('engine=google');
    expect(url).toContain('q=Maribor+events+August+2026');
    expect(events).toEqual([
      { title: 'Vsi dogodki in prireditve', snippet: 'Letni kino Minoriti · 15. 7. 2026 → 22. 8. 2026' },
      { title: 'Festival Maribor 2026', snippet: 'The festival will open with an inaugural concert on 8 August 2026' },
    ]);
  });

  it('returns [] on HTTP failure and network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    _clearEventsCache();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    warn.mockRestore();
  });

  it('does not fire the billable fallback search after an upstream failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fn);
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(1); // the same key would fail again
    warn.mockRestore();
  });

  it('does not cache failures — a later call retries and can succeed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => PANEL_BODY });
    vi.stubGlobal('fetch', fn);
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    const events = await getLiveEvents('Maribor', 'SI', '2026-08-09');
    expect(events).toHaveLength(2);
    expect(fn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('caches per city and month for 10 minutes — the free tier is finite', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => PANEL_BODY });
    vi.stubGlobal('fetch', fn);
    await getLiveEvents('Maribor', 'SI', '2026-08-09');
    await getLiveEvents('Maribor', 'SI', '2026-08-09');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
