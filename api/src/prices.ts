// Card cache, price refreshes, price history and item valuations.

import type { CardInfo, PriceRefreshResponse, PriceRow } from '../../shared/types.ts';
import { valueItem } from '../../shared/values.ts';
import { toItem, toPrice, toSale } from './db.ts';
import { HttpError, nowIso, todayIso, type Env } from './env.ts';
import { getRates, homeCurrency } from './fx.ts';
import { findProduct, pcProduct, productPrices } from './pricecharting.ts';
import {
  extractPrices,
  fetchTcgdexCard,
  fetchTcgdexSet,
  normalizeCard,
  reportedSources,
  type TcgdexSetInfo,
} from './tcgdex.ts';

const CARD_TTL_MS = 7 * 86_400_000;
const SET_TTL_MS = 30 * 86_400_000;
export const PRICE_TTL_MS = 20 * 3_600_000;
/** When the app opens, prices older than this are fetched again (TCGdex updates them about daily). */
export const ON_OPEN_TTL_MS = 6 * 3_600_000;
/** A card whose last refresh failed (TCGdex has short outages) is tried again after this. */
const RETRY_FAILED_MS = 30 * 60_000;

async function cached<T>(env: Env, key: string, maxAgeMs: number): Promise<{ data: T; fresh: boolean } | null> {
  const row = await env.DB.prepare('SELECT data, fetched_at FROM card_cache WHERE card_id = ?')
    .bind(key)
    .first<{ data: string; fetched_at: string }>();
  if (!row) return null;
  return { data: JSON.parse(row.data) as T, fresh: Date.now() - Date.parse(row.fetched_at) < maxAgeMs };
}

function cacheStmt(env: Env, key: string, data: unknown): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO card_cache (card_id, data, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
  ).bind(key, JSON.stringify(data), nowIso());
}

async function getSetInfo(env: Env, setId: string): Promise<TcgdexSetInfo | null> {
  const hit = await cached<TcgdexSetInfo>(env, `set:${setId}`, SET_TTL_MS);
  if (hit?.fresh) return hit.data;
  try {
    const info = await fetchTcgdexSet(env, setId);
    if (info) await cacheStmt(env, `set:${setId}`, info).run();
    return info ?? hit?.data ?? null;
  } catch {
    return hit?.data ?? null;
  }
}

/** Bumped when card details are worked out differently, so cached ones are fetched again. */
const CARD_CACHE_VERSION = 2; // 2: printings TCGdex only guessed are left open

type CachedCard = CardInfo & { cacheVersion?: number };

/** Card details from our cache, fetched from TCGdex when missing or a week old. */
export async function getCard(env: Env, cardId: string): Promise<CardInfo> {
  const hit = await cached<CachedCard>(env, cardId, CARD_TTL_MS);
  const cachedCard = () => {
    const { cacheVersion: _, ...card } = hit!.data;
    return card;
  };
  if (hit?.fresh && hit.data.cacheVersion === CARD_CACHE_VERSION) return cachedCard();
  try {
    const result = await refreshMarketPrices(env, cardId, !hit);
    return result.card;
  } catch (err) {
    if (hit) return cachedCard(); // stale beats nothing
    throw err;
  }
}

function priceStmts(env: Env, cardId: string, rows: PriceRow[]): D1PreparedStatement[] {
  const day = todayIso();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO card_prices (card_id, source, variant, grade_key, market, low, mid, high, currency, label, url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(card_id, source, variant, grade_key) DO UPDATE SET
           market = excluded.market, low = excluded.low, mid = excluded.mid, high = excluded.high,
           currency = excluded.currency, label = excluded.label, url = excluded.url, updated_at = excluded.updated_at`,
      ).bind(cardId, r.source, r.variant, r.gradeKey, r.market, r.low, r.mid, r.high, r.currency, r.label, r.url, r.updatedAt),
    );
    if (r.market !== null) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO price_history (card_id, day, source, variant, grade_key, price) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(card_id, source, variant, grade_key, day) DO UPDATE SET price = excluded.price`,
        ).bind(cardId, day, r.source, r.variant, r.gradeKey, r.market),
      );
    }
  }
  return stmts;
}

