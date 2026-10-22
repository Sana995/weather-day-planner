// Per-client fixed-window rate limits for the API routes. In memory and per
// process, like the caches; each createApp() gets its own counters.

import net from 'node:net';
import { HttpError } from './errors.js';

// One home connection or phone usually owns a whole IPv6 /64, and rotating
// addresses inside it is free, so IPv6 clients are counted per /64. IPv4
// mapped into IPv6 ("::ffff:1.2.3.4") is just the IPv4 address.
export function clientKey(ip = '') {
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) return ip.slice(7);
  if (!net.isIPv6(ip)) return ip;
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// Expired windows are swept only once this many clients are tracked, so the
// map stays bounded without a timer.
const SWEEP_AT = 10_000;

export function rateLimit({ limit, windowMs }) {
  const hits = new Map(); // client key → { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size >= SWEEP_AT) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }
    const key = clientKey(req.ip);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count <= limit) return next();
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    next(new HttpError(429, `Too many requests. Please try again in ${retryAfter} seconds.`));
  };
}
