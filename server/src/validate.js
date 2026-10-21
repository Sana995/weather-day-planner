import { PROFILE_OPTIONS, DEFAULT_PROFILE } from '@weather/shared';
import { HttpError } from './errors.js';

// Re-export so server code and tests keep one import site for profile enums.
export { PROFILE_OPTIONS };

export function parseDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new HttpError(400, `date must be YYYY-MM-DD, got "${str}"`);
  }
  // Round-trip check catches impossible dates like 2026-02-30
  const d = new Date(`${str}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== str) {
    throw new HttpError(400, `"${str}" is not a real calendar date`);
  }
  return str;
}

export function validateProfile(profile) {
  // null/undefined mean "no profile supplied" and fall back to defaults below;
  // anything else that isn't an object (a bare string or number) is malformed input.
  if (profile !== null && profile !== undefined && typeof profile !== 'object') {
    throw new HttpError(400, 'profile must be an object');
  }
  profile = profile ?? {};
  const result = {};
  for (const [field, allowed] of Object.entries(PROFILE_OPTIONS)) {
    const value = profile[field] ?? DEFAULT_PROFILE[field];
    if (!allowed.includes(value)) {
      throw new HttpError(400, `profile.${field} must be one of: ${allowed.join(', ')}`);
    }
    result[field] = value;
  }
  return result;
}

const CHAT_MAX_TURNS = 20;
const CHAT_MAX_CHARS = 2000;

export function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpError(400, 'messages must be a non-empty array');
  }
  if (messages.length > CHAT_MAX_TURNS) {
    throw new HttpError(400, `messages cannot exceed ${CHAT_MAX_TURNS} turns`);
  }
  for (const m of messages) {
    if (!m || typeof m !== 'object' || !['user', 'assistant'].includes(m.role)) {
      throw new HttpError(400, 'each message needs role "user" or "assistant"');
    }
    if (typeof m.content !== 'string' || !m.content.trim()) {
      throw new HttpError(400, 'each message needs non-empty string content');
    }
    if (m.content.length > CHAT_MAX_CHARS) {
      throw new HttpError(400, `message content cannot exceed ${CHAT_MAX_CHARS} characters`);
    }
  }
  if (messages[messages.length - 1].role !== 'user') {
    throw new HttpError(400, 'the last message must be from the user');
  }
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export function validateIncludeActivities(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'boolean') throw new HttpError(400, 'includeActivities must be a boolean');
  return value;
}

export function validateTraveling(value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new HttpError(400, 'traveling must be a boolean');
  return value;
}
