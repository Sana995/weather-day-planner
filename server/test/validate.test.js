import { describe, it, expect } from 'vitest';
import { parseDate, validateProfile, PROFILE_OPTIONS, validateChatMessages, validateTraveling, validateIncludeActivities } from '../src/validate.js';
import { HttpError } from '../src/errors.js';

describe('parseDate', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(parseDate('2026-08-07')).toBe('2026-08-07');
  });
  it.each(['07-08-2026', '2026-8-7', 'tomorrow', '', undefined, '2026-02-30'])(
    'rejects %s with 400', (bad) => {
      try {
        parseDate(bad);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect(err.status).toBe(400);
      }
    });
});

describe('validateProfile', () => {
  it('returns defaults when profile is missing', () => {
    expect(validateProfile(undefined)).toEqual({
      activity: 'everyday', coldTolerance: 'average', heatTolerance: 'average',
    });
  });
  it('returns defaults when profile is null', () => {
    expect(validateProfile(null)).toEqual({
      activity: 'everyday', coldTolerance: 'average', heatTolerance: 'average',
    });
  });
  it('passes through valid values', () => {
    const p = { activity: 'hiking', coldTolerance: 'runs cold', heatTolerance: 'sensitive to heat' };
    expect(validateProfile(p)).toEqual(p);
  });
  it('rejects unknown values with 400', () => {
    expect(() => validateProfile({ activity: 'skydiving' })).toThrowError(HttpError);
  });
  it('rejects a non-object profile (e.g. a bare string) with 400', () => {
    try {
      validateProfile('nonsense');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(400);
    }
  });
  it('exposes options used by prompts and docs', () => {
    expect(PROFILE_OPTIONS.activity).toContain('tourism');
    expect(PROFILE_OPTIONS.coldTolerance).toHaveLength(3);
    expect(PROFILE_OPTIONS.heatTolerance).toHaveLength(3);
  });
});

describe('validateChatMessages', () => {
  const user = (content) => ({ role: 'user', content });

  it('accepts alternating turns and strips extra fields', () => {
    const result = validateChatMessages([
      { role: 'assistant', content: 'Wear layers.', junk: true },
      { role: 'user', content: '1.5h driving is also okay' },
    ]);
    expect(result).toEqual([
      { role: 'assistant', content: 'Wear layers.' },
      { role: 'user', content: '1.5h driving is also okay' },
    ]);
  });

  it('rejects a non-array and an empty array', () => {
    expect(() => validateChatMessages('hi')).toThrow(/non-empty array/);
    expect(() => validateChatMessages([])).toThrow(/non-empty array/);
  });

  it('rejects more than 20 turns', () => {
    const many = Array.from({ length: 21 }, () => user('hi'));
    expect(() => validateChatMessages(many)).toThrow(/20/);
  });

  it('rejects bad roles, missing content, and blank content', () => {
    expect(() => validateChatMessages([{ role: 'system', content: 'x' }])).toThrow(/role/);
    expect(() => validateChatMessages([{ role: 'user' }])).toThrow(/content/);
    expect(() => validateChatMessages([user('   ')])).toThrow(/content/);
  });

  it('rejects content over 2000 chars', () => {
    expect(() => validateChatMessages([user('x'.repeat(2001))])).toThrow(/2000/);
  });

  it('rejects a history that does not end with a user turn', () => {
    expect(() => validateChatMessages([{ role: 'assistant', content: 'hi' }])).toThrow(/last message/i);
  });
});

describe('validateIncludeActivities', () => {
  it('defaults null/undefined to true and passes booleans through', () => {
    expect(validateIncludeActivities(undefined)).toBe(true);
    expect(validateIncludeActivities(null)).toBe(true);
    expect(validateIncludeActivities(true)).toBe(true);
    expect(validateIncludeActivities(false)).toBe(false);
  });

  it('rejects non-boolean values', () => {
    expect(() => validateIncludeActivities('yes')).toThrow(/includeActivities/);
    expect(() => validateIncludeActivities(1)).toThrow(/boolean/);
  });
});

describe('validateTraveling', () => {
  it('defaults null/undefined to false and passes booleans through', () => {
    expect(validateTraveling(undefined)).toBe(false);
    expect(validateTraveling(null)).toBe(false);
    expect(validateTraveling(true)).toBe(true);
    expect(validateTraveling(false)).toBe(false);
  });

  it('rejects non-boolean values', () => {
    expect(() => validateTraveling('yes')).toThrow(/boolean/);
    expect(() => validateTraveling(1)).toThrow(/boolean/);
  });
});
