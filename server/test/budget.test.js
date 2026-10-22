import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dailyLimit, hasDailyBudget, takeDailyBudget, _resetDailyBudgets } from '../src/budget.js';

describe('daily budgets', () => {
  beforeEach(() => {
    _resetDailyBudgets();
    delete process.env.SEARCHAPI_DAILY_LIMIT;
    delete process.env.GROQ_DAILY_LIMIT;
  });
  afterEach(() => vi.useRealTimers());

  it('defaults to 20 SearchApi and 300 Groq calls a day', () => {
    expect(dailyLimit('searchapi')).toBe(20);
    expect(dailyLimit('groq')).toBe(300);
  });

  it('takes a non-negative integer from .env, and 0 switches the upstream off', () => {
    process.env.SEARCHAPI_DAILY_LIMIT = '5';
    expect(dailyLimit('searchapi')).toBe(5);
    process.env.GROQ_DAILY_LIMIT = '0';
    expect(dailyLimit('groq')).toBe(0);
    expect(takeDailyBudget('groq')).toBe(false);
  });

  it.each(['', '-3', '2.5', 'lots'])('keeps the default for an invalid value %j', (raw) => {
    process.env.SEARCHAPI_DAILY_LIMIT = raw;
    expect(dailyLimit('searchapi')).toBe(20);
  });

  it('allows exactly the cap, then refuses without counting further', () => {
    process.env.SEARCHAPI_DAILY_LIMIT = '2';
    expect(takeDailyBudget('searchapi')).toBe(true);
    expect(takeDailyBudget('searchapi')).toBe(true);
    expect(hasDailyBudget('searchapi')).toBe(false);
    expect(takeDailyBudget('searchapi')).toBe(false);
  });

  it('keeps each upstream on its own counter', () => {
    process.env.SEARCHAPI_DAILY_LIMIT = '1';
    expect(takeDailyBudget('searchapi')).toBe(true);
    expect(takeDailyBudget('searchapi')).toBe(false);
    expect(takeDailyBudget('groq')).toBe(true);
  });

  it('checking the budget never spends it', () => {
    process.env.GROQ_DAILY_LIMIT = '1';
    expect(hasDailyBudget('groq')).toBe(true);
    expect(hasDailyBudget('groq')).toBe(true);
    expect(takeDailyBudget('groq')).toBe(true);
  });

  it('starts a fresh count at UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T23:59:00Z'));
    process.env.GROQ_DAILY_LIMIT = '1';
    expect(takeDailyBudget('groq')).toBe(true);
    expect(takeDailyBudget('groq')).toBe(false);
    vi.setSystemTime(new Date('2026-10-22T00:00:01Z'));
    expect(takeDailyBudget('groq')).toBe(true);
  });
});
