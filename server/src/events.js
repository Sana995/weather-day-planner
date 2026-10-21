// SerpApi live-events lookup — entirely optional, like Geoapify.
// Degrades to [] on any failure or missing key. SerpApi's free tier is
// per-month recurring, and the 10-minute cache stretches it a long way.
//
// Two layers behind one function: the structured google_events engine when
// Google serves its events panel, else a plain google search whose organic
// snippets for "<city> events <month year>" carry real dated listings
// (venue calendars, ticket sites). Panel items come back as {title, when,
// venue}; snippet items as {title, snippet} — the prompt tells the model to
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

const SERP_API = 'https://serpapi.com/search.json';
const MAX_EVENTS = 8;

// Throws on non-OK so a dead key or exhausted quota is a failure, not an
// empty events panel — the caller must not fire the second billable search
// (the same key would fail again) nor cache the miss as a quiet city.
async function serpGet(params, apiKey) {
  const qs = new URLSearchParams({ hl: 'en', ...params, api_key: apiKey });
  const res = await fetch(`${SERP_API}?${qs}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  return res.json();
}

// "August 2026" in the city's terms — scoping the fallback search to the
// requested month keeps the snippets on the right part of the calendar.
function monthPhrase(date) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

export async function getLiveEvents(cityName, country = '', date = '') {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];
  const gl = /^[A-Za-z]{2}$/.test(country) ? { gl: country.toLowerCase() } : {};
  const month = monthPhrase(date);
  // Failures degrade to [] for the caller but are caught OUTSIDE cached(), so
  // a transient 429 or a revoked key is retried on the next request instead of
  // impersonating a quiet city for the whole TTL.
  try {
    return await cached(`serp:${cityName.trim().toLowerCase()}:${month}`, async () => {
      const panel = await serpGet({ engine: 'google_events', q: `Events in ${cityName}`, ...gl }, apiKey);
      const listings = (panel.events_results ?? [])
        .filter((e) => e?.title)
        .slice(0, MAX_EVENTS)
        .map((e) => ({
          title: e.title,
          when: e.date?.when ?? e.date?.start_date ?? '',
          venue: e.venue?.name ?? e.address?.[0] ?? '',
        }));
      if (listings.length) return listings;

      const serp = await serpGet({ engine: 'google', q: `${cityName} events ${month}`.trim(), ...gl }, apiKey);
      return (serp.organic_results ?? [])
        .filter((r) => r?.title && r?.snippet)
        .slice(0, 6)
        .map((r) => ({ title: r.title, snippet: r.snippet }));
    });
  } catch (err) {
    console.warn(`live events lookup failed for ${cityName}: ${err.message}`);
    return [];
  }
}
