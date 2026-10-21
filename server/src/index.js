import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import routes from './routes.js';
import { HttpError } from './errors.js';

// .env lives at the repo root, one level above server/
dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../.env') });

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(routes);
  // eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
  app.use((err, req, res, next) => {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : 'Internal server error';
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
