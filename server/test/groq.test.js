import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('groq-sdk', () => ({
  default: class Groq {
    constructor() { this.chat = { completions: { create: createMock } }; }
  },
}));

import { streamChat, streamChatWithTools } from '../src/groq.js';
import { HttpError } from '../src/errors.js';

function chunk(text) {
  return { choices: [{ delta: { content: text } }] };
}

describe('streamChat', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.GROQ_API_KEY = 'gsk-test';
    delete process.env.GROQ_MODEL;
  });

  it('yields token strings from the SDK stream', async () => {
    createMock.mockResolvedValue((async function* () {
      yield chunk('Hello');
      yield { choices: [{ delta: {} }] }; // role-only chunk — must be skipped
      yield chunk(' world');
    })());
    const tokens = [];
    for await (const t of streamChat([{ role: 'user', content: 'hi' }])) tokens.push(t);
    expect(tokens).toEqual(['Hello', ' world']);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'llama-3.3-70b-versatile', stream: true,
      max_tokens: expect.any(Number),
      messages: [{ role: 'user', content: 'hi' }],
    }));
  });

  it('honors GROQ_MODEL override', async () => {
    process.env.GROQ_MODEL = 'llama-3.1-8b-instant';
    createMock.mockResolvedValue((async function* () {})());
    for await (const _ of streamChat([])) { /* drain */ }
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'llama-3.1-8b-instant' }));
  });

  it('throws HttpError 502 before any call when GROQ_API_KEY is unset', async () => {
    delete process.env.GROQ_API_KEY;
    await expect(async () => {
      for await (const _ of streamChat([])) { /* drain */ }
    }).rejects.toMatchObject({ status: 502, message: expect.stringContaining('GROQ_API_KEY') });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('surfaces a length-truncated stream as an error after the streamed tokens', async () => {
    createMock.mockResolvedValue((async function* () {
      yield chunk('Wear layers and');
      yield { choices: [{ delta: {}, finish_reason: 'length' }] };
    })());
    const tokens = [];
    await expect(async () => {
      for await (const t of streamChat([{ role: 'user', content: 'hi' }])) tokens.push(t);
    }).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/length limit/) });
    expect(tokens).toEqual(['Wear layers and']);
  });
});

// Duck-typed groq-sdk errors: the SDK module is fully mocked, so tests shape
// errors the way the real APIError instances look (.status, .headers, .name).
const groqError = (status, extra = {}) =>
  Object.assign(new Error(`groq ${status ?? 'connection'} error`), { status, ...extra });

