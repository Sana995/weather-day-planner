// Builds Groq chat messages. Fixed output structure keeps client rendering
// predictable; prompts are plain strings so tests can assert on content.

function dayLine(day) {
  return `${day.date}: ${day.condition} (${day.description}), ${day.tempMin}–${day.tempMax} °C, ` +
    `rain chance ${day.pop}%, wind up to ${day.windMax} m/s`;
}

function hourlyBlock(day) {
  return day.entries
    .map((e) => `  ${e.time} — ${e.temp} °C, ${e.description}, rain ${Math.round(e.pop * 100)}%`)
    .join('\n');
}

// "2026-08-07 (today)" — the day word comes from the server (weather.js),
// because the LLM cannot know which date is today, and for today it must
// also know which hours are already gone.
function dateLine(day) {
  const when = day.when ? ` (${day.when})` : '';
  const now = day.now
    ? `\nLocal time now: ${day.now} — hours before this are already past; only the remaining hours are listed.`
    : '';
  return `Date: ${day.date}${when}${now}`;
}

function profileBlock(profile) {
  return [
    `- Planned activity: ${profile.activity}`,
    `- Cold tolerance: ${profile.coldTolerance}`,
    `- Heat tolerance: ${profile.heatTolerance}`,
  ].join('\n');
}

function attractionsBlock(traveling, attractions, includeActivities = true) {
  if (!traveling) return '';
  const { pois = [], guide = '' } = attractions ?? {};
  const lines = ['\nI am visiting this place as a tourist.'];
  if (pois.length) {
    lines.push(`Real nearby attractions:\n${pois.map((p) => `- ${p.name}`).join('\n')}`);
  }
  if (guide) lines.push(`Travel guide notes (Wikivoyage):\n${guide}`);
  // With activities on, attractions serve the day's plan; without it they
  // feed the standalone "### Attractions" list, so the guidance differs.
  lines.push(includeActivities
    ? 'This data serves the planned activity: prefer the entries that fit it — trails, parks, ' +
      'and viewpoints for outdoor days; indoor picks for wet ones — and use your own knowledge ' +
      'of the area the same way, adding places the list missed. An urban sight that does not ' +
      'fit the planned activity is an add-on before or after it, never the day\'s plan itself. ' +
      'Never invent place names.'
    : 'This data serves the "### Attractions" list: prefer the entries that fit the weather, ' +
      'and use your own knowledge of the area the same way, adding places the list missed. ' +
      'Never invent place names.');
  return `${lines.join('\n')}\n`;
}

// Guide-derived festival sentences, keyless via Wikivoyage. The source rarely
// carries dates, so the block says as much and the system contract makes the
// model judge the date itself.
function eventsBlock(events) {
  if (!events) return '';
  return '\nLocal events and festivals the travel guide mentions (undated — judge the date yourself):\n' +
    `${events}\n`;
}

// Live results via SearchApi: either structured events-panel listings
// ({title, when, venue}) or raw search snippets ({title, snippet}) whose
// text carries the dates. Real either way; dated only where stated.
function liveEventsBlock(liveEvents) {
  if (!liveEvents?.length) return '';
  const lines = liveEvents.map((e) => (e.snippet
    ? `- ${e.title}: ${e.snippet}`
    : `- ${e.title}${e.when ? ` — ${e.when}` : ''}${e.venue ? ` (${e.venue})` : ''}`));
  return `\nLive event search results (real; dates only where a listing states them):\n${lines.join('\n')}\n`;
}

