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

// Throws on non-OK so a dead key or exhausted quota is a failure, not an
// empty events panel: the caller must not fire the second billable search
// (the same key would fail again) nor cache the miss as a quiet city. The
// key rides in the Authorization header, so it never lands in a URL or a log.
// hl is pinned to 'en', the only language google_events accepts.
async function searchApiGet(params, apiKey) {
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

const str = (value) => (typeof value === 'string' ? value : '');

// SearchApi's 2026-08 google_events shape: date, start_time and venue are
// plain strings. start_time ("Aug 26, 7:00 PM") is absolute, while date can
// be relative ("Tomorrow"), so start_time wins; address only holds a city or
// neighbourhood, so it is the venue of last resort.
function toListing(e) {
  return {
    title: e.title,
    when: str(e.start_time) || str(e.date),
    venue: str(e.venue) || str(e.address),
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
      const listings = (Array.isArray(panel.events) ? panel.events : [])
        .filter((e) => typeof e?.title === 'string' && e.title)
        .slice(0, MAX_EVENTS)
        .map(toListing);
      if (listings.length) return listings;

      const search = await searchApiGet({ engine: 'google', q: `${cityName} events ${month}`.trim(), ...gl }, apiKey);
      return (Array.isArray(search.organic_results) ? search.organic_results : [])
        .filter((r) => typeof r?.title === 'string' && r.title && typeof r.snippet === 'string' && r.snippet)
        .slice(0, 6)
        .map((r) => ({ title: r.title, snippet: r.snippet }));
    });
  } catch (err) {
    console.warn(`live events lookup failed for ${cityName}: ${err.message}`);
    return [];
  }
}
