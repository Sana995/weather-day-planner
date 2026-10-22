import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('groq-sdk', () => ({
  default: class Groq {
    constructor() { this.chat = { completions: { create: createMock } }; }
  },
}));

import { streamChat, streamChatWithTools, requireGroqBudget } from '../src/groq.js';
import { HttpError } from '../src/errors.js';
import { _resetDailyBudgets } from '../src/budget.js';

// Budgets are module state; every test starts on a fresh day's count.
beforeEach(() => {
  _resetDailyBudgets();
  delete process.env.GROQ_DAILY_LIMIT;
});

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
      model: 'openai/gpt-oss-120b', stream: true,
      max_completion_tokens: expect.any(Number),
      messages: [{ role: 'user', content: 'hi' }],
    }));
  });

  it('honors GROQ_MODEL override', async () => {
    process.env.GROQ_MODEL = 'openai/gpt-oss-20b';
    createMock.mockResolvedValue((async function* () {})());
    for await (const _ of streamChat([])) { /* drain */ }
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-oss-20b' }));
  });

  it('asks gpt-oss for low reasoning effort and no reasoning text', async () => {
    createMock.mockResolvedValue((async function* () {})());
    for await (const _ of streamChat([])) { /* drain */ }
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      reasoning_effort: 'low', include_reasoning: false,
    }));
  });

  it('sends no gpt-oss reasoning fields to another model family', async () => {
    process.env.GROQ_MODEL = 'qwen/qwen3.8-27b';
    createMock.mockResolvedValue((async function* () {})());
    for await (const _ of streamChat([])) { /* drain */ }
    const params = createMock.mock.calls[0][0];
    expect(params.model).toBe('qwen/qwen3.8-27b');
    expect(params).not.toHaveProperty('reasoning_effort');
    expect(params).not.toHaveProperty('include_reasoning');
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

  it('counts a retried completion once against the daily cap', async () => {
    process.env.GROQ_DAILY_LIMIT = '1';
    createMock
      .mockRejectedValueOnce(groqError(429, { headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce((async function* () { yield chunk('ok'); })());
    expect(await drain()).toEqual(['ok']);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

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
    expect(createMock.mock.calls[0][0].max_completion_tokens).toEqual(expect.any(Number));
    expect(createMock.mock.calls[0][0]).toMatchObject({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low' });
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

  it('runs at most 3 tool calls in one round and answers the rest without running them', async () => {
    createMock
      .mockResolvedValueOnce((async function* () {
        for (let i = 0; i < 5; i++) yield toolChunk(i, `call_${i}`, 'get_weather', `{"city":"C${i}"}`);
        yield finishChunk('tool_calls');
      })())
      .mockResolvedValueOnce((async function* () {
        yield chunk('Done');
        yield finishChunk('stop');
      })());
    const executeTool = vi.fn().mockResolvedValue('ok');
    const events = await drain(streamChatWithTools([{ role: 'user', content: 'hi' }], TOOLS, executeTool));

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => e.type === 'tool').map((e) => e.args.city)).toEqual(['C0', 'C1', 'C2']);
    // The API needs a tool message for every tool_call id, run or not.
    const toolMessages = createMock.mock.calls[1][0].messages.filter((m) => m.role === 'tool');
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(['call_0', 'call_1', 'call_2', 'call_3', 'call_4']);
    expect(toolMessages.slice(0, 3).map((m) => m.content)).toEqual(['ok', 'ok', 'ok']);
    expect(toolMessages.slice(3).every((m) => m.content.startsWith('Not run'))).toBe(true);
  });

  it('stops a tool loop with a 429 when the daily limit runs out mid-chat', async () => {
    process.env.GROQ_DAILY_LIMIT = '2';
    createMock.mockImplementation(() => (async function* () {
      yield toolChunk(0, 'call_x', 'get_weather', '{"city":"Zagreb"}');
      yield finishChunk('tool_calls');
    })());
    const executeTool = vi.fn().mockResolvedValue('ok');
    await expect(drain(streamChatWithTools([{ role: 'user', content: 'hi' }], TOOLS, executeTool)))
      .rejects.toMatchObject({ status: 429, message: expect.stringContaining('daily AI limit') });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(2);
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

describe('daily Groq budget', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.GROQ_API_KEY = 'gsk-test';
  });

  it('refuses a completion with a curated 429 once GROQ_DAILY_LIMIT is used up', async () => {
    process.env.GROQ_DAILY_LIMIT = '1';
    createMock.mockImplementation(() => (async function* () { yield chunk('ok'); })());
    for await (const _ of streamChat([])) { /* drain */ }
    await expect(async () => {
      for await (const _ of streamChat([])) { /* drain */ }
    }).rejects.toMatchObject({ status: 429, message: expect.stringContaining('daily AI limit') });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('requireGroqBudget passes while calls remain and throws the same 429 after', async () => {
    process.env.GROQ_DAILY_LIMIT = '1';
    expect(() => requireGroqBudget()).not.toThrow();
    createMock.mockImplementation(() => (async function* () {})());
    for await (const _ of streamChat([])) { /* drain */ }
    expect(() => requireGroqBudget()).toThrow(HttpError);
    try {
      requireGroqBudget();
    } catch (err) {
      expect(err.status).toBe(429);
    }
  });
});
