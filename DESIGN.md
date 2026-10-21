---
name: Personal Weather Assistant
description: A calm daylight dashboard — white cards floating on a periwinkle sky.
colors:
  sky-1: "#AEC3F0"
  sky-2: "#C7D4F4"
  sky-3: "#DEE5F8"
  sky-4: "#EDF0FB"
  surface: "#FFFFFF"
  surface-sunk: "#F4F7FE"
  line: "#D9DFEE"
  line-soft: "#E8EDF9"
  ink: "#171E32"
  ink-2: "#39435C"
  slate: "#5A6478"
  slate-soft: "#6D7689"
  accent: "#3B5BC7"
  accent-wash: "#E3EAFB"
  meter-1: "#BED2F8"
  meter-2: "#3B5BC7"
  meter-wash-1: "#E7EEFD"
  meter-wash-2: "#D5E1FB"
  mint: "#DFF3E8"
  mint-ink: "#37734F"
  rose: "#FBE9EC"
  rose-ink: "#9B2F47"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Arial, sans-serif"
    fontSize: "clamp(1.85rem, 1.2rem + 2.2vw, 2.6rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.028em"
  headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Arial, sans-serif"
    fontSize: "clamp(2.6rem, 1.6rem + 4vw, 3.6rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Arial, sans-serif"
    fontSize: "clamp(1.2rem, 1.05rem + 0.6vw, 1.45rem)"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.018em"
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Arial, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "normal"
  chip:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Arial, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  card: "24px"
  inner: "16px"
  field: "13px"
  pill: "999px"
spacing:
  s1: "0.25rem"
  s2: "0.5rem"
  s3: "0.75rem"
  s4: "1rem"
  s5: "1.5rem"
  s6: "2rem"
  s7: "3rem"
  s8: "4rem"
components:
  card-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate}"
    rounded: "{rounded.card}"
    padding: "clamp(1.5rem, 2.2vw, 1.75rem)"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "0.85rem 1.5rem"
    height: "3rem"
    width: "100%"
  button-primary-hover:
    backgroundColor: "#202944"
    textColor: "{colors.surface}"
  button-primary-disabled:
    backgroundColor: "#9BA4B8"
    textColor: "{colors.surface}"
  toggle-segment:
    backgroundColor: "transparent"
    textColor: "{colors.slate}"
    rounded: "{rounded.pill}"
    padding: "0.6rem 1.15rem"
    height: "2.5rem"
  toggle-segment-hover:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.ink}"
  toggle-segment-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  field-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0.6rem 0.8rem"
    height: "2.85rem"
    width: "100%"
  chip-blue:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "0.36rem 0.75rem"
  chip-mint:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.mint-ink}"
    rounded: "{rounded.pill}"
    padding: "0.36rem 0.75rem"
  chip-sky:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "0.36rem 0.75rem"
  chip-profile:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.36rem 0.75rem"
  hourly-tile:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.slate}"
    rounded: "{rounded.inner}"
    padding: "0.75rem"
  error-block:
    backgroundColor: "{colors.rose}"
    textColor: "{colors.rose-ink}"
    rounded: "{rounded.inner}"
    padding: "1rem 1.5rem"
  status-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate}"
    rounded: "{rounded.card}"
    padding: "1rem 1.5rem"
---

# Design System: Personal Weather Assistant

## Overview

**Creative North Star: "Paper on water"**

A periwinkle sky fades to almost-white, and the work floats on it as white
cards. Nothing is pinned, ruled, stamped or printed: surfaces have no borders,
only soft light under them, and the reading is carried by space and weight
rather than by structure. The feel is a wellness dashboard — calm, airy,
scannable in one pass, with the answer as the only thing that raises its voice.

The product's own logic sets the hierarchy. **The advice is the surface; the
numbers support it.** The forecast card states the day in one glance (place,
range, one line of weather, two chips) and then gets out of the way; the advice
card below it gets the reading measure, the largest headings after the masthead,
and the profile that produced it stated across its top.

