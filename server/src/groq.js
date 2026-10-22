import Groq from 'groq-sdk';
import { HttpError } from './errors.js';

// Groq shut llama-3.3-70b-versatile down on 2026-08-16 and named this as its
// replacement: a production model with tool calling.
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

// The prompts cap the answer in words; this caps it in tokens, so a model
// that ignores the prompt still cannot stream unboundedly. gpt-oss reasons
// before it answers and those tokens count against the same cap, so it
// leaves room for both.
const MAX_TOKENS = 2048;

// gpt-oss thinks before answering: low effort keeps the wait before the
// first streamed token short, and the reasoning text is left out of the
// response because only the answer is shown. reasoning_effort 'low' is
// gpt-oss only, so a GROQ_MODEL override to another family gets neither.
function modelParams() {
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  return model.startsWith('openai/gpt-oss')
    ? { model, reasoning_effort: 'low', include_reasoning: false }
    : { model };
}

// The cap is a backstop, not a feature: when it trips, the cut must be
// visible. Thrown after the tokens have streamed, so the route reports the
// truncation instead of closing the stream with a clean `done`.
function assertNotTruncated(finish) {
  if (finish === 'length') {
    throw new HttpError(502, 'The answer hit its length limit and was cut short — please try again.');
  }
}

// Routes call this before sending SSE headers: thrown here it becomes a plain
// JSON 502 the browser can show, instead of a vague mid-stream error event.
export function requireGroqKey() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new HttpError(502, 'GROQ_API_KEY is not set — copy .env.example to .env and add your key');
  }
  return apiKey;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_ATTEMPTS = 3;
// Beyond this a 429 is a quota problem, not a burst — fail fast with an
// honest message instead of holding an interactive request hostage.
const MAX_RETRY_AFTER_S = 15;
const BACKOFF_S = [1, 2];

const retryAfterSeconds = (err) => {
  const raw = err?.headers?.get?.('retry-after') ?? err?.headers?.['retry-after'];
  const s = Number(raw);
  return Number.isFinite(s) && s >= 0 ? s : null;
};

// groq-sdk errors the user can act on become curated HttpErrors; a 4xx we
// caused (bad request construction) stays untranslated so it is a loud 500
// with a stack, not a soothing message hiding our bug.
function translateGroqError(err) {
  const status = err?.status;
  if (status === 429) return new HttpError(429, 'The AI service is rate-limited right now — wait a few seconds and try again.');
  if (status === 401 || status === 403) return new HttpError(502, 'Groq rejected the API key — check GROQ_API_KEY in .env');
  if (status === 413) return new HttpError(413, 'The conversation is too large for the model — start a fresh chat.');
  if (err?.name === 'APIConnectionError') return new HttpError(502, 'Could not reach the AI service — check your connection and try again.');
  if (typeof status === 'number' && status >= 500) return new HttpError(502, 'The AI service is having trouble right now — please try again shortly.');
  return err;
}

// The single retry policy (the SDK's own is disabled via maxRetries: 0 so
// delays never stack): transient failures — 429, connection drops, 5xx —
// get up to MAX_ATTEMPTS, a 429 honouring Retry-After when it fits an
// interactive request; everything else surfaces immediately.
async function createChatStream(groq, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await groq.chat.completions.create(params);
    } catch (err) {
      const status = err?.status;
      const transient = status === 429 || err?.name === 'APIConnectionError'
        || (typeof status === 'number' && status >= 500);
      const wait = (status === 429 ? retryAfterSeconds(err) : null) ?? BACKOFF_S[attempt];
      if (!transient || attempt >= MAX_ATTEMPTS - 1 || wait > MAX_RETRY_AFTER_S) {
        throw translateGroqError(err);
      }
      await sleep(wait * 1000);
    }
  }
}

export async function* streamChat(messages) {
  const groq = new Groq({ apiKey: requireGroqKey(), maxRetries: 0 });
  const stream = await createChatStream(groq, {
    ...modelParams(),
    messages,
    stream: true,
    temperature: 0.7,
    max_completion_tokens: MAX_TOKENS,
  });
  let finish = null;
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const token = choice?.delta?.content;
    if (token) yield token;
    if (choice?.finish_reason) finish = choice.finish_reason;
  }
  assertNotTruncated(finish);
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return {}; }
}

