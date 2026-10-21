# Product

## Platform

web

## Users

Primary user: a person deciding what to wear and what to do, in the ten
minutes before they leave — standing at home, phone or laptop, deciding on
today's (or a near-term day's) outfit and what is worth doing outdoors.

It is a short, low-patience session with a single decision at the end. The
user already knows their own city; what they do not know is what the forecast
*means for them*.

## Product Purpose

Turn a live forecast into personalized, immediately actionable advice. Success
is the user closing the tab knowing exactly what to wear and what to do —
without reading a forecast table and interpreting it themselves.

## Positioning

The mechanism a plain weather app cannot copy: the forecast is *grounded input
to an LLM*, not the output. Real OpenWeatherMap 3-hour forecast data for the
exact city and date, plus the user's structured profile (activity, cold
tolerance, heat tolerance), plus — in traveling mode — real nearby points of interest
from Geoapify and travel-guide notes from Wikivoyage, are composed into a
prompt whose answer is written for one person on one day. A weather app shows
19 °C; this product says what 19 °C with 90% rain means for someone who runs
cold and is going hiking.

## Operating Context

- One flow, one shell: **Day recommendation** — city + single date → weather
  summary + streamed advice, with **Sunny**, the follow-up chat assistant,
  underneath the finished answer for everything the fixed sections can't cover.
- The answer **streams token by token over SSE** and is rendered as markdown as
  it arrives. Waiting-while-text-appears is a first-class state of this product,
  not an edge case.
- Day mode returns a factual weather summary *before* the advice: min/max temp,
  description, precipitation probability, max wind, and 3-hourly entries.
- Advice arrives in fixed markdown sections: `### Outfit`, `### Activities`
  (the adapted plan in prose, then concrete ideas and attractions as a
  bullet list — guide-mentioned festivals included as "worth checking"
  bullets, season-filtered, never invented one-offs), `### Tips`.
- Sunny is a character, not a template: warm, human, tool-using. It answers
  what was asked — weather enters a reply only when it changes the answer —
  and calls `get_weather` / `get_attractions` for real data mid-conversation.

## Capabilities and Constraints

- **Forecast horizon is today → +5 days, hard.** This is exactly what
  OpenWeatherMap's free "5 day / 3 hour forecast" plan exposes. Out-of-window
  dates fail fast with a 404 rather than returning wrong data. The date pickers
  carry `min`/`max` to match.
- Profile fields are backed by one shared enum (`shared/src/profile.js`) used by
  both client UI and server validation: activity (everyday, office, running &
  sports, hiking, outdoors, tourism), cold tolerance (runs cold, average, runs
  warm), heat tolerance (sensitive to heat, average, handles heat well).
  Option text is product truth. Hiking is deliberately separate from outdoors:
  a hiking answer must reach for the real hiking country near the city
  (Pohorje above Maribor; the Julian Alps around Kranjska Gora near Bled),
  not just the city itself.
- Failure is normal and must be legible: city not found, out-of-window date,
  upstream/LLM errors all surface inline as text the user can act on.
- POI grounding and live event listings each degrade silently to nothing
  when their API key is absent.
- Stack is fixed and not open for redesign: React 19 + Vite, plain CSS in
  `client/src/styles.css`, `react-markdown` for the answer. No new JS
  dependencies, no CSS frameworks.

## Brand Commitments

- Product name: **Personal Weather Assistant** (the `<h1>`, verbatim).
- Assistant name: **Sunny** — the chat card is titled "Chat with Sunny", and
  the assistant speaks as Sunny in chat replies and tool status lines.
- Control labels and field labels are fixed by the product's test contract:
  "Get recommendations", City, Date, Activity, Cold tolerance, Heat tolerance,
  "Include activity ideas", "Include local attractions"; city placeholder
  "e.g. Zagreb".

## Evidence on Hand

Real, live data: OpenWeatherMap forecast, optional Geoapify POIs and
Wikivoyage guide notes in traveling mode, a real LLM completion. No
testimonials, customers, benchmarks, pricing, or usage numbers exist for this
product — none may be fabricated on any surface.

## Product Principles

1. **The forecast is evidence for a decision, not the destination.** Numbers
   earn their place by supporting the advice; the advice is the product.
2. **One decision per session.** Everything on screen serves getting to it
   faster.
3. **Honesty about limits.** The 5-day horizon and every failure are stated
   plainly, never hidden or smoothed over.
4. **The wait is part of the product.** Streaming is designed for, not
   apologized for.
5. **Personal means structurally personal.** The profile is an input to the
   answer, not a preference panel.

## Accessibility & Inclusion

No user-specific standard was established. Baseline obligations hold: labelled
controls, visible focus, sufficient contrast, respect for
`prefers-reduced-motion`, and errors conveyed as text rather than color alone.