Structure is carried by **surface and space, not by lines**. There is exactly
one hairline rule in the whole system (under the profile chip row) and one
1px input border; everything else separates because a white card ends and the
sky resumes. Cards never nest — the hourly tiles inside the forecast card are
flat tinted blocks with no shadow of their own, precisely so they do not read
as cards within a card.

Confirmed rejection: the risograph field-sheet this app shipped before —
newsprint grain, fluorescent pink halftones, 4px rules, square corners, a
condensed masthead stretched to the page width. None of its materials survive.
Also refused, on the other side: the dark glass-and-neon weather app. This
world is daylight.

**Key characteristics:**

- One fixed vertical gradient behind everything, with a ribbed sheen in its top band.
- White cards at 24px radius on offset-plus-blur shadows; no borders on surfaces.
- Navy over slate; no pure black anywhere.
- One friendly grotesque at four weights; size and weight do all the emphasis.
- Every action is a pill: navy when primary or active, white when it is a choice.
- Chips are the system's unit of small data: rain, wind, profile, sections.
- Blue gradient fills are reserved for quantities — a rain chance, a progress sweep.
- One authored motion moment (a card settling in) plus three state indicators.
- Every mark is CSS or an inline SVG chevron: no icon font, no emoji, no imagery.

## Colors

A sky, two papers, two inks, and three data colours. The palette is small
enough to hold in one hand, and every colour in it has a job.

### Primary

- **Sky** (`sky-1` → `sky-4`): the page itself. A fixed 4-stop gradient from
  periwinkle `#AEC3F0` at the top through `#C7D4F4` (22%) and `#DEE5F8` (52%)
  to `#EDF0FB` (78%), attached to the viewport so long answers scroll over it
  rather than dragging it along. The top 44vh carries a masked 1px-in-8px white
  ribbing at 20% — a sheen, not a texture.
- **Surface** (`#FFFFFF`): every card, the header chip, the
  status pill. Cards are the only place content lives.
- **Surface sunk** (`#F4F7FE`): the quiet block inside a card — hourly tiles,
  profile chips, code, blockquotes, empty-state chips. Never used for a card.

### Ink

- **Ink** (`#171E32`): headings, numerals, input values, the primary button and
  the active toggle. 16.6:1 on white, 9.4:1 on the top of the sky. No pure black.
- **Ink-2** (`#39435C`): the only ink allowed directly on the sky besides `ink`
  — the tagline and the header chip. 5.6:1 at the darkest point of the gradient.
- **Slate** (`#5A6478`): body copy, labels, the answer's prose. 6.0:1 on white.
- **Slate soft** (`#6D7689`): placeholders only. 4.6:1 on white, which is why it
  is never placed on `surface-sunk` (4.25:1 there).

### Data

- **Accent** (`#3B5BC7`) and **accent wash** (`#E3EAFB`): the neutral chip, the
  ordered-list counters, the caret, the focus wash. 5.0:1 chip ink on chip fill.
- **Meter** (`#BED2F8` → `#3B5BC7`): fills on bars nothing sits on top of — the
  per-slot rain bar, the submit progress sweep.
- **Meter wash** (`#E7EEFD` → `#D5E1FB`): fills that run *behind* a label, held
  light enough that the label keeps 4.56:1 at the deepest end. This is the
  distinction that matters: a fill under text is not the same colour as a bar.
- **Mint** (`#DFF3E8` / `#37734F`): the reassuring chip — wind. The ink is one
  shade under the reference's `#3E7C5B` so 12px text clears 4.5:1.
- **Rose** (`#FBE9EC` / `#9B2F47`): failure, and nothing else.

### Named rules

1. **The sky is never a card and a card is never the sky.** Content sits on
   white; only the masthead, its tagline, and one chip sit on the gradient.
2. **`slate-soft` touches white only.** On any tint it fails the contrast floor.
3. **A fill behind text uses the wash pair.** Bars use the meter pair.
4. **Mint means the reading is comfortable; rose means it failed.** Neither is
   decoration and neither ever appears twice on one card.
5. **No pure black, no pure grey.** Every neutral is mixed toward the navy.