// Llama models occasionally write a tool call into the reply text as
// "<function=name>{...}</function>" instead of using the native tool_calls
// channel. This filter holds back any streamed text that could still become
// such a tag, strips complete tags out of what the client sees, and collects
// them as {name, args} so the loop can execute them like native calls.
const TAG_OPEN = '<function=';
const TAG_CLOSE = '</function>';

function createTagFilter() {
  let held = '';
  const calls = [];

  function drain() {
    let out = '';
    for (;;) {
      const lt = held.indexOf('<');
      if (lt === -1) { out += held; held = ''; break; }
      out += held.slice(0, lt);
      held = held.slice(lt);
      if (!TAG_OPEN.startsWith(held.slice(0, TAG_OPEN.length))) {
        out += '<';
        held = held.slice(1);
        continue;
      }
      if (held.length < TAG_OPEN.length) break; // could still become a tag — wait
      const end = held.indexOf(TAG_CLOSE);
      if (end === -1) break; // tag body still streaming
      const m = /^<function=([\w-]+)>([\s\S]*)$/.exec(held.slice(0, end));
      if (m) calls.push({ name: m[1], args: m[2].trim() });
      held = held.slice(end + TAG_CLOSE.length);
    }
    return out;
  }

  return {
    calls,
    feed(text) { held += text; return drain(); },
    // Stream over: an unterminated tag is still a tool attempt — collect it
    // rather than show raw markup; anything else was ordinary text after all.
    flush() {
      const m = /^<function=([\w-]+)>([\s\S]*)$/.exec(held);
      if (m) { calls.push({ name: m[1], args: m[2].trim() }); held = ''; }
      const out = held;
      held = '';
      return out;
    },
  };
}

const MAX_TOOL_ROUNDS = 3;

// Yields {type:'token', text} and {type:'tool', name, args}. Runs up to
// MAX_TOOL_ROUNDS tool rounds, then one final round with tools disabled so a
// tool-happy model can never loop forever. executeTool must never throw —
// it reports failures as a result string the model can read.
export async function* streamChatWithTools(messages, tools, executeTool) {
  const groq = new Groq({ apiKey: requireGroqKey(), maxRetries: 0 });
  const convo = [...messages];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const useTools = round < MAX_TOOL_ROUNDS;
    const stream = await createChatStream(groq, {
      ...modelParams(),
      messages: convo,
      stream: true,
      temperature: 0.7,
      max_completion_tokens: MAX_TOKENS,
      ...(useTools ? { tools, tool_choice: 'auto' } : {}),
    });

    const calls = [];
    const filter = createTagFilter();
    let content = '';
    let finish = null;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        const text = filter.feed(choice.delta.content);
        if (text) {
          content += text;
          yield { type: 'token', text };
        }
      }
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: '', name: '', args: '' });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
    const tail = filter.flush();
    if (tail) {
      content += tail;
      yield { type: 'token', text: tail };
    }
    // A 'length' finish can cut tool-call arguments mid-JSON; executing them
    // would run tools on garbage (safeParse → {}), so surface the cut instead.
    assertNotTruncated(finish);
    // Text-form calls only count while tools are on; in the forced final
    // round the markup is stripped but nothing more is executed.
    if (useTools) {
      filter.calls.forEach((c, i) => calls.push({ id: `textcall_${round}_${i}`, name: c.name, args: c.args }));
    }

    if ((finish !== 'tool_calls' && filter.calls.length === 0) || calls.length === 0) return;

    convo.push({
      role: 'assistant',
      content: content || null,
      tool_calls: calls.map((c) => ({
        id: c.id, type: 'function', function: { name: c.name, arguments: c.args },
      })),
    });
    const parsed = calls.map((c) => ({ ...c, parsedArgs: safeParse(c.args) }));
    for (const c of parsed) yield { type: 'tool', name: c.name, args: c.parsedArgs };
    const results = await Promise.all(parsed.map((c) => executeTool(c.name, c.parsedArgs)));
    parsed.forEach((c, i) => convo.push({ role: 'tool', tool_call_id: c.id, content: results[i] }));
  }
}
