// Card details + every price point we know (market, graded, logged sales, history).

import { Hono } from 'hono';
import { VARIANTS } from '../../../shared/grading.ts';
import type { CardDetailResponse } from '../../../shared/types.ts';
import { authenticate, requireRole } from '../auth.ts';
import { ITEM_SELECT, auditStmt, toHistory, toItem, toPrice, toSale } from '../db.ts';
import { HttpError, nowIso, type AppEnv, type Env } from '../env.ts';
import { pcProduct, productPrices } from '../pricecharting.ts';
import {
  getCard,
  pricesAreStale,
  recomputeValues,
  refreshCard,
  refreshMarketPrices,
  refreshPriceCharting,
} from '../prices.ts';
import { cardId as parseCardId, oneOf, readJson, requiredText } from '../validate.ts';

const cards = new Hono<AppEnv>();
cards.use('*', authenticate, requireRole('viewer'));

type Row = Record<string, unknown>;

async function cardDetail(env: Env, cardId: string): Promise<CardDetailResponse> {
  const card = await getCard(env, cardId);
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const [prices, sales, history, maps, owned, refresh] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM card_prices WHERE card_id = ?').bind(cardId),
    env.DB.prepare('SELECT * FROM sales WHERE card_id = ? ORDER BY sold_on DESC, created_at DESC').bind(cardId),
    env.DB.prepare('SELECT * FROM price_history WHERE card_id = ? AND day >= ? ORDER BY day').bind(cardId, since),
    env.DB.prepare('SELECT * FROM pricecharting_map WHERE card_id = ?').bind(cardId),
    env.DB.prepare(`${ITEM_SELECT} WHERE ci.card_id = ? AND ci.deleted_at IS NULL ORDER BY ci.created_at`).bind(cardId),
    env.DB.prepare('SELECT * FROM price_refresh WHERE card_id = ?').bind(cardId),
  ]);
  const r = (refresh.results as Row[])[0];
  return {
    card,
    prices: (prices.results as Row[]).map(toPrice),
    sales: (sales.results as Row[]).map(toSale),
    history: (history.results as Row[]).map(toHistory),
    refreshedAt: r ? String(r.refreshed_at) : null,
    refreshMessage: r?.message ? String(r.message) : null,
    providers: { pricecharting: !!env.PRICECHARTING_TOKEN },
    priceCharting: (maps.results as Row[]).map((m) => ({
      variant: String(m.variant),
      productId: String(m.product_id),
      productName: String(m.product_name),
      consoleName: String(m.console_name),
    })),
    owned: (owned.results as Row[]).map(toItem),
  };
}

cards.get('/:cardId', async (c) => {
  const env = c.env;
  const cardId = parseCardId(c.req.param('cardId'));
  if (await pricesAreStale(env, cardId)) {
    const everRefreshed = await env.DB.prepare('SELECT 1 FROM price_refresh WHERE card_id = ?').bind(cardId).first();
    if (everRefreshed) {
      c.executionCtx.waitUntil(refreshCard(env, cardId).catch((err) => console.warn('refresh failed', err)));
    } else {
      // First look at this card: fetch market prices now so the page isn't empty.
      await refreshMarketPrices(env, cardId, true);
      await recomputeValues(env, cardId);
    }
  }
  const detail = await cardDetail(env, cardId);
  // Graded price points for a card nobody owns yet (so they're visible before adding).
  if (env.PRICECHARTING_TOKEN && !detail.priceCharting.length && !detail.prices.some((p) => p.source === 'pricecharting')) {
    const variant = detail.card.variants.find((v) => v !== 'reverse') ?? detail.card.variants[0];
    c.executionCtx.waitUntil(refreshPriceCharting(env, detail.card, [variant]).catch(() => null));
  }
  return c.json(detail);
});

cards.post('/:cardId/refresh', requireRole('editor'), async (c) => {
  const cardId = parseCardId(c.req.param('cardId'));
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const variant = oneOf((body as Record<string, unknown>).variant, VARIANTS, 'Printing', { optional: true });
  await refreshCard(c.env, cardId, variant ? [variant] : []);
  return c.json(await cardDetail(c.env, cardId));
});

/** Correct the PriceCharting match for a printing (paste the product id from pricecharting.com). */
cards.put('/:cardId/pricecharting', requireRole('editor'), async (c) => {
  const token = c.env.PRICECHARTING_TOKEN;
  if (!token) throw new HttpError(400, 'PriceCharting is not configured on the server');
  const cardId = parseCardId(c.req.param('cardId'));
  const body = await readJson(c.req.raw);
  const variant = oneOf(body.variant, VARIANTS, 'Printing')!;
  const productId = requiredText(body.productId, 'PriceCharting product id', { max: 20 });
  if (!/^\d+$/.test(productId)) throw new HttpError(400, 'The PriceCharting product id is a number');
  const card = await getCard(c.env, cardId);
  const product = await pcProduct(token, productId);
  const now = nowIso();
  const rows = productPrices(product, card, variant, now);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR REPLACE INTO pricecharting_map (card_id, variant, product_id, product_name, console_name, manual, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).bind(cardId, variant, productId, product['product-name'], product['console-name'], now),
    c.env.DB.prepare(`DELETE FROM card_prices WHERE card_id = ? AND source = 'pricecharting' AND variant = ?`).bind(
      cardId,
      variant,
    ),
    ...rows.map((r) =>
      c.env.DB.prepare(
        `INSERT INTO card_prices (card_id, source, variant, grade_key, market, low, mid, high, currency, label, url, updated_at)
         VALUES (?, 'pricecharting', ?, ?, ?, NULL, NULL, NULL, 'USD', ?, ?, ?)`,
      ).bind(cardId, variant, r.gradeKey, r.market, r.label, r.url, now),
    ),
    auditStmt(c.env, c.get('user'), 'pricecharting-match', 'card', cardId, {
      variant,
      productId,
      product: product['product-name'],
    }),
  ]);
  await recomputeValues(c.env, cardId);
  return c.json(await cardDetail(c.env, cardId));
});

cards.delete('/:cardId/pricecharting/:variant', requireRole('editor'), async (c) => {
  const cardId = parseCardId(c.req.param('cardId'));
  const variant = oneOf(c.req.param('variant'), VARIANTS, 'Printing')!;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM pricecharting_map WHERE card_id = ? AND variant = ?').bind(cardId, variant),
    c.env.DB.prepare(`DELETE FROM card_prices WHERE card_id = ? AND source = 'pricecharting' AND variant = ?`).bind(
      cardId,
      variant,
    ),
    auditStmt(c.env, c.get('user'), 'pricecharting-unmatch', 'card', cardId, { variant }),
  ]);
  await recomputeValues(c.env, cardId);
  return c.json(await cardDetail(c.env, cardId));
});

export default cards;
