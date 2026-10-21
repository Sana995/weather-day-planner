import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLiveEvents, _clearEventsCache } from '../src/events.js';

// SearchApi google_events after its 2026-08 change: date, start_time and
// venue are plain strings; address holds a city or neighbourhood.
const PANEL_BODY = {
  events: [
    {
      position: 1,
      title: 'Festival Lent',
      date: 'Wed, Aug 5',
      start_time: 'Aug 5, 8:00 PM',
      venue: 'Lent, Maribor',
      address: 'Maribor, Slovenia',
    },
    { position: 2, date: 'Fri, Aug 7', start_time: 'Aug 7, 8:00 PM' }, // titleless, dropped
    {
      position: 3,
      title: 'Open-air cinema night',
      date: 'Tomorrow',
      address: 'Trg Leona Štuklja, Maribor',
    },
  ],
};

const EMPTY_PANEL = { search_metadata: { status: 'Success' }, events: [] };

const SEARCH_BODY = {
  organic_results: [
    { title: 'Vsi dogodki in prireditve', snippet: 'Letni kino Minoriti · 15. 7. 2026 → 22. 8. 2026' },
    { title: 'No snippet here' }, // snippetless, dropped
    { title: 'Festival Maribor 2026', snippet: 'The festival will open with an inaugural concert on 8 August 2026' },
  ],
};

const ok = (body) => ({ ok: true, json: async () => body });

describe('getLiveEvents', () => {
  beforeEach(() => {
    process.env.SEARCHAPI_API_KEY = 'searchapi-key';
    _clearEventsCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns [] without fetching when the key is unset', async () => {
    delete process.env.SEARCHAPI_API_KEY;
    const fn = vi.fn();
    vi.stubGlobal('fetch', fn);
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('queries SearchApi google_events with the key in a Bearer header, never the URL', async () => {
    const fn = vi.fn().mockResolvedValue(ok(PANEL_BODY));
    vi.stubGlobal('fetch', fn);
    await getLiveEvents('Maribor', 'SI', '2026-08-09');
    const [url, init] = fn.mock.calls[0];
    expect(url.startsWith('https://www.searchapi.io/api/v1/search?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('engine')).toBe('google_events');
    expect(params.get('q')).toBe('Events in Maribor');
    expect(params.get('gl')).toBe('si');
    expect(params.get('hl')).toBe('en');
    expect(url).not.toContain('searchapi-key');
    expect(params.has('api_key')).toBe(false);
    expect(init.headers).toEqual({ Authorization: 'Bearer searchapi-key' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns normalized panel listings when google_events answers, without a fallback call', async () => {
    const fn = vi.fn().mockResolvedValue(ok(PANEL_BODY));
    vi.stubGlobal('fetch', fn);
    const events = await getLiveEvents('Maribor', 'SI', '2026-08-09');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      // start_time is absolute, so it wins over the date string
      { title: 'Festival Lent', when: 'Aug 5, 8:00 PM', venue: 'Lent, Maribor' },
      // no start_time: the date string; no venue: the address
      { title: 'Open-air cinema night', when: 'Tomorrow', venue: 'Trg Leona Štuklja, Maribor' },
    ]);
  });

  it('never leaks a non-string field (the pre-2026-08 object shape) into a listing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({
      events: [{ title: 'Old shape', date: { when: 'Aug 5' }, venue: { name: 'Lent' } }],
    })));
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([
      { title: 'Old shape', when: '', venue: '' },
    ]);
  });

  it('omits gl when the country is not a two-letter code', async () => {
    const fn = vi.fn().mockResolvedValue(ok(PANEL_BODY));
    vi.stubGlobal('fetch', fn);
    await getLiveEvents('Maribor', '', '2026-08-09');
    expect(new URL(fn.mock.calls[0][0]).searchParams.has('gl')).toBe(false);
  });

  it('falls back to organic search snippets scoped to the requested month', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(ok(EMPTY_PANEL))
      .mockResolvedValueOnce(ok(SEARCH_BODY));
    vi.stubGlobal('fetch', fn);
    const events = await getLiveEvents('Maribor', 'SI', '2026-08-09');
    expect(fn).toHaveBeenCalledTimes(2);
    const [url, init] = fn.mock.calls[1];
    const params = new URL(url).searchParams;
    expect(params.get('engine')).toBe('google');
    expect(params.get('q')).toBe('Maribor events August 2026');
    expect(params.get('gl')).toBe('si');
    expect(init.headers).toEqual({ Authorization: 'Bearer searchapi-key' });
    expect(events).toEqual([
      { title: 'Vsi dogodki in prireditve', snippet: 'Letni kino Minoriti · 15. 7. 2026 → 22. 8. 2026' },
      { title: 'Festival Maribor 2026', snippet: 'The festival will open with an inaugural concert on 8 August 2026' },
    ]);
  });

  it('also falls back when the panel body has no events array at all', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(ok({ error: "Google hasn't returned any results for this query." }))
      .mockResolvedValueOnce(ok(SEARCH_BODY));
    vi.stubGlobal('fetch', fn);
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toHaveLength(2);
  });

  it('returns [] on HTTP failure and network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    _clearEventsCache();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SearchApi HTTP 429'));
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

  it('does not cache failures, so a later call retries and can succeed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(ok(PANEL_BODY));
    vi.stubGlobal('fetch', fn);
    expect(await getLiveEvents('Maribor', 'SI', '2026-08-09')).toEqual([]);
    const events = await getLiveEvents('Maribor', 'SI', '2026-08-09');
    expect(events).toHaveLength(2);
    expect(fn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('caches per city and month for 10 minutes, since free requests are finite', async () => {
    const fn = vi.fn().mockResolvedValue(ok(PANEL_BODY));
    vi.stubGlobal('fetch', fn);
    await getLiveEvents('Maribor', 'SI', '2026-08-09');
    await getLiveEvents('Maribor', 'SI', '2026-08-09');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
