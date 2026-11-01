// Sealed products in the collection (booster boxes, Elite Trainer Boxes, packs…). The app values
// them from the catalogue's sealed.json (Cardmarket's prices). Everyone can see them; editors
// change them.

import { Hono } from 'hono';
import { CURRENCIES } from '../../../shared/currency.ts';
import { SEALED_TYPES } from '../../../shared/sealed.ts';
import type { SealedItem } from '../../../shared/types.ts';
import { authenticate, requireRole } from '../auth.ts';
import { auditStmt } from '../db.ts';
import { HttpError, nowIso, type AppEnv, type Env } from '../env.ts';
import { homeCurrency } from '../fx.ts';
import { isoDate, number, oneOf, readJson, requiredText, text } from '../validate.ts';

const sealed = new Hono<AppEnv>();
sealed.use('*', authenticate, requireRole('viewer'));

/** The most of one product an entry holds */
export const MAX_SEALED_QUANTITY = 999;

type Row = Record<string, unknown>;

export const toSealed = (r: Row): SealedItem => ({
  id: r.id as string,
  productId: r.product_id as number,
  name: r.name as string,
  type: (r.type as string | null) ?? null,
  quantity: r.quantity as number,
  purchasePrice: (r.purchase_price as number | null) ?? null,
  purchaseCurrency: (r.purchase_currency as string | null) ?? null,
  purchaseDate: (r.purchase_date as string | null) ?? null,
  notes: (r.notes as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

/** The details an editor can change (on adding, or later). */
function parseDetails(env: Env, body: Record<string, unknown>, current?: SealedItem) {
  const pick = <K extends keyof SealedItem>(k: K) => (k in body ? body[k] : current?.[k]);
  const purchasePrice = number(pick('purchasePrice'), 'Price paid', { optional: true, min: 0, max: 10_000_000 });
  return {
    quantity: number(pick('quantity') ?? 1, 'Quantity', { min: 1, max: MAX_SEALED_QUANTITY, integer: true })!,
    purchasePrice,
    purchaseCurrency: purchasePrice === null ? null : oneOf(pick('purchaseCurrency') ?? homeCurrency(env), CURRENCIES, 'Currency'),
    purchaseDate: isoDate(pick('purchaseDate'), 'Purchase date', { optional: true }),
    notes: text(pick('notes'), 'Notes', { optional: true, max: 500 }),
  };
}

async function loadSealed(env: Env, id: string): Promise<SealedItem> {
  const row = await env.DB.prepare('SELECT * FROM sealed_items WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new HttpError(404, 'That product is no longer in the collection');
  return toSealed(row);
}

const summary = (s: { productId: number; name: string; quantity: number }) => ({ productId: s.productId, name: s.name, quantity: s.quantity });

sealed.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM sealed_items ORDER BY created_at DESC').all<Row>();
  return c.json({ items: results.map(toSealed) });
});

sealed.post('/', requireRole('editor'), async (c) => {
  const body = await readJson(c.req.raw);
  const productId = number(body.productId, 'Product', { min: 1, max: 2 ** 31 - 1, integer: true })!;
  const name = requiredText(body.name, 'Name', { max: 200 });
  const type = oneOf(body.type, SEALED_TYPES, 'Kind of product', { optional: true });
  const d = parseDetails(c.env, body);
  const id = crypto.randomUUID();
  const now = nowIso();
  const user = c.get('user');
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sealed_items (id, product_id, name, type, quantity, purchase_price, purchase_currency, purchase_date, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, productId, name, type, d.quantity, d.purchasePrice, d.purchaseCurrency, d.purchaseDate, d.notes, user.id, now, now),
    auditStmt(c.env, user, 'add', 'sealed', id, summary({ productId, name, quantity: d.quantity })),
  ]);
  return c.json({ item: await loadSealed(c.env, id) }, 201);
});

sealed.patch('/:id', requireRole('editor'), async (c) => {
  const current = await loadSealed(c.env, c.req.param('id'));
  const d = parseDetails(c.env, await readJson(c.req.raw), current);
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE sealed_items SET quantity = ?, purchase_price = ?, purchase_currency = ?, purchase_date = ?, notes = ?, updated_at = ? WHERE id = ?',
    ).bind(d.quantity, d.purchasePrice, d.purchaseCurrency, d.purchaseDate, d.notes, nowIso(), current.id),
    auditStmt(c.env, c.get('user'), 'edit', 'sealed', current.id, summary({ ...current, ...d })),
  ]);
  return c.json({ item: await loadSealed(c.env, current.id) });
});

sealed.delete('/:id', requireRole('editor'), async (c) => {
  const s = await loadSealed(c.env, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sealed_items WHERE id = ?').bind(s.id),
    auditStmt(c.env, c.get('user'), 'delete', 'sealed', s.id, summary(s)),
  ]);
  return c.json({ ok: true });
});

export default sealed;
