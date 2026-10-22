// Binders: the real binders the collection is kept in. Everyone can see them; editors change them.
// Only what goes in each pocket is stored: which pockets are filled comes from the collection.

import { Hono } from 'hono';
import { BINDER_COLOUR_KEYS, MAX_COPIES, MAX_POCKETS, POCKET_SIZES } from '../../../shared/binders.ts';
import type { Binder, BinderCard } from '../../../shared/types.ts';
import { authenticate, requireRole } from '../auth.ts';
import { auditStmt } from '../db.ts';
import { HttpError, nowIso, type AppEnv, type Env } from '../env.ts';
import { cardId as parseCardId, number, oneOf, printing, readJson, text } from '../validate.ts';

const binders = new Hono<AppEnv>();
binders.use('*', authenticate, requireRole('viewer'));

type Row = Record<string, unknown>;

export const toBinder = (r: Row): Binder => ({
  id: r.id as string,
  name: r.name as string,
  pockets: r.pockets as number,
  cards: JSON.parse(r.cards as string) as BinderCard[],
  colour: (r.colour as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

function parseCards(v: unknown): BinderCard[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Cards must be a list');
  const cards = v.map((raw, i): BinderCard => {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, `Card ${i + 1} is invalid`);
    const c = raw as Record<string, unknown>;
    return {
      cardId: parseCardId(c.cardId),
      variant: printing(c.variant ?? 'normal', 'Printing')!,
      copies: number(c.copies ?? 1, 'Copies', { min: 1, max: MAX_COPIES, integer: true })!,
    };
  });
  const pockets = cards.reduce((n, c) => n + c.copies, 0);
  if (pockets > MAX_POCKETS) throw new HttpError(400, `A binder can hold at most ${MAX_POCKETS} cards (this one has ${pockets})`);
  return cards;
}

function parseBinder(body: Record<string, unknown>, current?: Binder) {
  const pick = <K extends keyof Binder>(k: K) => (k in body ? body[k] : current?.[k]);
  return {
    name: text(pick('name'), 'Name', { max: 80 })!,
    pockets: Number(oneOf(String(pick('pockets') ?? 9), POCKET_SIZES.map(String), 'Pockets per page')),
    cards: 'cards' in body ? parseCards(body.cards) : (current?.cards ?? []),
    colour: oneOf(pick('colour'), BINDER_COLOUR_KEYS, 'Colour', { optional: true }),
  };
}

async function loadBinder(env: Env, id: string): Promise<Binder> {
  const row = await env.DB.prepare('SELECT * FROM binders WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new HttpError(404, 'That binder no longer exists');
  return toBinder(row);
}

const summary = (b: { name: string; pockets: number; cards: BinderCard[] }) => ({
  name: b.name,
  pockets: b.pockets,
  cards: b.cards.length,
  copies: b.cards.reduce((n, c) => n + c.copies, 0),
});

/** Shelf order: the ones put in order first, then the rest oldest first. */
const SHELF_ORDER = 'ORDER BY position IS NULL, position, created_at';

async function shelf(env: Env): Promise<Binder[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM binders ${SHELF_ORDER}`).all<Row>();
  return results.map(toBinder);
}

binders.get('/', async (c) => c.json({ binders: await shelf(c.env) }));

/** Puts the binders on the shelf in this order (every binder's id, left to right). */
binders.put('/order', requireRole('editor'), async (c) => {
  const body = await readJson(c.req.raw);
  const current = await shelf(c.env);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new HttpError(400, 'ids must be a list of binder ids');
  const known = new Set(current.map((b) => b.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new HttpError(409, 'The binders changed meanwhile: reload and try again');
  }
  await c.env.DB.batch([
    ...ids.map((id, position) => c.env.DB.prepare('UPDATE binders SET position = ? WHERE id = ?').bind(position, id)),
    auditStmt(c.env, c.get('user'), 'reorder', 'binder', null, { order: ids.map((id) => current.find((b) => b.id === id)!.name) }),
  ]);
  return c.json({ binders: await shelf(c.env) });
});

binders.get('/:id', async (c) => c.json({ binder: await loadBinder(c.env, c.req.param('id')) }));

binders.post('/', requireRole('editor'), async (c) => {
  const b = parseBinder(await readJson(c.req.raw));
  const id = crypto.randomUUID();
  const now = nowIso();
  const user = c.get('user');
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO binders (id, name, pockets, cards, colour, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, (SELECT MAX(position) + 1 FROM binders), ?, ?, ?)`,
    ).bind(id, b.name, b.pockets, JSON.stringify(b.cards), b.colour, user.id, now, now),
    auditStmt(c.env, user, 'add', 'binder', id, summary(b)),
  ]);
  return c.json({ binder: await loadBinder(c.env, id) }, 201);
});

binders.patch('/:id', requireRole('editor'), async (c) => {
  const current = await loadBinder(c.env, c.req.param('id'));
  const b = parseBinder(await readJson(c.req.raw), current);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE binders SET name = ?, pockets = ?, cards = ?, colour = ?, updated_at = ? WHERE id = ?').bind(
      b.name,
      b.pockets,
      JSON.stringify(b.cards),
      b.colour,
      nowIso(),
      current.id,
    ),
    auditStmt(c.env, c.get('user'), 'edit', 'binder', current.id, summary(b)),
  ]);
  return c.json({ binder: await loadBinder(c.env, current.id) });
});

/** Only the binder goes: the cards in the collection stay. */
binders.delete('/:id', requireRole('editor'), async (c) => {
  const b = await loadBinder(c.env, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM binders WHERE id = ?').bind(b.id),
    auditStmt(c.env, c.get('user'), 'delete', 'binder', b.id, summary(b)),
  ]);
  return c.json({ ok: true });
});

export default binders;
