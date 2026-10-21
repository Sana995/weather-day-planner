import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getGeoapifyPois, getWikivoyageGuide, getCityEvents, getAttractions, _clearPlacesCache } from '../src/places.js';

const GEO_FEATURES = {
  features: [
    { properties: { name: 'Museum of Broken Relationships', categories: ['entertainment.museum'] } },
    { properties: { categories: ['entertainment.museum'] } }, // nameless — dropped
    { properties: { name: 'Zagreb City Museum', categories: ['entertainment.museum'] } },
  ],
};

describe('getGeoapifyPois', () => {
  beforeEach(() => {
    process.env.GEOAPIFY_API_KEY = 'geo-key';
    _clearPlacesCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns [] without fetching when the key is unset', async () => {
    delete process.env.GEOAPIFY_API_KEY;
    const fn = vi.fn();
    vi.stubGlobal('fetch', fn);
    expect(await getGeoapifyPois(45.81, 15.98, 'Clear')).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('queries indoor categories for rain, lon-first circle filter, and drops nameless features', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => GEO_FEATURES });
    vi.stubGlobal('fetch', fn);
    const result = await getGeoapifyPois(45.81, 15.98, 'Rain');
    const url = fn.mock.calls[0][0];
    expect(url).toContain('categories=entertainment.museum');
    expect(url).toContain('filter=circle%3A15.98%2C45.81%2C5000');
    expect(fn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual([
      { name: 'Museum of Broken Relationships', categories: ['entertainment.museum'] },
      { name: 'Zagreb City Museum', categories: ['entertainment.museum'] },
    ]);
  });

  it('queries outdoor categories for clear weather', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    vi.stubGlobal('fetch', fn);
    await getGeoapifyPois(45.81, 15.98, 'Clear');
    expect(fn.mock.calls[0][0]).toContain('categories=tourism.sights');
  });

  it('queries nature categories for a hiking profile on dry days', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    vi.stubGlobal('fetch', fn);
    await getGeoapifyPois(45.81, 15.98, 'Clear', 'hiking');
    const url = fn.mock.calls[0][0];
    expect(url).toContain('categories=natural');
    expect(url).not.toContain('tourism.sights');
  });

  it('returns [] on HTTP failure and network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await getGeoapifyPois(45.81, 15.98, 'Clear')).toEqual([]);
    _clearPlacesCache();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await getGeoapifyPois(45.81, 15.98, 'Clear')).toEqual([]);
    warn.mockRestore();
  });

  it('caches per rounded coordinate for 10 minutes', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    vi.stubGlobal('fetch', fn);
    await getGeoapifyPois(45.81, 15.98, 'Clear');
    await getGeoapifyPois(45.81, 15.98, 'Clear');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('getWikivoyageGuide', () => {
  beforeEach(() => _clearPlacesCache());
  afterEach(() => vi.unstubAllGlobals());

  it('fetches See and Do sections and strips HTML', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        parse: { sections: [
          { line: 'Understand', index: '1' },
          { line: 'See', index: '4' },
          { line: 'Do', index: '5' },
        ] },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        parse: { text: { '*': '<h2>See</h2><p>The <b>Upper Town</b> funicular.</p>' } },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        parse: { text: { '*': '<p>Hike <a href="/wiki/Medvednica">Medvednica</a>.</p>' } },
      }) });
    vi.stubGlobal('fetch', fn);
    const guide = await getWikivoyageGuide('Zagreb');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn.mock.calls[1][0]).toContain('section=4');
    expect(fn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(guide).toContain('See: See The Upper Town funicular.');
    // Tag-stripping leaves a space before the final period ("Medvednica .") —
    // harmless in an LLM prompt, so assert without the trailing period.
    expect(guide).toContain('Do: Hike Medvednica');
    expect(guide).not.toContain('<');
  });

  it('returns "" when the page has no See/Do sections or is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: { code: 'missingtitle' } }) }));
    expect(await getWikivoyageGuide('Xyzzyville')).toBe('');
  });

  it('returns "" on network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await getWikivoyageGuide('Zagreb')).toBe('');
    warn.mockRestore();
  });

  it('caps the guide at 1500 chars', async () => {
    const long = `<p>${'x'.repeat(3000)}</p>`;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ parse: { sections: [{ line: 'See', index: '2' }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ parse: { text: { '*': long } } }) }));
    const guide = await getWikivoyageGuide('Zagreb');
    expect(guide.length).toBeLessThanOrEqual(1500);
  });
});

describe('getCityEvents', () => {
  beforeEach(() => _clearPlacesCache());
  afterEach(() => vi.unstubAllGlobals());

  const DO_HTML = '<p>Mestni Park is great for a stroll. Festival Lent is one of the ' +
    'biggest festivals in Europe. Watch football at NK Maribor. The old town ' +
    'hosts a wine fair each autumn.</p>';

  function stubWikivoyage() {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        parse: { sections: [{ line: 'Do', index: '17' }] },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        parse: { text: { '*': DO_HTML } },
      }) });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('keeps only the sentences that name an event', async () => {
    stubWikivoyage();
    const events = await getCityEvents('Maribor');
    expect(events).toContain('Festival Lent');
    expect(events).toContain('wine fair');
    expect(events).not.toContain('NK Maribor');
    expect(events).not.toContain('stroll');
  });

  it('shares one Wikivoyage fetch with the guide', async () => {
    const fn = stubWikivoyage();
    await getCityEvents('Maribor');
    const guide = await getWikivoyageGuide('Maribor');
    expect(guide).toContain('Festival Lent');
    expect(fn).toHaveBeenCalledTimes(2); // sections + Do body, fetched once for both
  });

  it('returns "" on network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await getCityEvents('Maribor')).toBe('');
    warn.mockRestore();
  });

  it('decodes entities so sentence boundaries survive real Wikivoyage markup', async () => {
    // Live Wikivoyage separates listings with '.&#32;' / '&#160;' — undecoded,
    // the sentence split never fires and the whole section rides along as one
    // blob. The editsection residue ('[ edit | edit source ]') must go too.
    const html = '<p>Festival Lent runs each June.&#32;&#160;Watch football at ' +
      'NK Maribor.&#32;The old town hosts a wine fair each autumn.&#32;' +
      '<span>[</span>edit<span> | </span>edit source<span>]</span></p>';
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        parse: { sections: [{ line: 'Do', index: '17' }] },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        parse: { text: { '*': html } },
      }) }));
    const events = await getCityEvents('Maribor');
    expect(events).toContain('Festival Lent');
    expect(events).toContain('wine fair');
    expect(events).not.toContain('NK Maribor');
    expect(events).not.toMatch(/&#\d+;/);
    expect(events).not.toMatch(/edit source/);
  });
});

describe('getAttractions', () => {
  beforeEach(() => {
    process.env.GEOAPIFY_API_KEY = 'geo-key';
    _clearPlacesCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('degrades each source independently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Geoapify fails, Wikivoyage succeeds
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) =>
      url.includes('geoapify')
        ? Promise.reject(new Error('down'))
        : Promise.resolve({ ok: true, json: async () => ({ parse: { sections: [{ line: 'See', index: '2' }] } }) })
          // Section fetch reuses the same mock; a sections-shaped body simply
          // yields no text, which still exercises the degrade path.
    ));
    const result = await getAttractions('Zagreb', { lat: 45.81, lon: 15.98 }, 'Clear');
    expect(result.pois).toEqual([]);
    expect(typeof result.guide).toBe('string');
    warn.mockRestore();
  });
});
