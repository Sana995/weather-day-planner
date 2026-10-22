// SearchApi (searchapi.io) live-events lookup, entirely optional like Geoapify.
// Degrades to [] on any failure or missing key. Sign-up comes with a finite
// pool of free requests, and the 10-minute cache stretches it a long way.
//
// Two layers behind one function: the structured google_events engine when
// Google serves its events panel, else a plain google search whose organic
// snippets for "<city> events <month year>" carry real dated listings
// (venue calendars, ticket sites). Panel items come back as {title, when,
// venue}; snippet items as {title, snippet}. The prompt tells the model to
// trust only dates the listing itself states.

import { takeDailyBudget } from './budget.js';
import { cleanText } from './untrusted.js';

const TTL_MS = 10 * 60 * 1000;
const eventsCache = new Map(); // key → { value, expires }

export function _clearEventsCache() {
  eventsCache.clear();
}

// Stores the in-flight promise so concurrent callers share one upstream call.
async function cached(key, fn) {
  const hit = eventsCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = fn();
  eventsCache.set(key, { value, expires: Date.now() + TTL_MS });
  try {
    return await value;
  } catch (err) {
    eventsCache.delete(key);
    throw err;
  }
}

const SEARCH_API = 'https://www.searchapi.io/api/v1/search';
const MAX_EVENTS = 8;
// Per-field caps for web text headed into the prompt.
const TITLE_MAX = 120;
const WHEN_MAX = 60;
const VENUE_MAX = 120;
const SNIPPET_MAX = 300;

// Throws on non-OK so a dead key or exhausted quota is a failure, not an
// empty events panel: the caller must not fire the second billable search
// (the same key would fail again) nor cache the miss as a quiet city. The
// key rides in the Authorization header, so it never lands in a URL or a log.
// hl is pinned to 'en', the only language google_events accepts. Every
// request counts against the daily cap first; a used-up day is a failure like
// any other, so it degrades to [] and is never cached.
async function searchApiGet(params, apiKey) {
  if (!takeDailyBudget('searchapi')) throw new Error('SearchApi daily limit reached');
  const qs = new URLSearchParams({ hl: 'en', ...params });
  const res = await fetch(`${SEARCH_API}?${qs}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`SearchApi HTTP ${res.status}`);
  return res.json();
}

// "August 2026" in the city's terms; scoping the fallback search to the
// requested month keeps the snippets on the right part of the calendar.
function monthPhrase(date) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

// cleanText also turns a non-string field into ''.
const str = (value, max) => cleanText(value, max);

// SearchApi's 2026-08 google_events shape: date, start_time and venue are
// plain strings. start_time ("Aug 26, 7:00 PM") is absolute, while date can
// be relative ("Tomorrow"), so start_time wins; address only holds a city or
// neighbourhood, so it is the venue of last resort.
function toListing(e) {
  return {
    title: str(e.title, TITLE_MAX),
    when: str(e.start_time, WHEN_MAX) || str(e.date, WHEN_MAX),
    venue: str(e.venue, VENUE_MAX) || str(e.address, VENUE_MAX),
  };
}

export async function getLiveEvents(cityName, country = '', date = '') {
  const apiKey = process.env.SEARCHAPI_API_KEY;
  if (!apiKey) return [];
  const gl = /^[A-Za-z]{2}$/.test(country) ? { gl: country.toLowerCase() } : {};
  const month = monthPhrase(date);
  // Failures degrade to [] for the caller but are caught OUTSIDE cached(), so
  // a transient 429 or a revoked key is retried on the next request instead of
  // impersonating a quiet city for the whole TTL.
  try {
    return await cached(`searchapi:${cityName.trim().toLowerCase()}:${month}`, async () => {
      const panel = await searchApiGet({ engine: 'google_events', q: `Events in ${cityName}`, ...gl }, apiKey);
      // Cleaned before filtering: a title that was nothing but an instruction
      // comes out empty and the listing is dropped.
      const listings = (Array.isArray(panel.events) ? panel.events : [])
        .map((e) => toListing(e ?? {}))
        .filter((e) => e.title)
        .slice(0, MAX_EVENTS);
      if (listings.length) return listings;

      const search = await searchApiGet({ engine: 'google', q: `${cityName} events ${month}`.trim(), ...gl }, apiKey);
      return (Array.isArray(search.organic_results) ? search.organic_results : [])
        .map((r) => ({ title: str(r?.title, TITLE_MAX), snippet: str(r?.snippet, SNIPPET_MAX) }))
        .filter((r) => r.title && r.snippet)
        .slice(0, 6);
    });
  } catch (err) {
    console.warn(`live events lookup failed for ${cityName}: ${err.message}`);
    return [];
  }
}
