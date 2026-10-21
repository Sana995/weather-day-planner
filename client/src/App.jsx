import { useEffect, useRef, useState } from 'react';
import WeatherForm from './components/WeatherForm.jsx';
import WeatherCard from './components/WeatherCard.jsx';
import Recommendation from './components/Recommendation.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import { getWeather, streamLlm } from './api.js';

// What the answer will carry once it arrives — shown while the column is
// still empty, so the wait is never a blank page.
const SECTIONS = ['Outfit', 'Activities', 'Tips'];

export default function App() {
  const [weather, setWeather] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  // The profile as it was at submit time, so the answer can state what drove
  // it even after the form's own selects have been changed again.
  const [asked, setAsked] = useState(null);
  // Snapshot of the request that produced the current recommendation, handed
  // to the chat so follow-ups can re-check the same city/date/profile. Null
  // until a recommendation exists; cleared on reset so a new run drops the
  // previous chat (fresh state, not a stale conversation).
  const [chatCtx, setChatCtx] = useState(null);
  const resultsRef = useRef(null);

  function reset() {
    setWeather(null); setText(''); setError(''); setAsked(null); setChatCtx(null);
  }

  // Stacked layouts put the answer below the fold; bring it under the thumb.
  // Runs as an effect, not inside the submit handler: the busy re-render
  // unmounts the empty-state card, so scrolling before React commits would aim
  // at a layout that is about to collapse. Optional-called so environments
  // without layout APIs (jsdom) simply skip it. A JS-supplied `behavior`
  // overrides CSS, so reduced motion is honoured here too — the stylesheet
  // alone cannot switch this one off.
  useEffect(() => {
    if (!busy) return;
    // Just under styles.css's `@media (min-width: 62rem)` breakpoint, so the
    // two queries are never simultaneously true at exactly 62rem.
    if (!window.matchMedia?.('(max-width: 61.999rem)')?.matches) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    resultsRef.current?.scrollIntoView?.({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }, [busy]);

  async function runDay({ city, date, profile, traveling, includeActivities }) {
    if (busy) return;
    reset(); setBusy(true); setAsked(profile);
    setChatCtx({ city, date, profile, traveling });
    try {
      setWeather(await getWeather(city, date));
      setStreaming(true);
      await streamLlm('/api/recommend', { city, date, profile, traveling, includeActivities }, {
        onToken: (t) => setText((prev) => prev + t),
        onError: (err) => setError(err.message),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setStreaming(false); setBusy(false);
    }
  }

  const waiting = busy && !weather && !text;
  const blank = !busy && !error && !weather && !text && !streaming;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Personal Weather Assistant</h1>
          <p className="tagline">Weather-aware outfit and activity advice</p>
        </div>
        {/* The horizon is a hard limit of the forecast, so it is stated up
            front rather than discovered by picking a date too far out. */}
        <p className="chip chip-sky">Forecast window: today &rarr; +5 days</p>
      </header>

      <main className="layout">
        <div className="rail">
          <WeatherForm onSubmit={runDay} busy={busy} />
        </div>

        <div className="results" ref={resultsRef} aria-busy={busy}>
          {error && (
            <p className="error" role="alert">
              <span className="error-title">That request did not go through</span>
              <span className="error-msg">{error}</span>
            </p>
          )}

          {/* Mounted at all times so assistive tech is already watching it. */}
          <div className="status-region" aria-live="polite">
            {waiting && !error && (
              <p className="status">
                <span className="status-dots" aria-hidden="true">
                  <span /><span /><span />
                </span>
                Reading the forecast
              </p>
            )}
            {!busy && text && !error && <span className="sr-only">Recommendation ready</span>}
          </div>

          {weather && <WeatherCard city={weather.city} day={weather.day} />}
          <Recommendation text={text} streaming={streaming} profile={asked} />

          {chatCtx && text && !streaming && !busy && !error && (
            <ChatPanel context={chatCtx} seed={text} />
          )}

          {blank && (
            <div className="card empty">
              <p className="empty-lede">Your advice will appear here</p>
              <p className="empty-body">
                Fill in the form. The assistant reads the real forecast for that city and day,
                then writes advice for your activity, cold tolerance, and heat tolerance — streamed here
                as it arrives.
              </p>
              <ul className="chip-row empty-list">
                {SECTIONS.map((s) => <li className="chip" key={s}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
