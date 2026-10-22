// The shared collection: viewers read, editors change, admins purge the trash.

import { Hono } from 'hono';
import { entryFor, planMerges } from '../../../shared/copies.ts';
import { CURRENCIES, convert } from '../../../shared/currency.ts';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from '../../../shared/languages.ts';
import { CONDITIONS, GRADERS, GRADE_LABELS, isGrade } from '../../../shared/grading.ts';
import { basePrinting } from '../../../shared/printings.ts';
import {
  hasRole,
  type CardInfo,
  type CollectionResponse,
  type ItemFields,
  type MergeResponse,
  type PriceRefreshResponse,
} from '../../../shared/types.ts';
import { authenticate, requireRole } from '../auth.ts';
import { ITEM_SELECT, auditStmt, getItem, toItem } from '../db.ts';
import { HttpError, nowIso, type AppEnv, type Env } from '../env.ts';
import { getRates, homeCurrency } from '../fx.ts';
import {
  ON_OPEN_TTL_MS,
  getCard,
  pricesAreStale,
  recomputeValues,
  refreshMarketPrices,
  refreshPriceCharting,
  refreshStalePrices,
} from '../prices.ts';
import { cardId as parseCardId, isoDate, number, oneOf, printing, readJson, text } from '../validate.ts';

/** TCGdex's printing flags only have the plain printings: a special one (a cosmos holo) is built on one the card comes in. */
const comesIn = (card: CardInfo, variant: string) => card.variants.includes(basePrinting(variant));

const collection = new Hono<AppEnv>();
collection.use('*', authenticate, requireRole('viewer'));

/** Validates item fields; for updates, missing fields keep their current values. */
function parseItemFields(body: Record<string, unknown>, home: string, current?: ItemFields): ItemFields {
  const pick = (k: keyof ItemFields) => (k in body ? body[k] : current?.[k]);
  const variant = printing(pick('variant') ?? 'normal', 'Printing')!;
  const grader = oneOf(pick('grader') ?? 'RAW', GRADERS, 'Grader')!;
  const graded = grader !== 'RAW';
  let grade: number | null = null;
  let gradeLabel: string | null = null;
  if (graded) {
    grade = number(pick('grade'), 'Grade', { min: 1, max: 10 });
    if (!isGrade(grade)) throw new HttpError(400, 'Grade must be 1–10 in half steps');
    if (grade === 10) gradeLabel = oneOf(pick('gradeLabel'), GRADE_LABELS[grader] ?? [], 'Grade label', { optional: true });
  }
  return {
    variant,
    language: oneOf(pick('language') ?? DEFAULT_LANGUAGE, LANGUAGE_CODES, 'Language')!,
    grader,
    grade,
    gradeLabel,
    condition: graded ? null : oneOf(pick('condition') ?? 'NM', CONDITIONS, 'Condition'),
    quantity: number(pick('quantity') ?? 1, 'Quantity', { min: 1, max: 999, integer: true })!,
    purchasePrice: number(pick('purchasePrice'), 'Purchase price', { optional: true, min: 0, max: 10_000_000 }),
    purchaseCurrency: oneOf(pick('purchaseCurrency') ?? home, CURRENCIES, 'Purchase currency'),
    purchaseDate: isoDate(pick('purchaseDate'), 'Purchase date', { optional: true }),
    certNumber: graded ? text(pick('certNumber'), 'Cert number', { optional: true, max: 40 }) : null,
    notes: text(pick('notes'), 'Notes', { optional: true, max: 1000 }),
  };
}

async function loadItem(env: Env, id: string) {
  const item = await getItem(env, id);
  if (!item) throw new HttpError(404, 'That card is not in the collection');
  return item;
}

