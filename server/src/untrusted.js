// Third-party text (SearchApi listings, Wikivoyage guide notes, Geoapify place
// names) is data about places and events, never instructions. Everything the
// web hands us goes through cleanText before it can reach a prompt: one line,
// no markup, no sentence that talks to the model, and a length cap. The
// prompts then put it inside <external_data> blocks (see prompts.js).

// Sentences aimed at an AI's instructions or role rather than describing a
// place. Deliberately narrow: travel text says "ignore the touts", "don't
// forget the park rules" and "you are now in the Old Town", and a false
// positive costs a whole sentence of real guide text. So the verb must hit
// the instructions directly ("ignore all previous instructions"), and a role
// change needs an article ("you are now a ...").
const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget|override)\s+((all|any|the|your|my|these|those)\s+)?((previous|prior|above|earlier|preceding|system|original)\s+)?(instructions?|prompts?|rules|guidelines)\b/i,
  /\b(system|developer)\s+(prompt|message|instructions?)\b/i,
  /(^|[\s"'([])(system|assistant|developer)\s*:/i,
  /\byou are (now|no longer) (an?|the|my)\b/i,
  /\b(new|updated) instructions?\b/i,
  /\bfrom now on,? (you|reply|respond|answer|always|only)\b/i,
  /<\|[^|>]*\|>|\[\/?INST\]|<<\/?SYS>>/i,
];

export function isInstructionLike(sentence) {
  return INSTRUCTION_PATTERNS.some((re) => re.test(sentence));
}

// Control characters, zero-width characters, bidi overrides and isolates, and
// Unicode tag characters (U+E0000 block, "ASCII smuggling") can hide text from
// a human reader while the model still reads it. Emoji variation selectors
// (U+FE0E/FE0F) stay; the supplementary selectors used for smuggling go.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

export function cleanText(text, maxChars = Infinity) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const kept = flat
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !isInstructionLike(sentence))
    .join(' ')
    // No angle brackets, so nothing can close or fake an <external_data> block.
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // UTF-16 length is never below the code point count, so the cheap check
  // comes first; the cut itself goes by code point, never through an emoji.
  if (kept.length <= maxChars) return kept;
  const chars = Array.from(kept);
  return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join('').trimEnd()}…` : kept;
}
