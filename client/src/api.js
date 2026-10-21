// Server communication. EventSource cannot POST, so SSE bodies are read
// manually from fetch's ReadableStream and parsed incrementally.

async function errorFrom(res) {
  const data = await res.json().catch(() => ({}));
  return new Error(data.error || `Request failed (HTTP ${res.status})`);
}

export async function getWeather(city, date) {
  const res = await fetch(`/api/weather?city=${encodeURIComponent(city)}&date=${date}`);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export function createSseParser({ onToken, onDone, onError, onTool }) {
  let buffer = '';
  return function feed(text) {
    buffer += text;
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      let data = '{}';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        onError?.(new Error('Malformed SSE event'));
        continue;
      }
      if (event === 'token') onToken?.(payload.text);
      else if (event === 'tool') onTool?.(payload);
      else if (event === 'done') onDone?.();
      else if (event === 'error') onError?.(new Error(payload.error));
    }
  };
}

// The server caps chat requests at 20 messages of ≤2000 chars each. The UI
// keeps the whole conversation; this trims only the REQUEST window — seed
// first (truncated), then the most recent turns that fit under the cap.
export function buildChatRequestMessages(seed, history) {
  const seedMsg = { role: 'assistant', content: seed.slice(0, 2000) };
  return [seedMsg, ...history.slice(-19).map((m) => ({ ...m, content: m.content.slice(0, 2000) }))];
}

export async function streamLlm(path, body, handlers) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser(handlers);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
  feed(decoder.decode()); // Canonical decoder flush; defensive — trailing incomplete bytes can't complete an SSE event.
}