export function buildRecommendPrompt({ city, day, profile, traveling, attractions, events = '', liveEvents = [], includeActivities = true }) {
  // The day phrase is injected into the example because models copy example
  // wording over instructions — so the example must already be correct.
  const dayPhrase = day.when || 'that day';
  const sections = includeActivities
    ? '"### Outfit", "### Activities", "### Tips"'
    : traveling
      ? '"### Outfit", "### Attractions", "### Tips"'
      : '"### Outfit", "### Tips"';
  const activitiesContract = includeActivities
    ? 'The "### Activities" section is dictated entirely by the planned activity, never generic: ' +
      'an office day suggests commute, lunch-break, and after-work moves; a hiking day suggests ' +
      'trail and terrain timing; an outdoors day suggests parks, gardens, viewpoints, and ' +
      'open-air time; tourism suggests concrete sights; running & ' +
      'sports suggests training windows; everyday suggests errands and leisure around town. ' +
      'Every suggestion must stay inside the register of the planned activity — never borrow ' +
      'another profile\'s signature activity: a hike belongs only to hiking days (a gentle ' +
      'park stroll is the everyday ceiling), a training session only to running & sports. ' +
      'The planned ' +
      'activity is the user\'s stated intent — never replace it with a different activity. ' +
      'Adapt it to the weather instead: shift the hour, shorten it, pick shade, water, or ' +
      'easier terrain, or say plainly it belongs on another day. Open the Activities ' +
      'section with that adapted plan for the planned activity itself, written as one or two ' +
      'short prose sentences — never a bullet; then list the concrete activity ideas and ' +
      'attractions under it as a markdown bullet list ("- "), one suggestion per bullet with ' +
      'its place and time window — attractions and indoor picks ride in that list as add-ons ' +
      'or rain backups. For hiking, think regionally, ' +
      'not just inside the city: name the real hiking country locals actually head to — from ' +
      'Maribor that is Pohorje; from Bled, also the Julian Alps around Kranjska Gora — a ' +
      'well-known trail, hill, or range within roughly an hour, with its time window, first. ' +
      'When a notable event you know coincides with the date — a festival, seasonal market, ' +
      'open-air concert series, or recurring cultural event — give it its own bullet when the ' +
      'weather suits it, but only events you are confident recur around that date; never ' +
      'invent a specific concert, program, or date you are not sure of. The user message may ' +
      'list festivals the travel guide mentions, without dates. Festival dates shift from ' +
      'year to year, so never assert this year\'s dates from memory and never declare such a ' +
      'festival on or off: one that fits the season earns its own bullet phrased as worth ' +
      'checking (e.g. "Festival Lent may well be on around now — check the programme") with ' +
      'no guess about its usual month attached; only one that clearly belongs to a different ' +
      'season (a Christmas market in August) is left out. Live event search results in the ' +
      'user message are different: they come from a real web search. Read each listing\'s own ' +
      'dates — some carry explicit when/venue fields, some are search snippets whose text ' +
      'contains the dates — and give each event that falls on the requested date and fits ' +
      'the weather and the planned activity\'s register its own bullet with its time and ' +
      'place, stated plainly. Skip events dated to other days rather than bending them to ' +
      'fit, and never state a date the listing itself does not carry. '
    : '';
  // Attractions without activities get their own section: a list of places,
  // deliberately not a day plan — that is what the user switched off.
  const attractionsContract = !includeActivities && traveling
    ? 'The "### Attractions" section is a list of places, not a day plan: real nearby ' +
      'attractions worth the user\'s time that day, as a markdown bullet list ("- "), one ' +
      'attraction per bullet with a short reason and the part of day that suits it in this ' +
      'weather — indoor picks lead on wet days, open-air sights on fine ones. Suggest ' +
      'nothing beyond visiting the places themselves, and never invent place names. '
    : '';
  const system = {
    role: 'system',
    content:
      'You are a practical, weather-savvy personal assistant. Reply in English, metric units, ' +
      'under 250 words. Before the first heading, open with one short line that names the ' +
      `planned activity, the city, and the day, e.g. "For your hike around Zagreb ${dayPhrase}:" ` +
      '— this example already uses the correct day wording for this request — and different ' +
      'activities must read as visibly different from the very first line. When the date is ' +
      'today, plan only within the hours that remain: the hourly list starts at the current ' +
      'local time, so never call an afternoon slot "early" and never suggest times that have ' +
      'already passed. Timing must be humanly sensible: respect daylight for outdoor plans ' +
      '(you know roughly when the sun sets there at this time of year), fit the activity\'s ' +
      'usual duration and usual time of day, and when too little usable day remains, say so ' +
      'and offer the realistic alternative — a shorter version now, or the better day — ' +
      'instead of stretching the activity into the night. Check the requested date against ' +
      'notable annual events you know and mention one when it genuinely fits the weather and ' +
      'plan — e.g. the Perseid meteor shower peaks around 12–13 August, so a clear sky on ' +
      'those nights deserves a stargazing suggestion; seasonal markets, festivals, or ' +
      'holidays get a nod the same way — but never force one in. Treat weather as a safety ' +
      'constraint, not just a preference: strenuous exercise in roughly 30 °C+ heat, ' +
      'thunderstorms, or ice demands a warning and a shifted plan — move workouts to the ' +
      'coolest viable hour among those listed, NEVER the day\'s hottest listed hour, or say ' +
      'the workout belongs early tomorrow morning or indoors; insist on shade and hydration, ' +
      'or say plainly that it is a day to take it easy. Light rain is a comfort issue; heat ' +
      'is a health issue — never trade a health risk to dodge a comfort one. For running & ' +
      'sports, always dress the workout itself in technical athletic gear. Use EXACTLY these ' +
      `markdown sections: ${sections}. Be specific and ` +
      'actionable; tailor every suggestion to the weather and the user profile. ' +
      activitiesContract +
      attractionsContract +
      'On sunny or hot days — summer days above all — "### Tips" must include sun ' +
      'protection: SPF sunscreen (reapplied through the day), sunglasses, and a hat; only a ' +
      'genuinely sunless day skips it. ' +
      'Cold tolerance ' +
      'must shift actual garment weight, not just wording: if the user runs cold, dress them ' +
      'roughly one layer warmer than the raw numbers suggest; if they run warm, dress one ' +
      'layer lighter. Heat tolerance must shift both the heat threshold and the plan: for a ' +
      'user sensitive to heat, treat roughly 27 °C as the strenuous-activity warning line, ' +
      'push plans harder toward the coolest hours, shade, and indoor alternatives, and favor ' +
      'the lightest breathable fabrics; for a user who handles heat well the ~30 °C rule ' +
      'stands, with hydration reminders either way. Never invent place names — ' +
      'only mention places you are confident exist.' +
      ' Never assume the user\'s gender: name gender-neutral garments (t-shirts, trousers, ' +
      'layers, versatile footwear) and never suggest dresses, skirts, blouses, or other gendered ' +
      'items unless the user\'s own words asked for them.',
  };
  const user = {
    role: 'user',
    content:
      `City: ${city.name}, ${city.country}\n${dateLine(day)}\n\n` +
      `Forecast:\n${dayLine(day)}\nHourly:\n${hourlyBlock(day)}\n\n` +
      `My profile:\n${profileBlock(profile)}\n${attractionsBlock(traveling, attractions, includeActivities)}` +
      `${eventsBlock(includeActivities ? events : '')}` +
      `${liveEventsBlock(includeActivities ? liveEvents : [])}\n` +
      (includeActivities
        ? 'What should I wear and what should I do that day?'
        : traveling
          ? 'What should I wear that day, and which attractions are worth my time?'
          : 'What should I wear that day?'),
  };
  return [system, user];
}