collection.get('/', async (c) => {
  const trash = c.req.query('deleted') === '1';
  if (trash && !hasRole(c.get('user').role, 'editor')) throw new HttpError(403, 'Only editors can see removed cards');
  const { results } = await c.env.DB.prepare(
    `${ITEM_SELECT} WHERE ci.deleted_at IS ${trash ? 'NOT NULL ORDER BY ci.deleted_at DESC' : 'NULL ORDER BY ci.created_at DESC'}`,
  ).all();
  const items = results.map(toItem);
  const currency = homeCurrency(c.env);
  const fx = await getRates(c.env);
  const oldest = trash
    ? null
    : await c.env.DB.prepare(
        // (Only refreshes that worked: a failed one didn't update anything.)
        `SELECT MIN(pr.refreshed_at) AS at FROM collection_items ci JOIN price_refresh pr ON pr.card_id = ci.card_id
          WHERE ci.deleted_at IS NULL AND pr.status = 'ok'`,
      ).first<{ at: string | null }>();
  const summary = {
    items: items.length,
    cards: 0,
    graded: 0,
    totalValue: 0,
    currency,
    unpriced: 0,
    pricesUpdatedAt: oldest?.at ?? null,
  };
  for (const it of items) {
    summary.cards += it.quantity;
    if (it.grader !== 'RAW') summary.graded += it.quantity;
    const value = it.value === null ? null : convert(it.value, it.valueCurrency ?? 'USD', currency, fx);
    if (value === null) summary.unpriced += 1;
    else summary.totalValue += value * it.quantity;
  }
  summary.totalValue = Math.round(summary.totalValue * 100) / 100;
  return c.json<CollectionResponse>({ items, summary });
});

/** The app calls this when it opens: fetches prices more than a few hours old, a batch per call. */
collection.post('/refresh-prices', async (c) =>
  c.json<PriceRefreshResponse>(await refreshStalePrices(c.env, ON_OPEN_TTL_MS)),
);

/**
 * Combines entries that are copies of the same card with the same details into one entry each
 * (the oldest), as adding them now would. Nothing is lost: the combined entry holds every copy.
 */
collection.post('/merge-duplicates', requireRole('editor'), async (c) => {
  const { results } = await c.env.DB.prepare(`${ITEM_SELECT} WHERE ci.deleted_at IS NULL`).all();
  const plans = planMerges(results.map(toItem));
  if (plans.length) {
    const user = c.get('user');
    const now = nowIso();
    await c.env.DB.batch(
      plans.flatMap(({ keep, absorb, quantity }) => [
        c.env.DB.prepare('UPDATE collection_items SET quantity = ?, updated_at = ? WHERE id = ?').bind(quantity, now, keep.id),
        // (50 at a time: D1 takes up to 100 values per statement)
        ...Array.from({ length: Math.ceil(absorb.length / 50) }, (_, i) => absorb.slice(i * 50, i * 50 + 50)).map((ids) =>
          c.env.DB.prepare(`DELETE FROM collection_items WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(
            ...ids.map((a) => a.id),
          ),
        ),
        auditStmt(c.env, user, 'merge', 'item', keep.id, {
          card: `${keep.name} · ${keep.setName} #${keep.number}`,
          entries: absorb.length + 1,
          quantity,
          combined: absorb.map((a) => a.id),
        }),
      ]),
    );
  }
  return c.json<MergeResponse>({
    groups: plans.length,
    removed: plans.reduce((n, p) => n + p.absorb.length, 0),
  });
});

collection.get('/:id', async (c) => c.json({ item: await loadItem(c.env, c.req.param('id')) }));

collection.post('/', requireRole('editor'), async (c) => {
  const body = await readJson(c.req.raw);
  const cardId = parseCardId(body.cardId);
  const fields = parseItemFields(body, homeCurrency(c.env));
  const card = await getCard(c.env, cardId);
  if (!comesIn(card, fields.variant)) {
    throw new HttpError(400, `${card.name} (${card.setName}) doesn't come in that printing`);
  }
  const user = c.get('user');
  const now = nowIso();
  // Another copy of one already in the collection is counted with it, not given a second entry.
  const { results: owned } = await c.env.DB.prepare(
    `${ITEM_SELECT} WHERE ci.card_id = ? AND ci.deleted_at IS NULL ORDER BY ci.created_at ASC`,
  )
    .bind(card.id)
    .all();
  const same = entryFor(owned.map(toItem), fields);
  const id = same?.id ?? crypto.randomUUID();
  const write = same
    ? c.env.DB.prepare('UPDATE collection_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?').bind(
        fields.quantity,
        now,
        id,
      )
    : c.env.DB.prepare(
        `INSERT INTO collection_items (id, card_id, name, set_id, set_name, number, set_total, rarity, artist, image, dex_id,
           variant, language, grader, grade, grade_label, condition, quantity, purchase_price, purchase_currency, purchase_date,
           cert_number, notes, added_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        card.id,
        card.name,
        card.setId,
        card.setName,
        card.number,
        card.setTotal,
        card.rarity,
        card.artist,
        card.image,
        card.dexId,
        fields.variant,
        fields.language,
        fields.grader,
        fields.grade,
        fields.gradeLabel,
        fields.condition,
        fields.quantity,
        fields.purchasePrice,
        fields.purchaseCurrency,
        fields.purchaseDate,
        fields.certNumber,
        fields.notes,
        user.id,
        now,
        now,
      );
  await c.env.DB.batch([
    write,
    auditStmt(c.env, user, 'add', 'item', id, {
      card: `${card.name} · ${card.setName} #${card.number}`,
      ...fields,
      ...(same ? { countedWith: `the ${same.quantity} already in the collection` } : {}),
    }),
  ]);
  if (await pricesAreStale(c.env, cardId)) {
    await refreshMarketPrices(c.env, cardId).catch((err) => console.warn('price refresh failed', err));
  }
  await recomputeValues(c.env, cardId);
  if (c.env.PRICECHARTING_TOKEN) {
    c.executionCtx.waitUntil(
      refreshPriceCharting(c.env, card, [fields.variant]).then(() => recomputeValues(c.env, cardId)),
    );
  }
  return c.json({ item: await getItem(c.env, id), merged: !!same }, same ? 200 : 201);
});

