// Third-party text (SearchApi listings, Wikivoyage guide notes, Geoapify place
// names) is data about places and events, never instructions. Everything the
// web hands us goes through cleanText before it can reach a prompt: one line,
// no markup, no sentence that talks to the model, and a length cap. The
// prompts then put it inside <external_data> blocks (see prompts.js).

// Sentences aimed at an AI's instructions or role rather than describing a
// place. Deliberately narrow: travel text says "ignore the touts" and "act
// fast", and a false positive costs a whole sentence of real guide text.
const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b[^.!?]{0,40}\b(instructions?|prompts?|rules|guidelines)\b/i,
  /\b(system|developer)\s+(prompt|message|instructions?)\b/i,
  /(^|[\s"'([])(system|assistant|developer)\s*:/i,
  /\byou are (now|no longer)\b/i,
  /\b(new|updated) instructions?\b/i,
  /\bfrom now on,? (you|reply|respond|answer|always|only)\b/i,
  /<\|[^|>]*\|>|\[\/?INST\]|<<\/?SYS>>/i,
];

export function isInstructionLike(sentence) {
  return INSTRUCTION_PATTERNS.some((re) => re.test(sentence));
}

// Control characters, zero-width characters and bidi overrides can hide text
// from a human reader while the model still sees it.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

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
  return kept.length > maxChars ? `${kept.slice(0, maxChars - 1).trimEnd()}…` : kept;
}
