import { describe, it, expect, vi, afterEach } from 'vitest';
import { rateLimit, clientKey } from '../src/rateLimit.js';
import { HttpError } from '../src/errors.js';

// Drives the middleware with a minimal req/res and reports what it did.
function hit(middleware, ip) {
  const headers = {};
  const res = { set: (name, value) => { headers[name] = value; } };
  let outcome;
  middleware({ ip }, res, (err) => { outcome = err ?? 'next'; });
  return { outcome, headers };
}

describe('rateLimit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lets `limit` requests through, then answers 429 with Retry-After', () => {
    const limiter = rateLimit({ limit: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) expect(hit(limiter, '203.0.113.7').outcome).toBe('next');
    const { outcome, headers } = hit(limiter, '203.0.113.7');
    expect(outcome).toBeInstanceOf(HttpError);
    expect(outcome.status).toBe(429);
    expect(outcome.message).toMatch(/Too many requests/);
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
    expect(Number(headers['Retry-After'])).toBeLessThanOrEqual(60);
  });

  it('counts each client separately', () => {
    const limiter = rateLimit({ limit: 1, windowMs: 60_000 });
    expect(hit(limiter, '203.0.113.7').outcome).toBe('next');
    expect(hit(limiter, '203.0.113.7').outcome).toBeInstanceOf(HttpError);
    expect(hit(limiter, '198.51.100.2').outcome).toBe('next');
  });

  it('opens a fresh window once the old one has passed', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const limiter = rateLimit({ limit: 1, windowMs: 60_000 });
    expect(hit(limiter, '203.0.113.7').outcome).toBe('next');
    now += 59_000;
    const blocked = hit(limiter, '203.0.113.7');
    expect(blocked.outcome).toBeInstanceOf(HttpError);
    expect(blocked.headers['Retry-After']).toBe('1');
    now += 1_000;
    expect(hit(limiter, '203.0.113.7').outcome).toBe('next');
  });

  it('sweeps expired clients once the map is big, at most once per window', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const limiter = rateLimit({ limit: 5, windowMs: 60_000, sweepAt: 3 });
    hit(limiter, '198.51.100.1'); // its window ends at +60s
    now += 59_000;
    hit(limiter, '198.51.100.2');
    hit(limiter, '198.51.100.3');
    hit(limiter, '198.51.100.4'); // 3 tracked: sweeps, but nothing has expired yet
    expect(limiter.trackedClients()).toBe(4);
    now += 2_000; // .1 has expired now...
    hit(limiter, '198.51.100.5'); // ...but this window already had its sweep
    expect(limiter.trackedClients()).toBe(5);
    now += 60_000; // next window: every entry above has expired
    hit(limiter, '198.51.100.6');
    expect(limiter.trackedClients()).toBe(1);
  });

  it('keeps counting a live client through a sweep', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const limiter = rateLimit({ limit: 1, windowMs: 60_000, sweepAt: 2 });
    hit(limiter, '198.51.100.1');
    now += 30_000;
    hit(limiter, '198.51.100.2');
    hit(limiter, '198.51.100.3'); // triggers a sweep: nothing expired
    expect(hit(limiter, '198.51.100.2').outcome).toBeInstanceOf(HttpError);
  });

  it('treats addresses in one IPv6 /64 as one client', () => {
    const limiter = rateLimit({ limit: 1, windowMs: 60_000 });
    expect(hit(limiter, '2001:db8:1:2::aaaa').outcome).toBe('next');
    expect(hit(limiter, '2001:db8:1:2:ffff::1').outcome).toBeInstanceOf(HttpError);
    expect(hit(limiter, '2001:db8:1:3::aaaa').outcome).toBe('next');
  });
});

describe('clientKey', () => {
  it('keeps an IPv4 address as is', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('unwraps IPv4-mapped IPv6', () => {
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('reduces IPv6 to its /64, whatever the notation', () => {
    expect(clientKey('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:DB8:1:2:ab::')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
  });

  it('tolerates a missing address', () => {
    expect(clientKey(undefined)).toBe('');
  });
});
