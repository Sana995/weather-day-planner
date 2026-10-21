import { describe, it, expect, vi, afterEach } from 'vitest';
import { getWeather, createSseParser, streamLlm, buildChatRequestMessages } from '../api.js';

afterEach(() => vi.unstubAllGlobals());

describe('getWeather', () => {
  it('fetches and returns the summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ city: { name: 'Zagreb' }, day: { date: '2026-08-08' } }),
    }));
    const data = await getWeather('Zagreb', '2026-08-08');
    expect(fetch).toHaveBeenCalledWith('/api/weather?city=Zagreb&date=2026-08-08');
    expect(data.city.name).toBe('Zagreb');
  });

  it('URL-encodes the city', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await getWeather('New York', '2026-08-08');
    expect(fetch).toHaveBeenCalledWith('/api/weather?city=New%20York&date=2026-08-08');
  });

  it('throws the server error message on non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({ error: 'City not found' }),
    }));
    await expect(getWeather('Xyzzyville', '2026-08-08')).rejects.toThrow('City not found');
  });
});

describe('createSseParser', () => {
  it('parses complete events and dispatches by type', () => {
    const onToken = vi.fn(); const onDone = vi.fn();
    const feed = createSseParser({ onToken, onDone });
    feed('event: token\ndata: {"text":"Hello"}\n\nevent: done\ndata: {}\n\n');
    expect(onToken).toHaveBeenCalledWith('Hello');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('buffers events split across chunks', () => {
    const onToken = vi.fn();
    const feed = createSseParser({ onToken });
    feed('event: tok');
    feed('en\ndata: {"text":"Hel');
    feed('lo"}\n\n');
    expect(onToken).toHaveBeenCalledWith('Hello');
  });

  it('dispatches error events as Error objects', () => {
    const onError = vi.fn();
    const feed = createSseParser({ onError });
    feed('event: error\ndata: {"error":"The AI stream failed — please try again."}\n\n');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('AI stream failed') }));
  });

  it('recovers from malformed JSON and processes subsequent events', () => {
    const onToken = vi.fn(); const onError = vi.fn();
    const feed = createSseParser({ onToken, onError });
    feed('event: token\ndata: {broken\n\nevent: token\ndata: {"text":"Hello"}\n\n');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/malformed/i) }));
    expect(onToken).toHaveBeenCalledWith('Hello');
  });

  it('routes tool events to onTool', () => {
    const onTool = vi.fn();
    const feed = createSseParser({ onTool });
    feed('event: tool\ndata: {"name":"get_weather","label":"Checking the forecast for Žumberak…"}\n\n');
    expect(onTool).toHaveBeenCalledWith({ name: 'get_weather', label: 'Checking the forecast for Žumberak…' });
  });
});

describe('buildChatRequestMessages', () => {
  it('truncates an over-long seed to exactly 2000 chars and keeps it first with role assistant', () => {
    const seed = 'x'.repeat(2500);
    const result = buildChatRequestMessages(seed, [{ role: 'user', content: 'hi' }]);
    expect(result[0]).toEqual({ role: 'assistant', content: 'x'.repeat(2000) });
    expect(result[0].content).toHaveLength(2000);
  });

  it('windows a 25-turn history to the most recent 19 with the seed prepended', () => {
    const history = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` }));
    const result = buildChatRequestMessages('Try Sljeme.', history);
    expect(result).toHaveLength(20);
    expect(result[0]).toEqual({ role: 'assistant', content: 'Try Sljeme.' });
    expect(result[result.length - 1]).toEqual({ role: 'user', content: 'turn 24' });
    expect(result.slice(1)).toEqual(history.slice(-19));
  });

  it('passes a short history through intact', () => {
    const history = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'reply' }];
    const result = buildChatRequestMessages('Try Sljeme.', history);
    expect(result).toEqual([
      { role: 'assistant', content: 'Try Sljeme.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });
});

describe('streamLlm', () => {
  function sseResponse(...chunks) {
    const encoder = new TextEncoder();
    let i = 0;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => (i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined }),
        }),
      },
    };
  }

  it('POSTs JSON and feeds tokens to the handler', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(
      'event: token\ndata: {"text":"Wear"}\n\n',
      'event: token\ndata: {"text":" layers"}\n\nevent: done\ndata: {}\n\n',
    )));
    const onToken = vi.fn(); const onDone = vi.fn();
    await streamLlm('/api/recommend', { city: 'Zagreb' }, { onToken, onDone });
    expect(fetch).toHaveBeenCalledWith('/api/recommend', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: 'Zagreb' }),
    }));
    expect(onToken.mock.calls.map(([t]) => t)).toEqual(['Wear', ' layers']);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('throws the server error message when the POST is rejected pre-stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'date must be YYYY-MM-DD, got "tomorrow"' }),
    }));
    await expect(streamLlm('/api/recommend', {}, {})).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('reassembles multi-byte UTF-8 characters split across chunks (decoder stream:true)', async () => {
    // This test protects the {stream:true} flag in TextDecoder.decode(). Without it,
    // multi-byte chars split across chunks would break. The final flush line in streamLlm
    // is defensive and unobservable via SSE framing (incomplete UTF-8 bytes can't form \n\n).
    const encoder = new TextEncoder();
    const fullText = 'event: token\ndata: {"text":"a—b"}\n\nevent: done\ndata: {}\n\n';
    const fullBytes = encoder.encode(fullText);
    // The em-dash (—) is a 3-byte UTF-8 character. Find it and split the bytes there.
    const dashIndex = fullText.indexOf('—');
    const dashByteStart = encoder.encode(fullText.substring(0, dashIndex)).length;
    const dashByteEnd = dashByteStart + 3;
    // Split so the em-dash bytes are split: one chunk ends mid-dash, next starts mid-dash
    const chunk1 = fullBytes.slice(0, dashByteStart + 1);
    const chunk2 = fullBytes.slice(dashByteStart + 1, dashByteEnd);
    const chunk3 = fullBytes.slice(dashByteEnd);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let i = 0;
          const chunks = [chunk1, chunk2, chunk3];
          return {
            read: async () => (i < chunks.length
              ? { done: false, value: chunks[i++] }
              : { done: true, value: undefined }),
          };
        },
      },
    }));

    const onToken = vi.fn(); const onDone = vi.fn();
    await streamLlm('/api/recommend', {}, { onToken, onDone });
    expect(onToken).toHaveBeenCalledWith('a—b');
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