collection.patch('/:id', requireRole('editor'), async (c) => {
  const item = await loadItem(c.env, c.req.param('id'));
  if (item.deletedAt) throw new HttpError(409, 'Restore this card before editing it');
  const fields = parseItemFields(await readJson(c.req.raw), homeCurrency(c.env), item);
  if (fields.variant !== item.variant) {
    const card = await getCard(c.env, item.cardId);
    if (!comesIn(card, fields.variant)) throw new HttpError(400, "This card doesn't come in that printing");
  }
  const changes = Object.fromEntries(
    Object.entries(fields).filter(([k, v]) => item[k as keyof ItemFields] !== v),
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE collection_items SET variant = ?, language = ?, grader = ?, grade = ?, grade_label = ?, condition = ?, quantity = ?,
         purchase_price = ?, purchase_currency = ?, purchase_date = ?, cert_number = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      fields.variant,
      fields.language,
      fields.grader,
      fields.grade,
      fields.gradeLabel,
      fields.condition,
      fields.quantity,
      fields.purchasePrice,
      fields.purchaseCurrency,
      fields.purchaseDate,
      fields.certNumber,
      fields.notes,
      nowIso(),
      item.id,
    ),
    auditStmt(c.env, c.get('user'), 'edit', 'item', item.id, { card: `${item.name} · ${item.setName}`, ...changes }),
  ]);
  await recomputeValues(c.env, item.cardId);
  if (c.env.PRICECHARTING_TOKEN && fields.variant !== item.variant) {
    c.executionCtx.waitUntil(
      getCard(c.env, item.cardId)
        .then((card) => refreshPriceCharting(c.env, card, [fields.variant]))
        .then(() => recomputeValues(c.env, item.cardId)),
    );
  }
  return c.json({ item: await getItem(c.env, item.id) });
});

collection.delete('/:id', requireRole('editor'), async (c) => {
  const item = await loadItem(c.env, c.req.param('id'));
  if (item.deletedAt) return c.json({ ok: true });
  const user = c.get('user');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE collection_items SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(nowIso(), user.id, item.id),
    auditStmt(c.env, user, 'remove', 'item', item.id, { card: `${item.name} · ${item.setName} #${item.number}` }),
  ]);
  return c.json({ ok: true });
});

collection.post('/:id/restore', requireRole('editor'), async (c) => {
  const item = await loadItem(c.env, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE collection_items SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?').bind(
      nowIso(),
      item.id,
    ),
    auditStmt(c.env, c.get('user'), 'restore', 'item', item.id, { card: `${item.name} · ${item.setName}` }),
  ]);
  return c.json({ item: await getItem(c.env, item.id) });
});

/** Permanently delete a card that is already in the trash. */
collection.delete('/:id/purge', requireRole('admin'), async (c) => {
  const item = await loadItem(c.env, c.req.param('id'));
  if (!item.deletedAt) throw new HttpError(409, 'Remove the card first; only removed cards can be deleted forever');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM collection_items WHERE id = ?').bind(item.id),
    auditStmt(c.env, c.get('user'), 'purge', 'item', item.id, { card: `${item.name} · ${item.setName}` }),
  ]);
  return c.json({ ok: true });
});

export default collection;
