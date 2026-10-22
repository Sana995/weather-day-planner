// Tools the chat's Groq loop may call, plus their executor and the
// human-readable labels the client shows while a tool runs.

import { getDailySummary, getForecast } from './weather.js';
import { getAttractions, getCityEvents } from './places.js';
import { getLiveEvents } from './events.js';
import { validateCity, CITY_MAX_CHARS } from './validate.js';

export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        'Get the real forecast for a city on a date within today through +5 days. ' +
        'Call this before advising about any place other than the current context city.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City, town, or the nearest town to a nature spot' },
          date: { type: 'string', description: 'YYYY-MM-DD; omit to reuse the date being planned' },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_attractions',
      description:
        'Get real attractions and travel-guide notes for a city — use when the user asks ' +
        'what to see or do somewhere, or when suggesting a day-trip destination.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City or town to look up' },
        },
        required: ['city'],
      },
    },
  },
];

const argCity = (args, fallback) =>
  typeof args?.city === 'string' && args.city.trim() ? args.city.trim() : fallback;

export function createToolExecutor(context) {
  return async function execute(name, args) {
    try {
      if (name === 'get_weather') {
        // The model writes these args, so they get the same cap as a request.
        const city = validateCity(argCity(args, context.city));
        const date = typeof args?.date === 'string' && args.date ? args.date : context.date;
        const { city: cityInfo, day } = await getDailySummary(city, date);
        const { entries, ...summary } = day;
        return JSON.stringify({ city: `${cityInfo.name}, ${cityInfo.country}`, ...summary });
      }
      if (name === 'get_attractions') {
        const city = validateCity(argCity(args, context.city));
        const { city: cityInfo, days } = await getForecast(city);
        const [{ pois, guide }, events, liveEvents] = await Promise.all([
          getAttractions(cityInfo.name, cityInfo.coord, days[0].condition, context.activity),
          getCityEvents(cityInfo.name),
          getLiveEvents(cityInfo.name, cityInfo.country, context.date),
        ]);
        return JSON.stringify({ pois: pois.map((p) => p.name), guide, events, liveEvents });
      }
      return `Unknown tool: ${name}`;
    } catch (err) {
      return `Tool error: ${err.message}`;
    }
  };
}

export function toolLabel(name, args) {
  const city = argCity(args, 'that place');
  const place = city.length > CITY_MAX_CHARS ? 'that place' : city;
  if (name === 'get_weather') return `Sunny is checking the forecast for ${place}…`;
  if (name === 'get_attractions') return `Sunny is looking up attractions around ${place}…`;
  return 'Sunny is working on it…';
}