## Typography

One face, four weights, three jobs: 700 for the masthead, 600 for everything
that is a heading or a number, 400–500 for reading and labelling.

`Plus Jakarta Sans` is loaded from Google Fonts (400/500/600/700) with
`system-ui, -apple-system, 'Segoe UI', Arial, sans-serif` behind it. It is
pinned by the design brief; it is not a free choice, and it is the only face in
the system.

### Hierarchy

| Role | Size | Weight | Tracking |
| --- | --- | --- | --- |
| Masthead (`h1`) | `clamp(1.85rem, 1.2rem + 2.2vw, 2.6rem)` | 700 | -0.028em |
| Temperature | `clamp(2.6rem, 1.6rem + 4vw, 3.6rem)` | 600 | -0.03em |
| Answer headings | `clamp(1.2rem, 1.05rem + 0.6vw, 1.45rem)` | 600 | -0.018em |
| Place name | 1.2rem | 600 | -0.015em |
| Card title | 1.1rem | 600 | -0.012em |
| Body / list | 1rem / 1.7 | 400 | normal |
| Label | 0.82rem | 500 | normal |
| Chip | 0.82rem | 600 | normal |
| Chip key | 0.74rem | 500 | normal |

### Named rules

1. **Nothing is uppercase and nothing is tracked out.** Labels are small and
   medium-weight, not tracked capitals; that was the old world's voice.
2. **The temperature sets in proportional figures.** It is the friendly numeral
   of the design, not a column of data — tabular figures set it narrower and
   colder. Everything that *is* a column (slot times, slot temps, chips, date
   inputs) uses `tabular-nums`.
3. **The answer's headings step out on size, not only colour.** They carry the
   product's actual output; if Outfit / Activities / Tips do not separate from
   the prose at a glance, the design has failed its one scanability job.
4. **Prose is capped at 68ch** (`--measure`), applied to paragraphs, lists,
   blockquotes and headings inside the answer.
5. **`text-wrap: balance` on the masthead, `pretty` on the place line.** No
   other text is balanced.

## Layout

- Page: `max-width: 1120px`, centred, padding `clamp(1.5rem, 4vw, 3rem)` top,
  `clamp(1rem, 4vw, 2rem)` sides, `4rem` bottom.
- Header: title block and the forecast-window chip on one flex row, bottom
  aligned, wrapping to two rows when they no longer fit.
- Work area: single column by default, `2rem` under the header; from **62rem** a `23rem + minmax(0,1fr)`
  grid with a `2rem` gap, the request column sticky at `top: 1.5rem`.
- The answer column stacks its blocks with a flat `1.5rem` rhythm.

Three breakpoints, each with a reason:

- **62rem** — the two-column split. Below it the answer would be narrower than
  its own measure. The App's scroll-into-view effect is keyed to `61.999rem` so
  the two never fire at once.
- **40rem** — compact mode: cards lose horizontal padding and the form
  tightens.
- **30rem** — the forecast card's summary becomes a grid, setting the
  description and chips beside the temperature instead of under it.

### Named rules

1. **The request column is 23rem, not narrower.** At 21rem the City and Date
   fields cannot pair, and the fully stacked form pushes its own submit button
   below the fold of a 900px screen.
2. **An odd field in a two-track row takes the whole row.** Three fields never
   leave one stranded beside an empty cell.
3. **The hourly strip scrolls; its tiles never grow.** A day with one 3-hour
   entry left must not become one tile stretched across the card.
4. **Nothing is centred except the page itself.** Text is left-aligned
   everywhere, including empty and error states.

## Elevation & Depth

Depth is light, never a line. Every shadow has both an offset and a blur, and
all four are the same navy at different strengths — there is no second hue in
the depth system and no zero-blur halo anywhere.

### Shadow vocabulary

