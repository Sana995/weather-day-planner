import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/weather.js', () => ({
  getDailySummary: vi.fn(),
  getForecast: vi.fn(),
}));

vi.mock('../src/places.js', () => ({ getAttractions: vi.fn(), getCityEvents: vi.fn() }));
vi.mock('../src/events.js', () => ({ getLiveEvents: vi.fn() }));

import { CHAT_TOOLS, createToolExecutor, toolLabel } from '../src/chatTools.js';
import { getDailySummary, getForecast } from '../src/weather.js';
import { getAttractions, getCityEvents } from '../src/places.js';
import { getLiveEvents } from '../src/events.js';
import { HttpError } from '../src/errors.js';

const CTX = { city: 'Zagreb', date: '2026-08-08', activity: 'hiking' };
const DAY = {
  date: '2026-08-08', tempMin: 16.9, tempMax: 19.5, condition: 'Rain',
  description: 'moderate rain', pop: 90, windMax: 6,
  entries: [{ time: '09:00', temp: 17, condition: 'Rain', description: 'rain', pop: 0.9, wind: 5 }],
};

describe('CHAT_TOOLS', () => {
  it('declares get_weather with city required', () => {
    const tool = CHAT_TOOLS.find((t) => t.function.name === 'get_weather');
    expect(tool.type).toBe('function');
    expect(tool.function.parameters.required).toEqual(['city']);
  });
});

describe('createToolExecutor · get_weather', () => {
  beforeEach(() => { getDailySummary.mockReset(); });

  it('returns a compact JSON summary without hourly entries', async () => {
    getDailySummary.mockResolvedValue({ city: { name: 'Samobor', country: 'HR' }, day: DAY });
    const result = await createToolExecutor(CTX)('get_weather', { city: 'Žumberak', date: '2026-08-08' });
    const parsed = JSON.parse(result);
    expect(getDailySummary).toHaveBeenCalledWith('Žumberak', '2026-08-08');
    expect(parsed).toMatchObject({ city: 'Samobor, HR', tempMax: 19.5, condition: 'Rain' });
    expect(parsed.entries).toBeUndefined();
  });

  it('falls back to the context city/date when args omit them', async () => {
    getDailySummary.mockResolvedValue({ city: { name: 'Zagreb', country: 'HR' }, day: DAY });
    await createToolExecutor(CTX)('get_weather', {});
    expect(getDailySummary).toHaveBeenCalledWith('Zagreb', '2026-08-08');
  });

  it('returns the error message as a string instead of throwing', async () => {
    getDailySummary.mockRejectedValue(new HttpError(404, 'No forecast available for 2026-08-20.'));
    const result = await createToolExecutor(CTX)('get_weather', { city: 'Zagreb', date: '2026-08-20' });
    expect(result).toMatch(/No forecast available/);
  });

  it('reports unknown tool names as a string', async () => {
    expect(await createToolExecutor(CTX)('launch_rocket', {})).toMatch(/Unknown tool/);
  });
});

describe('createToolExecutor · get_attractions', () => {
  beforeEach(() => {
    getForecast.mockReset();
    getAttractions.mockReset();
    getCityEvents.mockReset();
    getCityEvents.mockResolvedValue('');
    getLiveEvents.mockReset();
    getLiveEvents.mockResolvedValue([]);
  });

  it('geocodes via the forecast and returns POI names, the guide, and events', async () => {
    getForecast.mockResolvedValue({
      city: { name: 'Samobor', country: 'HR', coord: { lat: 45.8, lon: 15.71 } },
      days: [{ date: '2026-08-07', condition: 'Clear' }],
    });
    getAttractions.mockResolvedValue({
      pois: [{ name: 'Samobor Castle', categories: ['tourism.sights'] }],
      guide: 'See: The old town square.',
    });
    getCityEvents.mockResolvedValue('The Samobor Carnival draws big crowds.');
    getLiveEvents.mockResolvedValue([{ title: 'Wine fair', when: 'Sat', venue: 'Old town' }]);
    const result = await createToolExecutor(CTX)('get_attractions', { city: 'Samobor' });
    expect(getAttractions).toHaveBeenCalledWith('Samobor', { lat: 45.8, lon: 15.71 }, 'Clear', 'hiking');
    expect(getLiveEvents).toHaveBeenCalledWith('Samobor', 'HR', '2026-08-08');
    expect(JSON.parse(result)).toEqual({
      pois: ['Samobor Castle'],
      guide: 'See: The old town square.',
      events: 'The Samobor Carnival draws big crowds.',
      liveEvents: [{ title: 'Wine fair', when: 'Sat', venue: 'Old town' }],
    });
  });

  it('returns the error message as a string when the city is unknown', async () => {
    getForecast.mockRejectedValue(new HttpError(404, 'City not found'));
    const result = await createToolExecutor(CTX)('get_attractions', { city: 'Xyzzyville' });
    expect(result).toMatch(/City not found/);
  });

  it('declares get_attractions in CHAT_TOOLS', () => {
    const tool = CHAT_TOOLS.find((t) => t.function.name === 'get_attractions');
    expect(tool.function.parameters.required).toEqual(['city']);
  });
});

describe('toolLabel', () => {
  it('labels weather lookups with the place name', () => {
    expect(toolLabel('get_weather', { city: 'Žumberak' })).toBe('Sunny is checking the forecast for Žumberak…');
  });
  it('falls back gracefully with no city', () => {
    expect(toolLabel('get_weather', {})).toMatch(/forecast/);
  });
});
