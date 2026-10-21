// Admin: audit log and full data export (backups).

import { Hono } from 'hono';
import { authenticate, requireRole } from '../auth.ts';
import { ITEM_SELECT, toAudit, toItem, toSale, toUser } from '../db.ts';
import { toBinder } from './binders.ts';
import { nowIso, type AppEnv } from '../env.ts';
import { number } from '../validate.ts';

const admin = new Hono<AppEnv>();
admin.use('*', authenticate, requireRole('admin'));

admin.get('/audit', async (c) => {
  const limit = number(c.req.query('limit') ?? 100, 'limit', { min: 1, max: 500, integer: true })!;
  const before = number(c.req.query('before'), 'before', { optional: true, integer: true });
  const stmt = before
    ? c.env.DB.prepare('SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?').bind(before, limit)
    : c.env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').bind(limit);
  const { results } = await stmt.all();
  return c.json({ entries: results.map(toAudit) });
});

/** Everything except password hashes and sessions, as one JSON document. */
admin.get('/export', async (c) => {
  const [users, items, sales, maps, binders] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM users ORDER BY created_at'),
    c.env.DB.prepare(`${ITEM_SELECT} ORDER BY ci.created_at`),
    c.env.DB.prepare('SELECT * FROM sales ORDER BY sold_on'),
    c.env.DB.prepare('SELECT * FROM pricecharting_map'),
    c.env.DB.prepare('SELECT * FROM binders ORDER BY created_at'),
  ]);
  type Row = Record<string, unknown>;
  return c.json({
    app: 'PokeVault',
    exportedAt: nowIso(),
    users: (users.results as Row[]).map(toUser),
    collection: (items.results as Row[]).map(toItem),
    sales: (sales.results as Row[]).map(toSale),
    priceChartingMatches: maps.results,
    binders: (binders.results as Row[]).map(toBinder),
  });
});

export default admin;
