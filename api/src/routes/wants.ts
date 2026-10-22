// The want list's hand-picked cards (the gaps in the binders are worked out by the app). Everyone
// can see it; editors change it.

import { Hono } from 'hono';
import { CURRENCIES } from '../../../shared/currency.ts';
import { VARIANTS } from '../../../shared/grading.ts';
import type { Want } from '../../../shared/types.ts';
import { DEFAULT_PRIORITY, MAX_WANT_QUANTITY, PRIORITY_VALUES } from '../../../shared/wants.ts';
import { authenticate, requireRole } from '../auth.ts';
import { auditStmt } from '../db.ts';
import { HttpError, nowIso, type AppEnv, type Env } from '../env.ts';
import { homeCurrency } from '../fx.ts';
import { pricesAreStale, refreshMarketPrices } from '../prices.ts';
import { cardId as parseCardId, number, oneOf, readJson, text } from '../validate.ts';

const wants = new Hono<AppEnv>();
wants.use('*', authenticate, requireRole('viewer'));

type Row = Record<string, unknown>;

export const toWant = (r: Row): Want => ({
  id: r.id as string,
  cardId: r.card_id as string,
  variant: r.variant as string,
  quantity: r.quantity as number,
  priority: r.priority as number,
  maxPrice: (r.max_price as number | null) ?? null,
  maxCurrency: (r.max_currency as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

function parseWant(env: Env, body: Record<string, unknown>, current?: Want) {
  const pick = <K extends keyof Want>(k: K) => (k in body ? body[k] : current?.[k]);
  const maxPrice = number(pick('maxPrice'), 'Most you would pay', { optional: true, min: 0, max: 10_000_000 });
  return {
    quantity: number(pick('quantity') ?? 1, 'Copies', { min: 1, max: MAX_WANT_QUANTITY, integer: true })!,
    priority: Number(oneOf(String(pick('priority') ?? DEFAULT_PRIORITY), PRIORITY_VALUES.map(String), 'Priority')),
    maxPrice,
    maxCurrency: maxPrice === null ? null : oneOf(pick('maxCurrency') ?? homeCurrency(env), CURRENCIES, 'Currency'),
    note: text(pick('note'), 'Note', { optional: true, max: 300 }),
  };
}

async function loadWant(env: Env, id: string): Promise<Want> {
  const row = await env.DB.prepare('SELECT * FROM wants WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new HttpError(404, 'That card is no longer on the want list');
  return toWant(row);
}

const summary = (w: { cardId: string; variant: string; quantity: number; priority: number }) => ({
  cardId: w.cardId,
  variant: w.variant,
  quantity: w.quantity,
  priority: w.priority,
});

wants.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM wants ORDER BY created_at').all<Row>();
  return c.json({ wants: results.map(toWant) });
});

/** Puts a card (in one printing) on the want list, or changes it if it's already there. */
wants.post('/', requireRole('editor'), async (c) => {
  const body = await readJson(c.req.raw);
  const cardId = parseCardId(body.cardId);
  const variant = oneOf(body.variant ?? 'normal', VARIANTS, 'Printing')!;
  const row = await c.env.DB.prepare('SELECT * FROM wants WHERE card_id = ? AND variant = ?').bind(cardId, variant).first<Row>();
  const current = row ? toWant(row) : undefined;
  const w = parseWant(c.env, body, current);
  const id = current?.id ?? crypto.randomUUID();
  const now = nowIso();
  const user = c.get('user');
  await c.env.DB.batch([
    current
      ? c.env.DB.prepare(
          'UPDATE wants SET quantity = ?, priority = ?, max_price = ?, max_currency = ?, note = ?, updated_at = ? WHERE id = ?',
        ).bind(w.quantity, w.priority, w.maxPrice, w.maxCurrency, w.note, now, id)
      : c.env.DB.prepare(
          `INSERT INTO wants (id, card_id, variant, quantity, priority, max_price, max_currency, note, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, cardId, variant, w.quantity, w.priority, w.maxPrice, w.maxCurrency, w.note, user.id, now, now),
    auditStmt(c.env, user, current ? 'edit' : 'add', 'want', id, summary({ cardId, variant, ...w })),
  ]);
  // Its prices for each printing, so the list can price the printing wanted (kept fresh hourly after).
  if (!current && (await pricesAreStale(c.env, cardId))) {
    c.executionCtx.waitUntil(refreshMarketPrices(c.env, cardId, true).catch((err) => console.warn('want price refresh failed', err)));
  }
  return c.json({ want: await loadWant(c.env, id), created: !current }, current ? 200 : 201);
});

wants.patch('/:id', requireRole('editor'), async (c) => {
  const current = await loadWant(c.env, c.req.param('id'));
  const w = parseWant(c.env, await readJson(c.req.raw), current);
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE wants SET quantity = ?, priority = ?, max_price = ?, max_currency = ?, note = ?, updated_at = ? WHERE id = ?',
    ).bind(w.quantity, w.priority, w.maxPrice, w.maxCurrency, w.note, nowIso(), current.id),
    auditStmt(c.env, c.get('user'), 'edit', 'want', current.id, summary({ ...current, ...w })),
  ]);
  return c.json({ want: await loadWant(c.env, current.id) });
});

wants.delete('/:id', requireRole('editor'), async (c) => {
  const w = await loadWant(c.env, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM wants WHERE id = ?').bind(w.id),
    auditStmt(c.env, c.get('user'), 'delete', 'want', w.id, summary(w)),
  ]);
  return c.json({ ok: true });
});

export default wants;