| Token | Value | Used by |
| --- | --- | --- |
| `card` | `0 1px 2px rgb(23 30 50 / .04), 0 14px 30px -16px rgb(23 30 50 / .20)` | cards, status pill, answer-column error |
| `lift` | `0 2px 6px rgb(23 30 50 / .06), 0 20px 38px -18px rgb(23 30 50 / .28)` | primary button on hover |
| `pill` | `0 1px 2px rgb(23 30 50 / .12), 0 10px 20px -10px rgb(23 30 50 / .45)` | primary button at rest |
| `chip` | `0 1px 2px rgb(23 30 50 / .06), 0 6px 14px -10px rgb(23 30 50 / .35)` | the header chip, which is a surface on the sky |

### Named rules

1. **Only things that float carry a shadow.** Blocks inside a card (hourly
   tiles, profile chips, blockquotes, the in-form error) are tinted, never lifted.
2. **The primary button is the only element that changes elevation on hover** —
   `pill` → `lift` with a 1px rise.
3. **Disabled removes the shadow entirely.** A disabled control does not float.

## Shapes

| Token | Value | Applies to |
| --- | --- | --- |
| `pill` | `999px` | buttons, toggles, chips, meters, the caret |
| `card` | `24px` | cards, the status pill, the answer-column error |
| `inner` | `16px` | hourly tiles, blockquotes, the in-form error |
| `field` | `13px` | inputs and selects |
| — | `999px` (dot) | the answer's bullet dot |

### Named rules

1. **Roundness tracks scale**: the bigger the surface, the larger the radius;
   anything interactive that is not a text field is fully round.
2. **Radius replaces the border.** Only inputs carry a 1px line, because a form
   field must look like something you can type into.
3. **The bullet in an advice list is a real bullet** — a solid `0.45rem`
   accent dot, centred on the first text line. Never a checkbox shape: a box
   promises an interaction the answer does not offer.

## Components

### Buttons

Primary is a full-width navy pill: `3rem` minimum height, 600 weight, no
uppercase, `pill` shadow at rest, a 1px lift and the `lift` shadow on hover,
back to rest on `:active`. Disabled is `#9BA4B8`, flat, `not-allowed`.

### Sunny's badge

The chat assistant, Sunny, gets the palette's one warm accent: a `2rem` round
badge on a gold gradient (`#FFD97A` → `#FFAB54`) carrying a hand-drawn inline
SVG sun in deep amber, with the `chip` shadow. It appears in the chat card's
title row and nowhere else — one character, one warm mark, in an otherwise
cool system.

### Fields

White, 1px `line` border, `field` radius, `2.85rem` min height. Hover deepens
the border to `#C4CDE4`; focus sets it to `ink` and adds a `4px` accent wash
plus the global 2px navy outline. Selects draw their own chevron as an inline
SVG at 1.6 stroke in `slate`. Labels sit `0.35rem` above the control.

### Chips (signature)

The system's unit of small data, in five readings: `chip-blue` (rain),
`chip-mint` (wind), `chip-sky` (the forecast window, on the gradient),
`chip-profile` (the submitted profile), and an untinted variant on
`surface-sunk` for the empty state's section names. All share one shape:
`0.36rem 0.75rem`, fully round, 0.82rem/600, tabular figures, no wrapping.

`chip-meter` adds a fill: an absolutely positioned `::before` at `z-index: -1`
inside an isolated stacking context, `width: calc(var(--pop) * 1%)`, filled with
the meter *wash* so the label survives it.

### Profile chip row (signature)

Three filled pills above the streamed answer — activity, cold tolerance, heat tolerance —
each a small slate key with the submitted value in navy beside it, separated
from the answer by the system's single hairline. It restates what the advice was
written for at the moment it is read. It is presentational: it renders the
profile that was submitted, in the order the form asks for it.

### Forecast card (signature)

