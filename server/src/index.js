import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import routes from './routes.js';
import { HttpError } from './errors.js';
import { rateLimit } from './rateLimit.js';

// .env lives at the repo root, one level above server/
dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../.env') });

// Requests per minute per client. The two LLM routes each cost a Groq call
// (plus enrichment lookups), so they get a tight budget; the forecast route
// is cheap and cached, so it gets room for a form being re-submitted.
const RATE_LIMITS = { '/api/recommend': 10, '/api/chat': 10, '/api/weather': 60 };
const RATE_WINDOW_MS = 60 * 1000;

// The chat's own caps (20 messages of 2,000 characters) fit well inside this.
const BODY_LIMIT = '64kb';

// body-parser errors carry their own status: an oversized body is a 413 and
// broken JSON a 400, not a crash worth a 500 and a stack trace.
function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err?.type === 'entity.too.large') return new HttpError(413, 'Request body is too large (limit 64 KB).');
  if (err?.type === 'entity.parse.failed') return new HttpError(400, 'Request body is not valid JSON.');
  return null;
}

export function createApp() {
  const app = express();
  // Behind a reverse proxy every request arrives from the proxy's address;
  // TRUST_PROXY (the number of proxy hops) makes req.ip the real client again,
  // so the per-client limits stay per client.
  const hops = Number(process.env.TRUST_PROXY);
  if (Number.isInteger(hops) && hops > 0) app.set('trust proxy', hops);
  // Limits run before body parsing, so a rejected request costs no parse.
  for (const [route, limit] of Object.entries(RATE_LIMITS)) {
    app.use(route, rateLimit({ limit, windowMs: RATE_WINDOW_MS }));
  }
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(routes);
  // eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
  app.use((err, req, res, next) => {
    const httpError = toHttpError(err);
    const status = httpError ? httpError.status : 500;
    const message = httpError ? httpError.message : 'Internal server error';
    if (status === 500) console.error(err);
    res.status(status).json({ error: message });
  });
  return app;
}

// Start only when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3001;
  createApp().listen(port, () => {
    console.log(`Weather Assistant API listening on http://localhost:${port}`);
  });
}
