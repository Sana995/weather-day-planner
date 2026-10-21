// Geoapify + Wikivoyage attractions lookup — entirely optional.
// Both sources degrade to empty on any failure. 10-minute cache mirrors weather.js.

const TTL_MS = 10 * 60 * 1000;
const placesCache = new Map(); // key → { value, expires }

export function _clearPlacesCache() {
  placesCache.clear();
}

// Stores the in-flight promise, not the settled value, so concurrent callers
// (the guide and the events extraction share one upstream fetch) join the
// same flight instead of each hitting Wikivoyage.
async function cached(key, fn) {
  const hit = placesCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = fn();
  placesCache.set(key, { value, expires: Date.now() + TTL_MS });
  try {
    return await value;
  } catch (err) {
    placesCache.delete(key);
    throw err;
  }
}

const GEO_INDOOR = 'entertainment.museum,entertainment.culture';
const GEO_OUTDOOR = 'tourism.sights,tourism.attraction,leisure.park,natural';
// Hikers want trails and green space, not city sights — urban POIs were
// luring the LLM into swapping the hike for sightseeing.
const GEO_NATURE = 'natural,leisure.park';
const GEO_WET = new Set(['Rain', 'Drizzle', 'Snow', 'Thunderstorm']);

export async function getGeoapifyPois(lat, lon, condition, activity) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return [];
  const categories = GEO_WET.has(condition) ? GEO_INDOOR
    : activity === 'hiking' ? GEO_NATURE
    : GEO_OUTDOOR;
  // Failures degrade to [] but are caught OUTSIDE cached(), so they are never
  // stored as a successful empty result for the whole TTL.
  try {
    return await cached(`geo:${lat.toFixed(2)},${lon.toFixed(2)},${categories}`, async () => {
      const params = new URLSearchParams({
        categories,
        filter: `circle:${lon},${lat},5000`, // Geoapify circles are lon-first
        limit: '8',
        apiKey,
      });
      const res = await fetch(`https://api.geoapify.com/v2/places?${params}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`geoapify HTTP ${res.status}`);
      const data = await res.json();
      return (data.features ?? [])
        .map((f) => f.properties)
        .filter((p) => p?.name)
        .map((p) => ({ name: p.name, categories: p.categories ?? [] }));
    });
  } catch (err) {
    console.warn(`geoapify lookup failed: ${err.message}`);
    return [];
  }
}

const WV_API = 'https://en.wikivoyage.org/w/api.php';
const GUIDE_MAX_CHARS = 1500;

async function wvGet(params) {
  const res = await fetch(`${WV_API}?${new URLSearchParams({ format: 'json', ...params })}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`wikivoyage HTTP ${res.status}`);
  return res.json();
}

// Wikivoyage separates listings with entity whitespace ('.&#32;', '&#160;');
// left undecoded, no sentence boundary survives and downstream splitting sees
// one giant blob. Numeric first, then named — so '&amp;#32;' correctly decodes
// once, to the literal '&#32;'.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', ndash: '–', mdash: '—' };
const decodeEntities = (text) => text
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);

const stripHtml = (html) => decodeEntities(html
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<[^>]+>/g, ' '))
  // MediaWiki section-edit links survive tag-stripping as bracketed text.
  .replace(/\[\s*edit(\s*\|\s*edit source)?\s*\]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// One cached fetch per city: the See/Do section texts that both the guide
// and the events extraction are built from.
async function getWikivoyageSections(cityName) {
  const key = `wv:${cityName.trim().toLowerCase()}`;
  // A genuinely missing page caches {} as a stable answer; a fetch failure is
  // caught outside cached() so the next request retries instead of serving a
  // silently-empty guide for the whole TTL.
  try {
    return await cached(key, async () => {
      const meta = await wvGet({ action: 'parse', page: cityName, redirects: '1', prop: 'sections' });
      const sections = meta.parse?.sections ?? [];
      const out = {};
      for (const heading of ['See', 'Do']) {
        const sec = sections.find((s) => s.line === heading);
        if (!sec) continue;
        const body = await wvGet({
          action: 'parse', page: cityName, redirects: '1', prop: 'text', section: String(sec.index),
        });
        const text = stripHtml(body.parse?.text?.['*'] ?? '');
        if (text) out[heading] = text;
      }
      return out;
    });
  } catch (err) {
    console.warn(`wikivoyage lookup failed for ${cityName}: ${err.message}`);
    return {};
  }
}

export async function getWikivoyageGuide(cityName) {
  const sections = await getWikivoyageSections(cityName);
  return ['See', 'Do']
    .filter((h) => sections[h])
    .map((h) => `${h}: ${sections[h]}`)
    .join('\n')
    .slice(0, GUIDE_MAX_CHARS);
}

// Wikivoyage rarely dates its festivals, so this only surfaces the sentences
// that name one — the prompt asks the model to judge whether it fits the
// requested date. \b keeps 'affairs' and 'unfair' out of the net.
const EVENT_RE = /\b(festivals?|carnivals?|fairs?|parades?|concerts?)\b/i;
const EVENTS_MAX_CHARS = 700;

export async function getCityEvents(cityName) {
  const sections = await getWikivoyageSections(cityName);
  const sentences = Object.values(sections).join(' ').split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => EVENT_RE.test(s)).join(' ').slice(0, EVENTS_MAX_CHARS);
}

export async function getAttractions(cityName, coord, condition, activity) {
  const [pois, guide] = await Promise.all([
    getGeoapifyPois(coord.lat, coord.lon, condition, activity),
    getWikivoyageGuide(cityName),
  ]);
  return { pois, guide };
}