/**
 * Re-fetches card details + TCGplayer/Cardmarket prices: one TCGdex request, or up to three for a
 * card's `first` prices when TCGplayer's are missing (TCGdex leaves them out of some responses), so
 * it isn't valued from Cardmarket until its next refresh.
 */
export async function refreshMarketPrices(env: Env, cardId: string, first = false): Promise<{ card: CardInfo; rows: PriceRow[] }> {
  let raw = await fetchTcgdexCard(env, cardId);
  if (!raw) throw new HttpError(404, `Card ${cardId} was not found`);
  for (let again = 0; first && again < 2 && !reportedSources(raw).includes('tcgplayer'); again++) {
    raw = (await fetchTcgdexCard(env, cardId).catch(() => null)) ?? raw; // a failed retry keeps the answer we have
  }
  const set = await getSetInfo(env, raw.set.id);
  const card = normalizeCard(raw, set);
  const now = nowIso();
  const rows = extractPrices(raw, now);
  await env.DB.batch([
    cacheStmt(env, cardId, { ...card, cacheVersion: CARD_CACHE_VERSION }),
    // Replace each source's rows with what it reports now (dropping printings it no longer lists).
    // A source missing from the response keeps the prices we had.
    ...reportedSources(raw).map((source) =>
      env.DB.prepare('DELETE FROM card_prices WHERE card_id = ? AND source = ?').bind(cardId, source),
    ),
    ...priceStmts(env, cardId, rows),
    env.DB.prepare(
      `INSERT INTO price_refresh (card_id, refreshed_at, status, message) VALUES (?, ?, 'ok', NULL)
       ON CONFLICT(card_id) DO UPDATE SET refreshed_at = excluded.refreshed_at, status = 'ok', message = NULL`,
    ).bind(cardId, now),
  ]);
  return { card, rows };
}

/** Graded price points for the given printings (only when a PriceCharting token is configured). */
export async function refreshPriceCharting(env: Env, card: CardInfo, variants: string[]): Promise<string | null> {
  const token = env.PRICECHARTING_TOKEN;
  if (!token || !variants.length) return null;
  const notes: string[] = [];
  for (const variant of [...new Set(variants)]) {
    try {
      let map = await env.DB.prepare('SELECT product_id FROM pricecharting_map WHERE card_id = ? AND variant = ?')
        .bind(card.id, variant)
        .first<{ product_id: string }>();
      let product = null;
      if (!map) {
        product = await findProduct(token, card, variant);
        if (!product) {
          notes.push(`No PriceCharting match for the ${variant} printing`);
          continue;
        }
        await env.DB.prepare(
          `INSERT OR REPLACE INTO pricecharting_map (card_id, variant, product_id, product_name, console_name, manual, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
        )
          .bind(card.id, variant, String(product.id), product['product-name'], product['console-name'], nowIso())
          .run();
        map = { product_id: String(product.id) };
      }
      // Search results don't include prices; fetch the product itself.
      product = await pcProduct(token, map.product_id);
      const rows = productPrices(product, card, variant, nowIso());
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM card_prices WHERE card_id = ? AND source = 'pricecharting' AND variant = ?`).bind(
          card.id,
          variant,
        ),
        ...priceStmts(env, card.id, rows),
      ]);
    } catch (err) {
      notes.push(err instanceof Error ? err.message : String(err));
    }
  }
  const message = notes.length ? notes.join('; ') : null;
  await env.DB.prepare('UPDATE price_refresh SET message = ? WHERE card_id = ?').bind(message, card.id).run();
  return message;
}

/** Printings of this card that are in the collection (for PriceCharting lookups). */
export async function ownedVariants(env: Env, cardId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT variant FROM collection_items WHERE card_id = ? AND deleted_at IS NULL',
  )
    .bind(cardId)
    .all<{ variant: string }>();
  return results.map((r) => r.variant);
}