describe('streamChat · Groq error translation and retry', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.GROQ_API_KEY = 'gsk-test';
    delete process.env.GROQ_MODEL;
  });

  const drain = async () => {
    const tokens = [];
    for await (const t of streamChat([{ role: 'user', content: 'hi' }])) tokens.push(t);
    return tokens;
  };

  it('retries a 429 honouring Retry-After, then succeeds', async () => {
    createMock
      .mockRejectedValueOnce(groqError(429, { headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce((async function* () { yield chunk('ok'); })());
    expect(await drain()).toEqual(['ok']);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a curated 429 after exhausting retries', async () => {
    createMock.mockRejectedValue(groqError(429, { headers: { 'retry-after': '0' } }));
    await expect(drain()).rejects.toMatchObject({
      status: 429, message: expect.stringMatching(/rate-limited/),
    });
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('fails fast when Retry-After exceeds the interactive cap', async () => {
    createMock.mockRejectedValue(groqError(429, { headers: { 'retry-after': '3600' } }));
    await expect(drain()).rejects.toMatchObject({ status: 429 });
    expect(createMock).toHaveBeenCalledTimes(1); // no pointless hour-long wait
  });

  it('maps a rejected key to the actionable 502 without retrying', async () => {
    createMock.mockRejectedValue(groqError(401));
    await expect(drain()).rejects.toMatchObject({
      status: 502, message: expect.stringMatching(/GROQ_API_KEY/),
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('retries transient 5xx with backoff, then surfaces a curated 502', async () => {
    vi.useFakeTimers();
    try {
      createMock.mockRejectedValue(groqError(503));
      const p = drain();
      const assertion = expect(p).rejects.toMatchObject({
        status: 502, message: expect.stringMatching(/having trouble/),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(createMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps connection failures to a curated 502', async () => {
    vi.useFakeTimers();
    try {
      createMock.mockRejectedValue(groqError(undefined, { name: 'APIConnectionError' }));
      const p = drain();
      const assertion = expect(p).rejects.toMatchObject({
        status: 502, message: expect.stringMatching(/Could not reach/),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a 400 untranslated — that is our bug, keep the stack loud', async () => {
    const original = groqError(400);
    createMock.mockRejectedValue(original);
    await expect(drain()).rejects.toBe(original);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

function toolChunk(index, id, name, argsFragment) {
  return {
    choices: [{
      delta: {
        tool_calls: [{
          index,
          ...(id ? { id } : {}),
          function: { ...(name ? { name } : {}), arguments: argsFragment },
        }],
      },
    }],
  };
}
const finishChunk = (reason) => ({ choices: [{ delta: {}, finish_reason: reason }] });

const TOOLS = [{ type: 'function', function: { name: 'get_weather', parameters: {} } }];

async function drain(gen) {
  const events = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe('streamChatWithTools', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.GROQ_API_KEY = 'gsk-test';
    delete process.env.GROQ_MODEL;
  });

  it('streams plain content when the model never calls a tool', async () => {
    createMock.mockResolvedValue((async function* () {
      yield chunk('Hello');
      yield finishChunk('stop');
    })());
    const events = await drain(streamChatWithTools([{ role: 'user', content: 'hi' }], TOOLS, vi.fn()));
    expect(events).toEqual([{ type: 'token', text: 'Hello' }]);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].tools).toEqual(TOOLS);
    expect(createMock.mock.calls[0][0].max_tokens).toEqual(expect.any(Number));
  });

  it('runs a tool round (args split across chunks) then streams the final answer', async () => {
    createMock
      .mockResolvedValueOnce((async function* () {
        yield toolChunk(0, 'call_1', 'get_weather', '{"city":');
        yield toolChunk(0, null, null, '"Žumberak"}');
        yield finishChunk('tool_calls');
      })())
      .mockResolvedValueOnce((async function* () {
        yield chunk('Pack');
        yield chunk(' layers');
        yield finishChunk('stop');
      })());
    const executeTool = vi.fn().mockResolvedValue('{"tempMax":21}');
    const events = await drain(streamChatWithTools([{ role: 'user', content: 'hike?' }], TOOLS, executeTool));

    expect(events).toEqual([
      { type: 'tool', name: 'get_weather', args: { city: 'Žumberak' } },
      { type: 'token', text: 'Pack' },
      { type: 'token', text: ' layers' },
    ]);
    expect(executeTool).toHaveBeenCalledWith('get_weather', { city: 'Žumberak' });

    const secondCallMessages = createMock.mock.calls[1][0].messages;
    expect(secondCallMessages.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Žumberak"}' } }],
    });
    expect(secondCallMessages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"tempMax":21}' });
  });

  it('caps at 3 tool rounds then forces a final answer without tools', async () => {
    createMock.mockImplementation(({ tools }) => tools
      ? (async function* () {
          yield toolChunk(0, 'call_x', 'get_weather', '{"city":"Zagreb"}');
          yield finishChunk('tool_calls');
        })()
      : (async function* () {
          yield chunk('Final');
          yield finishChunk('stop');
        })());
    const executeTool = vi.fn().mockResolvedValue('ok');
    const events = await drain(streamChatWithTools([{ role: 'user', content: 'hi' }], TOOLS, executeTool));

    expect(createMock).toHaveBeenCalledTimes(4);
    expect(createMock.mock.calls[3][0].tools).toBeUndefined();
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(events.at(-1)).toEqual({ type: 'token', text: 'Final' });
  });

  it('throws HttpError 502 before any call when GROQ_API_KEY is unset', async () => {
    delete process.env.GROQ_API_KEY;
    await expect(drain(streamChatWithTools([], TOOLS, vi.fn())))
      .rejects.toMatchObject({ status: 502 });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('never executes tool calls from a length-truncated round', async () => {
    createMock.mockResolvedValue((async function* () {
      yield toolChunk(0, 'call_1', 'get_weather', '{"city":"Zag'); // args cut mid-JSON
      yield finishChunk('length');
    })());
    const executeTool = vi.fn();
    await expect(drain(streamChatWithTools([{ role: 'user', content: 'hi' }], TOOLS, executeTool)))
      .rejects.toMatchObject({ status: 502, message: expect.stringMatching(/length limit/) });
    expect(executeTool).not.toHaveBeenCalled();
  });
});

// Llama sometimes writes a tool call into the reply text as
// "<function=name>{...}</function>" instead of the native channel. The raw
// markup must never reach the client, and the call must still run.
describe('streamChatWithTools · text-form tool tags', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.GROQ_API_KEY = 'gsk-test';
    delete process.env.GROQ_MODEL;
  });

  const joinedText = (events) =>
    events.filter((e) => e.type === 'token').map((e) => e.text).join('');

  it('strips a tag split across chunks, executes it, and streams the follow-up', async () => {
    createMock
      .mockResolvedValueOnce((async function* () {
        yield chunk('Consider Pohorje. ');
        yield chunk('<function=get_wea');
        yield chunk('ther>{"city":"Pohorje"}</fun');
        yield chunk('ction>');
        yield finishChunk('stop');
      })())
      .mockResolvedValueOnce((async function* () {
        yield chunk('About 21 °C up there.');
        yield finishChunk('stop');
      })());
    const executeTool = vi.fn().mockResolvedValue('{"tempMax":21}');
    const events = await drain(streamChatWithTools([{ role: 'user', content: 'hike?' }], TOOLS, executeTool));

    expect(joinedText(events)).toBe('Consider Pohorje. About 21 °C up there.');
    expect(events).toContainEqual({ type: 'tool', name: 'get_weather', args: { city: 'Pohorje' } });
    expect(executeTool).toHaveBeenCalledWith('get_weather', { city: 'Pohorje' });

    // The stripped text and the synthetic call both ride into round two.
    const secondCallMessages = createMock.mock.calls[1][0].messages;
    expect(secondCallMessages.at(-2)).toMatchObject({
      role: 'assistant',
      content: 'Consider Pohorje. ',
      tool_calls: [{ type: 'function', function: { name: 'get_weather', arguments: '{"city":"Pohorje"}' } }],
    });
    expect(secondCallMessages.at(-1)).toMatchObject({ role: 'tool', content: '{"tempMax":21}' });
  });

  it('executes an unterminated tag left hanging at stream end', async () => {
    createMock
      .mockResolvedValueOnce((async function* () {
        yield chunk('Sure. <function=get_weather>{"city":"Bled"}');
        yield finishChunk('stop');
      })())
      .mockResolvedValueOnce((async function* () {
        yield chunk('Clear skies in Bled.');
        yield finishChunk('stop');
      })());
    const executeTool = vi.fn().mockResolvedValue('ok');
    const events = await drain(streamChatWithTools([{ role: 'user', content: 'hi' }], TOOLS, executeTool));

    expect(joinedText(events)).toBe('Sure. Clear skies in Bled.');
    expect(executeTool).toHaveBeenCalledWith('get_weather', { city: 'Bled' });
  });

  it('passes ordinary angle brackets through untouched', async () => {
    createMock.mockResolvedValue((async function* () {
      yield chunk('below 5 <');
      yield chunk(' 10 °C, and 2<3 holds');
      yield finishChunk('stop');
    })());
    const events = await drain(streamChatWithTools([{ role: 'user', content: 'hi' }], TOOLS, vi.fn()));
    expect(joinedText(events)).toBe('below 5 < 10 °C, and 2<3 holds');
  });

  it('strips but does not execute a tag in the forced final no-tools round', async () => {
    createMock.mockImplementation(({ tools }) => tools
      ? (async function* () {
          yield toolChunk(0, 'call_x', 'get_weather', '{"city":"Zagreb"}');
          yield finishChunk('tool_calls');
        })()
      : (async function* () {
          yield chunk('Done. <function=get_weather>{"city":"Zagreb"}</function>');
          yield finishChunk('stop');
        })());
    const executeTool = vi.fn().mockResolvedValue('ok');
    const events = await drain(streamChatWithTools([{ role: 'user', content: 'hi' }], TOOLS, executeTool));

    expect(createMock).toHaveBeenCalledTimes(4); // 3 tool rounds + forced final
    expect(executeTool).toHaveBeenCalledTimes(3); // the final round's tag is dropped
    expect(joinedText(events)).toContain('Done. ');
    expect(joinedText(events)).not.toContain('<function');
  });
});