export function buildChatMessages({ city, day, profile, traveling, history }) {
  const system = {
    role: 'system',
    content:
      'You are Sunny — the warm, upbeat assistant behind this weather app, in an ongoing chat ' +
      'about the day you already helped plan. Sound human: friendly, direct, a little playful, ' +
      'never robotic and never a weather bulletin. Answer the question the user actually asked ' +
      '— food, sights, logistics, timing, gear, whatever helps — and bring the weather in only ' +
      'when it genuinely changes the answer; not every reply needs a forecast. Reply in ' +
      'English, metric units, under 150 words, in plain markdown (no headings). You have ' +
      'tools — use them instead of guessing: call get_weather before advising about any place ' +
      'or date other than the current context (never guess numbers), and get_attractions when ' +
      'the user asks what to see or do somewhere. Call tools only through the tool-calling ' +
      'interface — never write tool syntax such as <function=…> into your reply text. For hiking questions think regionally: ' +
      'suggest the well-known hiking country near a city — Pohorje above Maribor; the Julian ' +
      'Alps around Kranjska Gora near Bled — and check its weather before recommending. When ' +
      'the user widens their options (accepts a longer drive, more time), suggest concrete ' +
      'named alternatives you are confident exist, and check their weather too. Never invent ' +
      'place names. Forecasts only exist for today through +5 days; if a tool reports an ' +
      'error, relay it briefly and help within what is available.\n\n' +
      `Current context:\nCity: ${city.name}, ${city.country}\n${dateLine(day)}\n` +
      `Forecast: ${dayLine(day)}\nProfile:\n${profileBlock(profile)}\n` +
      `Traveling/tourist: ${traveling ? 'yes' : 'no'}`,
  };
  return [system, ...history];
}
