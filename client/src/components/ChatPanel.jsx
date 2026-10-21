import { useState } from 'react';
import Markdown from 'react-markdown';
import { streamLlm, buildChatRequestMessages } from '../api.js';

// Sunny's face: a hand-drawn sun on a warm gradient badge — the one warm
// accent in an otherwise cool palette, so the assistant reads as its own
// character. Inline SVG keeps it dependency-free and crisp at any size.
function SunnyIcon() {
  return (
    <span className="sunny-badge" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4.4" fill="currentColor" stroke="none" />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.55 1.55M17.15 17.15l1.55 1.55M18.7 5.3l-1.55 1.55M6.85 17.15L5.3 18.7" />
      </svg>
    </span>
  );
}

// Stateless on the server: every turn re-sends a windowed request (see
// buildChatRequestMessages), with the original recommendation riding along
// as the first assistant message. Displayed turns keep the full history.
export default function ChatPanel({ context, seed }) {
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [toolNote, setToolNote] = useState('');
  const [error, setError] = useState('');

  async function send(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    const history = [...turns, { role: 'user', content }];
    setTurns(history);
    setDraft(''); setBusy(true); setError('');
    let reply = '';
    try {
      await streamLlm('/api/chat', {
        context,
        messages: buildChatRequestMessages(seed, history),
      }, {
        onToken: (t) => {
          reply += t;
          setToolNote('');
          setTurns([...history, { role: 'assistant', content: reply }]);
        },
        onTool: ({ label }) => setToolNote(label),
        onError: (err) => setError(err.message),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false); setToolNote('');
    }
  }

  return (
    <section className="card chat" aria-label="Chat with Sunny">
      <h2 className="card-title chat-title">
        <SunnyIcon />
        Chat with Sunny
      </h2>
      {turns.length === 0 && (
        <p className="chat-hint">
          Hey, I&rsquo;m Sunny — I put that plan together. Poke holes in it, widen it
          (&ldquo;a 1.5&nbsp;h drive is fine too&rdquo;), or ask me anything about the day.
        </p>
      )}
      <ol className="chat-log">
        {turns.map((t, i) => (
          <li key={i} className={`chat-msg ${t.role}`}>
            {t.role === 'assistant'
              ? <div className="answer"><Markdown>{t.content}</Markdown></div>
              : t.content}
          </li>
        ))}
      </ol>
      {toolNote && <p className="status chat-tool" aria-live="polite">{toolNote}</p>}
      {error && (
        <p className="error" role="alert">
          <span className="error-msg">{error}</span>
        </p>
      )}
      <form className="chat-input" onSubmit={send}>
        <label htmlFor="chat-draft" className="sr-only">Your message</label>
        <input id="chat-draft" value={draft} maxLength={2000} disabled={busy}
          placeholder="Ask Sunny anything — plans, places, timing…"
          onChange={(e) => setDraft(e.target.value)} />
        <button className="primary" type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}