Place and date on one line (the date's em dash must never start a line), the
day's range as the largest numeral on the page with a raised `°C`, one line of
description, and two chips. Below it, a horizontally scrolling strip of tinted
tiles — time, temperature, description, and a rain bar: a `-45°` hatched track
with a meter-gradient fill, decorative for the eye and stated in words for a
screen reader.

### The answer (signature)

The product. Headings at the title scale with `2rem` above and `0.75rem` below;
paragraphs and list items at 1rem/1.7 in slate; unordered items get a solid
accent bullet dot, ordered items get a `1.4rem` accent-wash circle with a navy
counter;
`strong` goes navy at 600 with no highlight; `code` and `blockquote` sit on
`surface-sunk`. A rounded accent caret closes the stream while it is running.

### Status, error, empty

- **Status**: a white pill card with three accent dots pulsing on a 0.15s stagger.
- **Error**: rose block, title plus message, the message in `ink` so the text
  carries the meaning rather than the colour. In the answer column it takes the
  card radius and shadow (it floats on the sky); inside a form it stays inset at
  the `inner` radius.
- **Empty**: a card naming what will appear, what the assistant reads, and the
  sections the answer will carry — as chips, so the empty state teaches the
  chip vocabulary before any data arrives.

### Browser surfaces

Selection is `accent-wash` on `ink`. The caret in text fields is `accent`.
`accent-color` themes native controls. The hourly strip's scrollbar is thin,
`#C3CFEA`, fully round, on a transparent track. Focus is a 2px `ink` outline at
2px offset that follows each element's own radius.

### Motion

One authored moment: `rise` — a card fades up 10px over 460ms on the shared
`cubic-bezier(0.16, 1, 0.3, 1)` as it arrives. Everything else is a state
indicator: the caret (1.2s), the status dots (1.2s, staggered), the submit
progress sweep (1.5s). `prefers-reduced-motion: reduce` collapses every duration
to 0.001ms, freezes the caret and dots visible, and removes the button's lift.

## Do's and Don'ts

### Do:

- **Do** put new content on a white card at `card` radius with the `card` shadow.
- **Do** use a chip for any short reading — a value, a state, a name.
- **Do** reach for size and weight before reaching for colour.
- **Do** keep the sky clear: the masthead, its tagline, one chip, and cards.
- **Do** give a number the `headline` treatment only when it is *the* number.
- **Do** state a quantity with a meter fill rather than a second number.
- **Do** check any new tint against the contrast floors recorded in Colors.
- **Do** keep prose at `--measure` and left-aligned.
- **Do** let a new interactive control be a pill.

### Don't:

- **Don't** nest a card inside a card. Blocks inside a card are tinted and flat.
- **Don't** add a border where a radius, a tint, or space will do. The system has
  one hairline rule and one input border, and that is the budget.
- **Don't** introduce a hard offset shadow, a zero-blur halo, or a second shadow
  hue. Depth is navy light with offset and blur.
- **Don't** put `slate-soft` on anything but white, or a meter fill behind text
  without switching to the wash pair.
- **Don't** set anything in uppercase or tracked-out small caps.
- **Don't** add a second display face, or a monospace anywhere but code.
- **Don't** ship an emoji, an icon font, or a glyph standing in for an icon; the
  only drawn marks in the system are the select chevron and Sunny's sun badge.
- **Don't** add a second authored motion moment. `rise` is the arrival; the
  caret, dots and sweep are status, not choreography.
- **Don't** centre text, and don't add a kicker or eyebrow above a heading.
- **Don't** touch `server/` or `shared/` for design work. They are out of bounds.
- **Don't** break the tested DOM contract while restyling. The `<h1>` reads
  "Personal Weather Assistant"; the submit button reads "Get recommendations";
  labels read City, Date, Activity, Cold tolerance, Heat tolerance; the
  checkboxes read "Include activity ideas" and "Include local attractions"; the
  chat card is titled "Chat with Sunny" (aria-label "Chat with Sunny"); the city
  placeholder is "e.g. Zagreb"; date inputs keep their `min`/`max`; profile
  option text comes from `@weather/shared`; the classes `.error` and `.cursor`
  exist; sections keep the aria-labels "Weather summary" and "Recommendation";
  the day description
  stays inside `.weather-summary` while `.hourly` stays **outside** it; and
  `{tempMin}–{tempMax}` stays the direct text of a single element. The client
  suite queries by role, label, and text — restyle freely, but move an element
  out of its tested parent and the suite is the thing that breaks.
