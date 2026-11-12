// The sales history: copies sold from the collection (selling is POST /api/collection/:id/sell).
// Everyone can see it; editors undo a sale, which puts its copies back.

import { Hono } from 'hono';
import { authenticate, requireRole } from '../auth.ts';
import { auditStmt, getItem, toSold } from '../db.ts';
import { HttpError, nowIso, type AppEnv } from '../env.ts';
import { recomputeValues } from '../prices.ts';

const sold = new Hono<AppEnv>();
sold.use('*', authenticate, requireRole('viewer'));

sold.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM sold_items ORDER BY sold_on DESC, created_at DESC').all();
  return c.json({ sold: results.map(toSold) });
});

/**
 * Undoes a sale: it leaves the history (with the sale logged for the card's value), and its copies
 * go back to the entry they came from, if it still exists. `restored` says whether they did.
 */
sold.delete('/:id', requireRole('editor'), async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM sold_items WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) throw new HttpError(404, 'That sale is no longer in the history');
  const s = toSold(row);
  const item = s.itemId ? await getItem(c.env, s.itemId) : null;
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sold_items WHERE id = ?').bind(s.id),
    ...(s.saleId ? [c.env.DB.prepare('DELETE FROM sales WHERE id = ?').bind(s.saleId)] : []),
    ...(!item
      ? []
      : s.emptied && item.deletedAt
        ? // Its last copies: the entry comes back as it was, those that were for sale on sale again
          [
            c.env.DB.prepare(
              'UPDATE collection_items SET deleted_at = NULL, deleted_by = NULL, for_sale = MIN(quantity, for_sale + ?), updated_at = ? WHERE id = ?',
            ).bind(s.fromSale, now, item.id),
          ]
        : [
            c.env.DB.prepare(
              'UPDATE collection_items SET quantity = MIN(999, quantity + ?), for_sale = MIN(999, quantity + ?, for_sale + ?), updated_at = ? WHERE id = ?',
            ).bind(s.quantity, s.quantity, s.fromSale, now, item.id),
          ]),
    auditStmt(c.env, c.get('user'), 'unsell', 'item', s.itemId, {
      card: `${s.name} · ${s.setName} #${s.number}`,
      quantity: s.quantity,
      price: s.price,
      currency: s.currency,
      soldOn: s.soldOn,
      restored: !!item,
    }),
  ]);
  await recomputeValues(c.env, s.cardId);
  return c.json({ ok: true, restored: !!item, item: item ? await getItem(c.env, item.id) : null });
});

export default sold;
