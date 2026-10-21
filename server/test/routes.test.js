import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';

vi.mock('../src/weather.js', () => ({
  getDailySummary: vi.fn(),
}));
vi.mock('../src/groq.js', () => ({ streamChat: vi.fn(), streamChatWithTools: vi.fn(), requireGroqKey: vi.fn() }));
vi.mock('../src/places.js', () => ({
  getAttractions: vi.fn().mockResolvedValue({ pois: [], guide: '' }),
  getCityEvents: vi.fn().mockResolvedValue(''),
}));
vi.mock('../src/events.js', () => ({ getLiveEvents: vi.fn().mockResolvedValue([]) }));

import { getDailySummary } from '../src/weather.js';
import { streamChat, streamChatWithTools, requireGroqKey } from '../src/groq.js';
import { getAttractions, getCityEvents } from '../src/places.js';
import { getLiveEvents } from '../src/events.js';
import { HttpError } from '../src/errors.js';

// requireGroqKey stubs must stay test-local even when an assertion throws
// before an in-test cleanup line would have run. Braced body: mockReset()
// returns the mock, and Vitest calls a hook's return value as a cleanup hook.
beforeEach(() => { requireGroqKey.mockReset(); });

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/weather', () => {
  it('returns the daily summary', async () => {
    getDailySummary.mockResolvedValue({
      city: { name: 'Zagreb', country: 'HR' },
      day: { date: '2026-08-08', tempMin: 16.9, tempMax: 19.5, condition: 'Rain' },
    });
    const res = await request(createApp()).get('/api/weather?city=Zagreb&date=2026-08-08');
    expect(res.status).toBe(200);
    expect(res.body.day.condition).toBe('Rain');
    expect(getDailySummary).toHaveBeenCalledWith('Zagreb', '2026-08-08');
  });

  it('400s on a malformed date without calling the service', async () => {
    getDailySummary.mockClear();
    const res = await request(createApp()).get('/api/weather?city=Zagreb&date=tomorrow');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/);
    expect(getDailySummary).not.toHaveBeenCalled();
  });

  it('400s when city is missing', async () => {
    const res = await request(createApp()).get('/api/weather?date=2026-08-08');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/city/i);
  });

  it('400s when city is a repeated query param (array) instead of a string', async () => {
    getDailySummary.mockClear();
    const res = await request(createApp()).get('/api/weather?city=a&city=b&date=2026-08-08');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/city/i);
    expect(getDailySummary).not.toHaveBeenCalled();
  });

  it('propagates HttpError status and message', async () => {
    getDailySummary.mockRejectedValue(new HttpError(404, 'City not found'));
    const res = await request(createApp()).get('/api/weather?city=Xyzzyville&date=2026-08-08');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'City not found' });
  });
});

const CITY = { name: 'Zagreb', country: 'HR', coord: { lat: 45.81, lon: 15.98 } };
const DAY = {
  date: '2026-08-08', tempMin: 16.9, tempMax: 19.5, condition: 'Rain',
  description: 'moderate rain', pop: 90, windMax: 6, entries: [],
};

describe('POST /api/recommend', () => {
  it('streams token events followed by done', async () => {
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChat.mockReturnValue((async function* () { yield 'Wear'; yield ' a raincoat'; })());
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08', profile: { activity: 'tourism' } });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: token\ndata: {"text":"Wear"}');
    expect(res.text).toContain('event: token\ndata: {"text":" a raincoat"}');
    expect(res.text).toContain('event: done');
  });

  it('returns plain JSON 400 when city is not a string (e.g. a number)', async () => {
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 123, date: '2026-08-08', profile: { activity: 'tourism' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/city/i);
  });

  it('returns plain JSON 400 for a bad profile before streaming', async () => {
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08', profile: { activity: 'skydiving' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/activity/);
  });

  it('returns plain JSON 404 when the day is missing', async () => {
    getDailySummary.mockRejectedValue(new HttpError(404, 'No forecast available for 2026-08-20. Forecasts cover today through +5 days.'));
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-20' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No forecast/);
  });

  it('returns plain JSON 502 before streaming when the Groq key is missing', async () => {
    streamChat.mockClear();
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    requireGroqKey.mockImplementationOnce(() => {
      throw new HttpError(502, 'GROQ_API_KEY is not set — copy .env.example to .env and add your key');
    });
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08' });
    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toMatch(/GROQ_API_KEY/);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('a bogus city keeps its 404 even when the Groq key is also missing', async () => {
    getDailySummary.mockRejectedValue(new HttpError(404, 'City not found'));
    requireGroqKey.mockImplementation(() => {
      throw new HttpError(502, 'GROQ_API_KEY is not set — copy .env.example to .env and add your key');
    });
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 'Xyzzyville', date: '2026-08-08' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/City not found/);
  });

  it('propagates a failure before the first token as plain JSON, not an SSE event', async () => {
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChat.mockReturnValue((async function* () {
      throw new HttpError(502, 'Groq rejected the API key');
    })());
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08' });
    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toMatch(/Groq rejected/);
  });

  it('reports a curated HttpError message in the mid-stream error event', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChat.mockReturnValue((async function* () {
      yield 'Wear';
      throw new HttpError(502, 'The answer hit its length limit and was cut short — please try again.');
    })());
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08' });
    expect(res.text).toContain('event: token\ndata: {"text":"Wear"}');
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('length limit');
    consoleErrorSpy.mockRestore();
  });

  it('emits an error event when the stream fails mid-flight', async () => {
    // The route intentionally console.errors mid-stream failures for server-side
    // visibility; silence that expected stack trace so it doesn't pollute test output.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChat.mockReturnValue((async function* () {
      yield 'Wear';
      throw new Error('groq exploded');
    })());
    const res = await request(createApp())
      .post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08' });
    expect(res.text).toContain('event: token\ndata: {"text":"Wear"}');
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('The AI stream failed');
    consoleErrorSpy.mockRestore();
  });

  it('fetches attractions only when traveling is true', async () => {
    getAttractions.mockClear();
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChat.mockReturnValue((async function* () { yield 'ok'; })());

    await request(createApp()).post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08', traveling: true });
    expect(getAttractions).toHaveBeenCalledWith('Zagreb', CITY.coord, 'Rain', 'everyday');

    getAttractions.mockClear();
    await request(createApp()).post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08' });
    expect(getAttractions).not.toHaveBeenCalled();
  });

  it('fetches attractions when traveling even with activity ideas off, but never events', async () => {
    getAttractions.mockClear();
    getCityEvents.mockClear();
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChat.mockReturnValue((async function* () { yield 'ok'; })());
    await request(createApp()).post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08', traveling: true, includeActivities: false });
    expect(getAttractions).toHaveBeenCalledWith('Zagreb', CITY.coord, 'Rain', 'everyday');
    expect(getCityEvents).not.toHaveBeenCalled();
  });

  it('fetches city events whenever activities are on, without the attractions flag', async () => {
    getCityEvents.mockClear();
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChat.mockReturnValue((async function* () { yield 'ok'; })());
    await request(createApp()).post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08' });
    expect(getCityEvents).toHaveBeenCalledWith('Zagreb');
    expect(getLiveEvents).toHaveBeenCalledWith('Zagreb', 'HR', '2026-08-08');

    getCityEvents.mockClear();
    await request(createApp()).post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08', includeActivities: false });
    expect(getCityEvents).not.toHaveBeenCalled();
  });

  it('400s on a non-boolean includeActivities flag', async () => {
    const res = await request(createApp()).post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08', includeActivities: 'no' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/includeActivities/);
  });

  it('400s on a non-boolean traveling flag', async () => {
    const res = await request(createApp()).post('/api/recommend')
      .send({ city: 'Zagreb', date: '2026-08-08', traveling: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/);
  });
});

