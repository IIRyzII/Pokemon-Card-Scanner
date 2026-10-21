// PokéVault API — Cloudflare Worker + D1.
// Routes live under /api; see README.md for the full list.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HttpError, type AppEnv, type Env } from './env.ts';
import { scheduledRefresh } from './prices.ts';
import admin from './routes/admin.ts';
import auth, { API_VERSION } from './routes/auth.ts';
import binders from './routes/binders.ts';
import cards from './routes/cards.ts';
import collection from './routes/collection.ts';
import sales from './routes/sales.ts';
import users from './routes/users.ts';

const app = new Hono<AppEnv>();

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = (c.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((o: string) => o.trim().replace(/\/$/, ''))
        .filter(Boolean);
      return allowed.includes('*') || allowed.includes(origin) ? origin : null;
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
);

app.get('/', (c) => c.json({ name: 'PokéVault API', version: API_VERSION, status: '/api/auth/status' }));
app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/collection', collection);
app.route('/api/cards', cards);
app.route('/api/sales', sales);
app.route('/api/binders', binders);
app.route('/api/admin', admin);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(scheduledRefresh(env));
  },
} satisfies ExportedHandler<Env>;
