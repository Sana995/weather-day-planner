import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';

vi.mock('../src/weather.js', () => ({
  getDailySummary: vi.fn(),
}));
vi.mock('../src/groq.js', () => ({
  streamChat: vi.fn(), streamChatWithTools: vi.fn(), requireGroqKey: vi.fn(), requireGroqBudget: vi.fn(),
}));
vi.mock('../src/places.js', () => ({
  getAttractions: vi.fn().mockResolvedValue({ pois: [], guide: '' }),
  getCityEvents: vi.fn().mockResolvedValue(''),
}));
vi.mock('../src/events.js', () => ({ getLiveEvents: vi.fn().mockResolvedValue([]) }));

import { getDailySummary } from '../src/weather.js';
import { streamChat, streamChatWithTools, requireGroqKey, requireGroqBudget } from '../src/groq.js';
import { getAttractions, getCityEvents } from '../src/places.js';
import { getLiveEvents } from '../src/events.js';
import { HttpError } from '../src/errors.js';

// requireGroqKey stubs must stay test-local even when an assertion throws
// before an in-test cleanup line would have run. Braced body: mockReset()
// returns the mock, and Vitest calls a hook's return value as a cleanup hook.
beforeEach(() => { requireGroqKey.mockReset(); requireGroqBudget.mockReset(); });

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

describe('rate limits', () => {
  // Each createApp() has its own counters, so every test starts fresh.
  const post = (app, path, ip) => {
    const req = request(app).post(path);
    return (ip ? req.set('X-Forwarded-For', ip) : req).send({});
  };

  it('allows 10 /api/recommend requests a minute, then a JSON 429 with Retry-After', async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) expect((await post(app, '/api/recommend')).status).toBe(400);
    const res = await post(app, '/api/recommend');
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toContain('application/json');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.error).toMatch(/Too many requests/);
  });

  it('gives /api/chat its own 10-per-minute budget', async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) await post(app, '/api/recommend');
    for (let i = 0; i < 10; i++) expect((await post(app, '/api/chat')).status).toBe(400);
    expect((await post(app, '/api/chat')).status).toBe(429);
  });

  it('allows 60 /api/weather requests a minute', async () => {
    const app = createApp();
    for (let i = 0; i < 60; i++) {
      expect((await request(app).get('/api/weather?date=2026-08-08')).status).toBe(400);
    }
    expect((await request(app).get('/api/weather?date=2026-08-08')).status).toBe(429);
  });

  it('leaves /api/health unlimited', async () => {
    const app = createApp();
    for (let i = 0; i < 70; i++) await request(app).get('/api/health');
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('counts real clients separately behind a trusted proxy (TRUST_PROXY)', async () => {
    process.env.TRUST_PROXY = '1';
    try {
      const app = createApp();
      for (let i = 0; i < 10; i++) await post(app, '/api/recommend', '203.0.113.1');
      expect((await post(app, '/api/recommend', '203.0.113.1')).status).toBe(429);
      expect((await post(app, '/api/recommend', '203.0.113.2')).status).toBe(400);
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });

  it('ignores X-Forwarded-For without TRUST_PROXY, so a client cannot dodge the limit', async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) await post(app, '/api/recommend', `203.0.113.${i}`);
    expect((await post(app, '/api/recommend', '203.0.113.99')).status).toBe(429);
  });
});

describe('request limits', () => {
  it('answers a body over 160 KB with a JSON 413', async () => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(170 * 1024) }] });
    const res = await request(createApp()).post('/api/chat').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large \(limit 160 KB\)/);
  });

  it('accepts a full chat (20 messages of 2,000 characters) even in 3-byte characters', async () => {
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChatWithTools.mockReturnValue((async function* () { yield { type: 'token', text: 'ok' }; })());
    const content = '雨'.repeat(2000); // 3 bytes each in UTF-8
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content }));
    const res = await request(createApp()).post('/api/chat')
      .send({ context: { city: 'Zagreb', date: '2026-08-08' }, messages });
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: done');
  });

  it('passes other body-parser client errors through, e.g. an unsupported charset as 415', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(createApp())
      .post('/api/recommend').set('Content-Type', 'application/json; charset=latin1').send('{"city":"Zagreb"}');
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/charset/i);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('answers a request with no JSON body with a 400 instead of a 500', async () => {
    const res = await request(createApp()).post('/api/recommend').set('Content-Type', 'text/plain').send('Zagreb');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/city/);
  });

  it('answers broken JSON with a 400 instead of a 500', async () => {
    const res = await request(createApp())
      .post('/api/recommend').set('Content-Type', 'application/json').send('{"city": "Zagreb",');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not valid JSON/);
  });

  it('400s a city over 100 characters on every route, before any lookup', async () => {
    getDailySummary.mockClear();
    const city = 'Z'.repeat(101);
    const weather = await request(createApp()).get(`/api/weather?city=${city}&date=2026-08-08`);
    const recommend = await request(createApp()).post('/api/recommend').send({ city, date: '2026-08-08' });
    const chat = await request(createApp()).post('/api/chat').send({
      context: { city, date: '2026-08-08' }, messages: [{ role: 'user', content: 'hi' }],
    });
    for (const res of [weather, recommend, chat]) {
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/100 characters/);
    }
    expect(getDailySummary).not.toHaveBeenCalled();
  });
});

describe('daily AI budget', () => {
  const limitReached = () => {
    throw new HttpError(429, 'This app has used up its daily AI limit. Please try again tomorrow.');
  };

  it('returns a JSON 429 from /api/recommend before any billable lookup', async () => {
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    getLiveEvents.mockClear();
    getCityEvents.mockClear();
    streamChat.mockClear();
    requireGroqBudget.mockImplementationOnce(limitReached);
    const res = await request(createApp()).post('/api/recommend').send({ city: 'Zagreb', date: '2026-08-08' });
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toMatch(/daily AI limit/);
    expect(getLiveEvents).not.toHaveBeenCalled();
    expect(getCityEvents).not.toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('returns a JSON 429 from /api/chat before streaming', async () => {
    getDailySummary.mockResolvedValue({ city: CITY, day: DAY });
    streamChatWithTools.mockClear();
    requireGroqBudget.mockImplementationOnce(limitReached);
    const res = await request(createApp()).post('/api/chat').send({
      context: { city: 'Zagreb', date: '2026-08-08' }, messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/daily AI limit/);
    expect(streamChatWithTools).not.toHaveBeenCalled();
  });
});