describe('POST /api/chat', () => {
  const CHAT_BODY = {
    context: { city: 'Zagreb', date: '2026-08-08', profile: { activity: 'hiking' } },
    messages: [
      { role: 'assistant', content: 'Try Sljeme.' },
      { role: 'user', content: '1.5h driving is also okay' },
    ],
  };

  it('streams token and tool events followed by done', async () => {
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChatWithTools.mockReturnValue((async function* () {
      yield { type: 'tool', name: 'get_weather', args: { city: 'Žumberak' } };
      yield { type: 'token', text: 'Žumberak works' };
    })());
    const res = await request(createApp()).post('/api/chat').send(CHAT_BODY);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: tool\ndata: {"name":"get_weather","label":"Sunny is checking the forecast for Žumberak…"}');
    expect(res.text).toContain('event: token\ndata: {"text":"Žumberak works"}');
    expect(res.text).toContain('event: done');
  });

  it('400s when the history is empty', async () => {
    const res = await request(createApp()).post('/api/chat')
      .send({ ...CHAT_BODY, messages: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/);
  });

  it('400s when the last message is not from the user', async () => {
    const res = await request(createApp()).post('/api/chat')
      .send({ ...CHAT_BODY, messages: [{ role: 'assistant', content: 'hi' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last message/i);
  });

  it('400s on a non-boolean traveling flag in context', async () => {
    const res = await request(createApp()).post('/api/chat')
      .send({ ...CHAT_BODY, context: { ...CHAT_BODY.context, traveling: 'yes' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/);
  });

  it('400s on a malformed context date before streaming', async () => {
    streamChatWithTools.mockClear();
    const res = await request(createApp()).post('/api/chat')
      .send({ ...CHAT_BODY, context: { ...CHAT_BODY.context, date: 'tomorrow' } });
    expect(res.status).toBe(400);
    expect(streamChatWithTools).not.toHaveBeenCalled();
  });

  it('returns plain JSON 502 before streaming when the Groq key is missing', async () => {
    streamChatWithTools.mockClear();
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    requireGroqKey.mockImplementationOnce(() => {
      throw new HttpError(502, 'GROQ_API_KEY is not set — copy .env.example to .env and add your key');
    });
    const res = await request(createApp()).post('/api/chat').send(CHAT_BODY);
    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toMatch(/GROQ_API_KEY/);
    expect(streamChatWithTools).not.toHaveBeenCalled();
  });

  it('propagates a failure before the first event as plain JSON, not an SSE event', async () => {
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChatWithTools.mockReturnValue((async function* () {
      throw new HttpError(502, 'Groq rejected the API key');
    })());
    const res = await request(createApp()).post('/api/chat').send(CHAT_BODY);
    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toMatch(/Groq rejected/);
  });

  it('emits an error event when the tool loop fails mid-stream', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChatWithTools.mockReturnValue((async function* () {
      yield { type: 'token', text: 'Žum' };
      throw new Error('groq exploded');
    })());
    const res = await request(createApp()).post('/api/chat').send(CHAT_BODY);
    expect(res.text).toContain('event: token\ndata: {"text":"Žum"}');
    expect(res.text).toContain('event: error');
    consoleErrorSpy.mockRestore();
  });
});
