// Daily caps on the paid upstream calls, so a busy day or a script hammering
// the API cannot burn through a key's quota. Counted in memory per process
// and per UTC day, like the caches: a restart resets the count, which is fine
// for a guard on a free tier rather than a billing ledger.

const LIMITS = {
  // SearchApi's sign-up credit is a fixed pool and one lookup costs one or
  // two requests, so the default keeps a handful of lookups a day.
  searchapi: { env: 'SEARCHAPI_DAILY_LIMIT', fallback: 20 },
  // Every Groq completion counts, including each round of a chat tool loop.
  groq: { env: 'GROQ_DAILY_LIMIT', fallback: 300 },
};

const used = new Map(); // name → { day, count }

export function _resetDailyBudgets() {
  used.clear();
}

// A non-negative integer from .env wins; 0 switches the upstream off.
// Anything else (empty, negative, "lots") keeps the default.
export function dailyLimit(name) {
  const { env, fallback } = LIMITS[name];
  const raw = process.env[env];
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : fallback;
}

const today = () => new Date().toISOString().slice(0, 10);

function usedToday(name) {
  const entry = used.get(name);
  return entry?.day === today() ? entry.count : 0;
}

export function hasDailyBudget(name) {
  return usedToday(name) < dailyLimit(name);
}

// Counts one call against today's cap. Returns false, counting nothing, once
// the cap is reached, so the caller skips the upstream call.
export function takeDailyBudget(name) {
  const count = usedToday(name);
  if (count >= dailyLimit(name)) return false;
  used.set(name, { day: today(), count: count + 1 });
  return true;
}

// Gives back a call the upstream refused outright (an HTTP error it does not
// bill), so a typo'd key cannot use up the day before it is fixed.
export function refundDailyBudget(name) {
  const count = usedToday(name);
  if (count > 0) used.set(name, { day: today(), count: count - 1 });
}
