import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { summarizeDays, getForecast, getDailySummary, _clearCache } from '../src/weather.js';
import { HttpError } from '../src/errors.js';
import { makeForecast } from './fixtures/forecast.js';

describe('summarizeDays', () => {
  const result = summarizeDays(makeForecast());

  it('passes city info through, including coord for the POI lookup', () => {
    expect(result.city).toEqual({
      name: 'Zagreb', country: 'HR', timezone: 7200, coord: { lat: 45.81, lon: 15.98 },
    });
  });

  it('buckets entries into LOCAL dates using the timezone offset', () => {
    expect(result.days.map((d) => d.date)).toEqual(['2026-08-07', '2026-08-08']);
    // 23:00 UTC entry lands on Aug 8 local, giving Aug 8 three entries
    expect(result.days[0].entries).toHaveLength(3);
    expect(result.days[1].entries).toHaveLength(3);
    expect(result.days[1].entries[0].time).toBe('01:00');
  });

  it('computes min/max temp, max pop as percent, max wind', () => {
    const day1 = result.days[0];
    expect(day1.tempMin).toBe(22.4);
    expect(day1.tempMax).toBe(27.8);
    expect(day1.pop).toBe(10);
    expect(day1.windMax).toBe(4.7);
  });

  it('picks the most frequent condition as dominant', () => {
    expect(result.days[0].condition).toBe('Clear');
    expect(result.days[1].condition).toBe('Rain');
    expect(result.days[1].pop).toBe(90);
  });
});

describe('summarizeDays - temperature rounding', () => {
  it('rounds temps to 1 decimal place', () => {
    const forecast = {
      city: {
        name: 'Test', country: 'XX', timezone: 0, coord: { lat: 0, lon: 0 },
      },
      list: [
        {
          dt: 1000000000,
          main: { temp: 24.34 },
          weather: [{ main: 'Clear', description: 'clear' }],
          pop: 0,
          wind: { speed: 1 },
        },
      ],
    };
    const result = summarizeDays(forecast);
    expect(result.days[0].tempMin).toBe(24.3);
    expect(result.days[0].tempMax).toBe(24.3);
    expect(result.days[0].entries[0].temp).toBe(24.3);
  });
});

function stubFetchOnce(status, jsonBody) {
  const fn = vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => jsonBody });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('getForecast', () => {
  beforeEach(() => {
    _clearCache();
    process.env.OPENWEATHER_API_KEY = 'test-key';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches, summarizes, and caches per city', async () => {
    const fn = stubFetchOnce(200, makeForecast());
    const first = await getForecast('Zagreb');
    const second = await getForecast('  zagreb '); // trim+case-insensitive cache hit
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toContain('q=Zagreb');
    expect(fn.mock.calls[0][0]).toContain('units=metric');
    expect(fn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(first.days).toHaveLength(2);
    expect(second).toBe(first);
  });

  it('maps OWM 404 to HttpError 404 City not found', async () => {
    stubFetchOnce(404, { message: 'city not found' });
    await expect(getForecast('Xyzzyville')).rejects.toMatchObject({ status: 404, message: 'City not found' });
  });

  it('maps OWM 401 to HttpError 502 naming the env var', async () => {
    stubFetchOnce(401, { message: 'invalid key' });
    await expect(getForecast('Zagreb')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('OPENWEATHER_API_KEY') });
  });

  it('fails fast with 502 when the key is unset', async () => {
    delete process.env.OPENWEATHER_API_KEY;
    await expect(getForecast('Zagreb')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('OPENWEATHER_API_KEY') });
  });

  it('maps OWM 429 to HttpError 429', async () => {
    stubFetchOnce(429, { message: 'rate limit exceeded' });
    await expect(getForecast('Zagreb')).rejects.toMatchObject({ status: 429 });
  });

  it('maps OWM 500 to HttpError 502', async () => {
    stubFetchOnce(500, { message: 'server error' });
    await expect(getForecast('Zagreb')).rejects.toMatchObject({ status: 502 });
  });

  it('keeps the name the user typed, not the OWM-resolved station name', async () => {
    const resolved = makeForecast();
    resolved.city.name = 'Donji grad'; // OWM resolves "Zagreb" to a district station
    stubFetchOnce(200, resolved);
    const { city } = await getForecast('  Zagreb ');
    expect(city.name).toBe('Zagreb');
  });

  it('respects 10-minute cache TTL', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => makeForecast() });
      vi.stubGlobal('fetch', fn);

      const first = await getForecast('Zagreb');
      expect(fn).toHaveBeenCalledTimes(1);

      // Cache hit before expiry
      const beforeExpiry = await getForecast('Zagreb');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(beforeExpiry).toBe(first);

      // Advance time past TTL (10 minutes + 1 ms)
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      // Cache miss after expiry — same mock serves both calls
      const afterExpiry = await getForecast('Zagreb');
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getDailySummary', () => {
  beforeEach(() => {
    _clearCache();
    process.env.OPENWEATHER_API_KEY = 'test-key';
    stubFetchOnce(200, makeForecast());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns the requested day', async () => {
    const { city, day } = await getDailySummary('Zagreb', '2026-08-08');
    expect(city.name).toBe('Zagreb');
    expect(day.date).toBe('2026-08-08');
    expect(day.condition).toBe('Rain');
  });

  it('404s for a date outside the forecast window', async () => {
    await expect(getDailySummary('Zagreb', '2026-08-20'))
      .rejects.toMatchObject({ status: 404, message: expect.stringContaining('2026-08-20') });
  });

  it('labels today and stamps the current city-local time', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-07T10:00:00Z')); // 12:00 local (UTC+2)
      const { day } = await getDailySummary('Zagreb', '2026-08-07');
      expect(day.when).toBe('today');
      expect(day.now).toBe('12:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels tomorrow without a local time', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-07T10:00:00Z'));
      const { day } = await getDailySummary('Zagreb', '2026-08-08');
      expect(day.when).toBe('tomorrow');
      expect(day.now).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels later days by weekday', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-05T10:00:00Z')); // two days before the fixture's Aug 7
      const { day } = await getDailySummary('Zagreb', '2026-08-07'); // a Friday
      expect(day.when).toBe('on Friday');
      expect(day.now).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
