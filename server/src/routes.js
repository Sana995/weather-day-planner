import { Router } from 'express';
import { HttpError } from './errors.js';
import { parseDate, validateProfile, validateChatMessages, validateTraveling, validateIncludeActivities } from './validate.js';
import { getDailySummary } from './weather.js';
import { getAttractions, getCityEvents } from './places.js';
import { getLiveEvents } from './events.js';
import { streamChat, streamChatWithTools, requireGroqKey } from './groq.js';
import { buildRecommendPrompt, buildChatMessages } from './prompts.js';
import { CHAT_TOOLS, createToolExecutor, toolLabel } from './chatTools.js';

const router = Router();

// A non-string city (e.g. a repeated query param parsed into an array, or a
// JSON number/object body) must 400, not crash .trim() into a 500.
function requireCity(city) {
  if (typeof city !== 'string' || !city.trim()) throw new HttpError(400, 'city is required');
  return city;
}

router.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/api/weather', async (req, res, next) => {
  try {
    const { city, date } = req.query;
    requireCity(city);
    parseDate(date);
    res.json(await getDailySummary(city, date));
  } catch (err) {
    next(err);
  }
});

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// One SSE lifecycle for both streaming endpoints, over an async iterable of
// [event, data] pairs. Headers go out with the first event, not up front:
// anything thrown before then (rejected key, model errors) still reaches
// next() as a plain JSON error — the same contract as every non-streaming
// route — instead of turning into a vague mid-stream error event.
async function streamToClient(res, events) {
  let started = false;
  const send = (event, data) => {
    if (!started) {
      started = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
    }
    sse(res, event, data);
  };
  try {
    for await (const [event, data] of events) send(event, data);
    send('done', {});
  } catch (err) {
    if (!started) throw err; // pre-stream — becomes a JSON error via next()
    console.error(err);
    // Curated HttpError messages (e.g. the length-limit cut) are safe to
    // show; anything unexpected stays generic.
    send('error', { error: err instanceof HttpError ? err.message : 'The AI stream failed — please try again.' });
  } finally {
    if (started) res.end();
  }
}

router.post('/api/recommend', async (req, res, next) => {
  try {
    const { city, date } = req.body;
    requireCity(city);
    parseDate(date);
    const profile = validateProfile(req.body.profile);
    const traveling = validateTraveling(req.body.traveling);
    const includeActivities = validateIncludeActivities(req.body.includeActivities);
    const { city: cityInfo, day } = await getDailySummary(city, date);
    // After the forecast lookup (a bad city must keep its 404), before the
    // enrichment fetches: a missing key costs no further I/O and arrives as
    // an actionable JSON 502.
    requireGroqKey();
    // Independent gates: attractions follow their own checkbox (with
    // activities off they feed a standalone "### Attractions" section);
    // events ride along whenever activities are on — festivals matter to
    // locals too, so they are not gated behind the attractions checkbox.
    const [attractions, events, liveEvents] = await Promise.all([
      traveling
        ? getAttractions(cityInfo.name, cityInfo.coord, day.condition, profile.activity)
        : { pois: [], guide: '' },
      includeActivities ? getCityEvents(cityInfo.name) : '',
      includeActivities ? getLiveEvents(cityInfo.name, cityInfo.country, date) : [],
    ]);
    const prompt = buildRecommendPrompt({ city: cityInfo, day, profile, traveling, attractions, events, liveEvents, includeActivities });
    await streamToClient(res, (async function* () {
      for await (const token of streamChat(prompt)) yield ['token', { text: token }];
    })());
  } catch (err) {
    next(err);
  }
});

router.post('/api/chat', async (req, res, next) => {
  try {
    const context = req.body?.context ?? {};
    requireCity(context.city);
    parseDate(context.date);
    const profile = validateProfile(context.profile);
    const traveling = validateTraveling(context.traveling);
    const history = validateChatMessages(req.body?.messages);
    const { city: cityInfo, day } = await getDailySummary(context.city, context.date);
    // Same ordering contract as /api/recommend.
    requireGroqKey();

    const messages = buildChatMessages({ city: cityInfo, day, profile, traveling, history });
    const execute = createToolExecutor({ city: context.city, date: context.date, activity: profile.activity });

    await streamToClient(res, (async function* () {
      for await (const ev of streamChatWithTools(messages, CHAT_TOOLS, execute)) {
        yield ev.type === 'token'
          ? ['token', { text: ev.text }]
          : ['tool', { name: ev.name, label: toolLabel(ev.name, ev.args) }];
      }
    })());
  } catch (err) {
    next(err);
  }
});

export default router;
