// Aggregates OpenWeatherMap 3-hour forecast entries into per-local-day summaries.

import { HttpError } from './errors.js';

function mostFrequent(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const round1 = (x) => Math.round(x * 10) / 10;

export function summarizeDays(forecast) {
  const { name, country, timezone, coord } = forecast.city;
  const buckets = new Map(); // local 'YYYY-MM-DD' → raw entries

  for (const item of forecast.list) {
    const local = new Date((item.dt + timezone) * 1000).toISOString();
    const date = local.slice(0, 10);
    const entry = {
      time: local.slice(11, 16),
      temp: round1(item.main.temp),
      condition: item.weather[0].main,
      description: item.weather[0].description,
      pop: item.pop ?? 0,
      wind: item.wind?.speed ?? 0,
    };
    if (!buckets.has(date)) buckets.set(date, []);
    buckets.get(date).push(entry);
  }

  const days = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({
      date,
      tempMin: round1(Math.min(...entries.map((e) => e.temp))),
      tempMax: round1(Math.max(...entries.map((e) => e.temp))),
      condition: mostFrequent(entries.map((e) => e.condition)),
      description: mostFrequent(entries.map((e) => e.description)),
      pop: Math.round(Math.max(...entries.map((e) => e.pop)) * 100),
      windMax: Math.max(...entries.map((e) => e.wind)),
      entries,
    }));

  return { city: { name, country, timezone, coord }, days };
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // cityKey → { data, expires }

export function _clearCache() {
  cache.clear();
}

export async function getForecast(city) {
  const key = city.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new HttpError(502, 'OPENWEATHER_API_KEY is not set — copy .env.example to .env and add your key');
  }

  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city.trim())}&units=metric&appid=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) throw new HttpError(404, 'City not found');
  if (res.status === 401) throw new HttpError(502, 'OpenWeatherMap rejected the API key — check OPENWEATHER_API_KEY (fresh keys can take ~2h to activate)');
  if (res.status === 429) throw new HttpError(429, 'OpenWeatherMap rate limit exceeded — try again shortly');
  if (!res.ok) throw new HttpError(502, `OpenWeatherMap error (HTTP ${res.status})`);

  const data = summarizeDays(await res.json());
  // OWM resolves city names to its nearest station record — "Zagreb" comes
  // back as the "Donji grad" district. Keep the name the user actually typed;
  // it is also the better key for travel-guide lookups.
  data.city.name = city.trim();
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// City-local 'now', so "today" and the current time are judged where the
// weather is, not where the server runs.
function cityLocalNow(timezone) {
  return new Date((Math.floor(Date.now() / 1000) + timezone) * 1000).toISOString();
}

export async function getDailySummary(city, date) {
  const { city: cityInfo, days } = await getForecast(city);
  const found = days.find((d) => d.date === date);
  if (!found) {
    throw new HttpError(404, `No forecast available for ${date}. Forecasts cover today through +5 days.`);
  }
  // Label the day relative to the city's local today — the LLM otherwise has
  // no way to know whether the date means today, tomorrow, or a weekday, and
  // for today it must also know which hours are already gone.
  const local = cityLocalNow(cityInfo.timezone);
  const localToday = local.slice(0, 10);
  const localTomorrow = new Date(Date.parse(`${localToday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const day = { ...found };
  if (date === localToday) {
    day.when = 'today';
    day.now = local.slice(11, 16);
  } else if (date === localTomorrow) {
    day.when = 'tomorrow';
  } else {
    day.when = `on ${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
  }
  return { city: cityInfo, day };
}