/** Full refresh: market prices, then PriceCharting for owned printings, then item values. */
export async function refreshCard(env: Env, cardId: string, extraVariants: string[] = []): Promise<void> {
  try {
    const { card } = await refreshMarketPrices(env, cardId);
    await refreshPriceCharting(env, card, [...(await ownedVariants(env, cardId)), ...extraVariants]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      `INSERT INTO price_refresh (card_id, refreshed_at, status, message) VALUES (?, ?, 'error', ?)
       ON CONFLICT(card_id) DO UPDATE SET refreshed_at = excluded.refreshed_at, status = 'error', message = excluded.message`,
    )
      .bind(cardId, nowIso(), message)
      .run();
    throw err;
  } finally {
    await recomputeValues(env, cardId);
  }
}

export async function pricesAreStale(env: Env, cardId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT refreshed_at FROM price_refresh WHERE card_id = ?')
    .bind(cardId)
    .first<{ refreshed_at: string }>();
  return !row || Date.now() - Date.parse(row.refreshed_at) > PRICE_TTL_MS;
}

/** Stores each copy's current value so the collection list is a single cheap query. */
export async function recomputeValues(env: Env, cardId: string): Promise<void> {
  const [items, prices, sales] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM collection_items WHERE card_id = ?').bind(cardId),
    env.DB.prepare('SELECT * FROM card_prices WHERE card_id = ?').bind(cardId),
    env.DB.prepare('SELECT * FROM sales WHERE card_id = ?').bind(cardId),
  ]);
  const itemRows = (items.results as Record<string, unknown>[]).map(toItem);
  if (!itemRows.length) return;
  const priceRows = (prices.results as Record<string, unknown>[]).map(toPrice);
  const saleRows = (sales.results as Record<string, unknown>[]).map(toSale);
  const ctx = { currency: homeCurrency(env), fx: await getRates(env) };
  const now = nowIso();
  await env.DB.batch(
    itemRows.map((item) => {
      const v = valueItem(item, priceRows, saleRows, ctx);
      return env.DB.prepare(
        `UPDATE collection_items SET value = ?, value_currency = ?, value_source = ?, value_detail = ?, value_updated_at = ?
          WHERE id = ?`,
      ).bind(v.unit, v.currency, v.source, v.detail, now, item.id);
    }),
  );
}

/**
 * Refreshes the collection's cards whose prices are older than `maxAgeMs`, stalest first, as many
 * as one run can: the free plan allows 50 outbound requests per run (one per card, plus the
 * occasional set lookup and the exchange-rate fetch).
 */
export async function refreshStalePrices(env: Env, maxAgeMs: number): Promise<PriceRefreshResponse> {
  await getRates(env); // once up front (and kept current even on quiet days), not by every card at once
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const failedCutoff = new Date(Date.now() - Math.min(maxAgeMs, RETRY_FAILED_MS)).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT ci.card_id, MIN(pr.refreshed_at) AS refreshed_at
       FROM collection_items ci LEFT JOIN price_refresh pr ON pr.card_id = ci.card_id
      WHERE ci.deleted_at IS NULL
        AND (pr.refreshed_at IS NULL OR pr.refreshed_at < ? OR (pr.status = 'error' AND pr.refreshed_at < ?))
      GROUP BY ci.card_id
      ORDER BY refreshed_at ASC`,
  )
    .bind(cutoff, failedCutoff)
    .all<{ card_id: string }>();
  const batch = results.slice(0, env.PRICECHARTING_TOKEN ? 12 : 35);
  let failed = 0;
  // A few at a time: much quicker than one by one, and still gentle on TCGdex.
  for (let i = 0; i < batch.length; i += 4) {
    await Promise.all(
      batch.slice(i, i + 4).map(({ card_id }) =>
        refreshCard(env, card_id).catch((err) => {
          failed++;
          console.warn(`Price refresh failed for ${card_id}:`, err);
        }),
      ),
    );
  }
  return { refreshed: batch.length - failed, failed, remaining: results.length - batch.length };
}

/** Cron: keep every card's prices under a day old even when nobody opens the app. */
export async function scheduledRefresh(env: Env): Promise<void> {
  await refreshStalePrices(env, PRICE_TTL_MS);
}
