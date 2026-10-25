// Binders: every pocket in order, page by page, and which ones the collection fills.

import type { Variant } from '../../../shared/grading.ts';
import { fixPrinting, printingLabel, printingOrder } from '../../../shared/printings.ts';
import type { BinderCard, CollectionItem } from '../../../shared/types.ts';
import { normName, type Catalog, type CatalogCard, type CatalogSet } from './catalog.ts';

/** A pocket's footnote: which printing goes in it. */
export const PRINTING_NOTES: Record<string, string> = {
  normal: 'Regular',
  holo: 'Holo',
  reverse: 'Reverse Holo',
  firstEdition: '1st Edition',
  wPromo: 'Promo stamp',
};
export const printingNote = (variant: string) => PRINTING_NOTES[variant] ?? printingLabel(variant);

export interface Pocket {
  cardId: string;
  variant: string;
  /** A copy of this card in this printing is in the collection */
  filled: boolean;
  /** The binder card it belongs to (index) */
  line: number;
}

const key = (cardId: string, variant: string) => `${cardId}|${variant}`;

/** The printings a card comes in, by id (null when unknown). */
export type KnownPrintings = (cardId: string) => readonly string[] | null | undefined;

/**
 * Copies in the collection of each card in each printing (any condition or grade). A copy saved in
 * a printing its card doesn't come in counts as the card's main printing (a Shuckle-GX saved as
 * "normal" before its printings were known is a holo).
 */
export function ownedPrintings(items: Pick<CollectionItem, 'cardId' | 'variant' | 'quantity'>[], known?: KnownPrintings): Map<string, number> {
  const owned = new Map<string, number>();
  for (const i of items) {
    const k = key(i.cardId, known ? fixPrinting(i.variant, known(i.cardId)) : i.variant);
    owned.set(k, (owned.get(k) ?? 0) + i.quantity);
  }
  return owned;
}

/** Copies added (+1) or taken out (−1) by a binder's + and − that the collection doesn't have yet, counted in. */
export function withPending(owned: Map<string, number>, pending: readonly { key: string; delta: number }[]): Map<string, number> {
  if (!pending.length) return owned;
  const out = new Map(owned);
  for (const p of pending) out.set(p.key, Math.max(0, (out.get(p.key) ?? 0) + p.delta));
  return out;
}

/**
 * The copy a binder's − takes out of the collection for a card in a printing: a raw one (a slab
 * is taken out on its own page), the one added last first. Null when there's no raw copy.
 */
export function copyToRemove<T extends Pick<CollectionItem, 'cardId' | 'variant' | 'grader' | 'createdAt'>>(
  items: readonly T[],
  cardId: string,
  variant: string,
  known?: KnownPrintings,
): T | null {
  let last: T | null = null;
  for (const i of items) {
    if (i.cardId !== cardId || i.grader !== 'RAW') continue;
    if ((known ? fixPrinting(i.variant, known(i.cardId)) : i.variant) !== variant) continue;
    if (!last || i.createdAt > last.createdAt) last = i;
  }
  return last;
}

/** A binder's cards, any printing a card doesn't come in taken as its main one (binders made before its printings were known). */
export const fixBinderPrintings = (cards: BinderCard[], known: KnownPrintings): BinderCard[] =>
  cards.map((c) => {
    const variant = fixPrinting(c.variant, known(c.cardId));
    return variant === c.variant ? c : { ...c, variant };
  });

/**
 * Every pocket, in order. Each copy in the collection fills one pocket of its card and printing,
 * the first ones first (so 4 Shuckles fill the first 4 of the 9 pockets kept for them).
 */
export function pocketsOf(cards: BinderCard[], owned: Map<string, number>): Pocket[] {
  const left = new Map(owned);
  const pockets: Pocket[] = [];
  cards.forEach((c, line) => {
    const k = key(c.cardId, c.variant);
    for (let i = 0; i < c.copies; i++) {
      const have = left.get(k) ?? 0;
      if (have > 0) left.set(k, have - 1);
      pockets.push({ cardId: c.cardId, variant: c.variant, filled: have > 0, line });
    }
  });
  return pockets;
}

/** Pockets page by page (the last page may be part full). */
export function pagesOf<T>(pockets: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < pockets.length; i += perPage) pages.push(pockets.slice(i, i + perPage));
  return pages;
}

export interface Missing {
  line: number;
  cardId: string;
  variant: string;
  /** Copies still to get */
  need: number;
  /** Where its first empty pocket is (1-based) */
  page: number;
  pocket: number;
}

/** What's still needed for each binder card, and where it goes. */
export function missingOf(cards: BinderCard[], pockets: Pocket[], perPage: number): Missing[] {
  const missing = new Map<number, Missing>();
  pockets.forEach((p, i) => {
    if (p.filled) return;
    const m = missing.get(p.line);
    if (m) m.need++;
    else {
      const c = cards[p.line];
      missing.set(p.line, { line: p.line, cardId: c.cardId, variant: c.variant, need: 1, page: Math.floor(i / perPage) + 1, pocket: (i % perPage) + 1 });
    }
  });
  return [...missing.values()];
}

export interface BinderStats {
  pockets: number;
  filled: number;
  pages: number;
  /** Market value of the cards in it (null without prices) */
  value: number | null;
  /** …and of the ones still missing: what completing it would cost */
  toComplete: number | null;
}

/** How full a binder is and what it's worth; `priceOf` is one copy's market price (null: unknown). */
export function binderStats(
  pockets: Pocket[],
  perPage: number,
  priceOf: ((cardId: string) => number | null) | null,
): BinderStats {
  let filled = 0;
  let value = 0;
  let toComplete = 0;
  for (const p of pockets) {
    const price = priceOf?.(p.cardId) ?? 0;
    if (p.filled) {
      filled++;
      value += price;
    } else {
      toComplete += price;
    }
  }
  return {
    pockets: pockets.length,
    filled,
    pages: Math.ceil(pockets.length / perPage),
    value: priceOf ? value : null,
    toComplete: priceOf ? toComplete : null,
  };
}

/** "53%"; never 0% once something is in it, nor 100% until it's full. */
export function percentFilled({ filled, pockets }: Pick<BinderStats, 'filled' | 'pockets'>): string {
  if (!pockets) return '0%';
  const pct = Math.floor((100 * filled) / pockets);
  if (filled > 0 && pct === 0) return '<1%';
  return `${filled < pockets ? Math.min(pct, 99) : 100}%`;
}

/** Under this share of the cards of one rarity in a set, a printing is a promo… */
const PROMO_SHARE = 0.15;
/** …judged among at least this many cards. */
const PROMO_AMONG = 8;

/** Promo sets: everything in them is a promo. */
export const isPromoSet = (set: Pick<CatalogSet, 'name'>) => /promo/i.test(set.name);

/**
 * Every printing a card comes in: its plain ones (Reverse Holo before Holo when those are all), then
 * its special ones (a cosmos holo, a stamped version), as the catalog has them.
 */
export function allPrintingsOf(card: Pick<CatalogCard, 'variants'> & Partial<Pick<CatalogCard, 'specials'>>): string[] {
  return printingOrder([...(card.variants?.length ? card.variants : ['normal']), ...(card.specials ?? [])]);
}

/** Every printing of a card by id, for fixing printings recorded before they were known. */
export const knownPrintings =
  (catalog: Pick<Catalog, 'byId'> | null): KnownPrintings =>
  (cardId) => {
    const card = catalog?.byId.get(cardId);
    return card?.variants ? allPrintingsOf(card) : null;
  };

/**
 * The printings (card id | printing) a set's cards come in only as promos, not the set's own
 * packs: Paradox Rift's Kingdra as a cosmos holo, its Snorunt as a cosmos holo with a snowflake
 * stamp, its Iron Moth reverse holo stamped for GameStop. The catalog has them from TCGdex's
 * details (shared/printings.ts); a catalog from before that has them worked out from the plain
 * printings: one that hardly any card of the same rarity comes in (under 15% of 8 or more). A
 * card's only printing is never a promo.
 */
export function promoPrintings(setCards: readonly CatalogCard[]): Set<string> {
  const promos = new Set<string>();
  if (!setCards.length) return promos;
  if (setCards.every((c) => c.promos)) {
    for (const c of setCards) for (const p of c.promos!) promos.add(key(c.id, p));
    return promos;
  }
  if (isPromoSet(setCards[0].set)) return promos;
  const byRarity = new Map<string, CatalogCard[]>();
  for (const c of setCards) {
    if (!c.variants?.length) continue;
    const r = c.rarity ?? '';
    byRarity.set(r, [...(byRarity.get(r) ?? []), c]);
  }
  for (const group of byRarity.values()) {
    if (group.length < PROMO_AMONG) continue;
    const counts = new Map<Variant, number>();
    for (const c of group) for (const v of c.variants!) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const [v, n] of counts) {
      if (n / group.length >= PROMO_SHARE) continue;
      for (const c of group) if (c.variants!.length > 1 && c.variants!.includes(v)) promos.add(key(c.id, v));
    }
  }
  return promos;
}

/** Promo printings of every set the cards are from. */
export function promosOf(catalog: Pick<Catalog, 'bySet'>, cards: readonly Pick<CatalogCard, 'set'>[]): Set<string> {
  const promos = new Set<string>();
  for (const setId of new Set(cards.map((c) => c.set.id))) for (const p of promoPrintings(catalog.bySet.get(setId) ?? [])) promos.add(p);
  return promos;
}

export const isPromoPrinting = (promos: ReadonlySet<string>, cardId: string, variant: string) => promos.has(key(cardId, variant));

/**
 * Stamped promo-set cards that are versions of these cards (a set's Build & Battle and prerelease
 * promos: SVP 057 Chi-Yu, stamped with Paradox Rift's logo), in the promo set's order.
 */
export function stampedPromosOf(catalog: Pick<Catalog, 'cards'>, cards: readonly Pick<CatalogCard, 'id'>[]): CatalogCard[] {
  const ids = new Set(cards.map((c) => c.id));
  return catalog.cards.filter((c) => c.versionOf && ids.has(c.versionOf));
}

/**
 * The printings a binder starts with for a card, from the set's own packs: its main one (as adding
 * a card does: a plain one), or all of them (special pack ones too, like Poké Ball reverse holos).
 * `promos`: printings only promos come in (promoPrintings).
 */
export function printingsOf(
  card: Pick<CatalogCard, 'id' | 'variants'> & Partial<Pick<CatalogCard, 'specials'>>,
  every: boolean,
  promos?: ReadonlySet<string>,
): string[] {
  const all = allPrintingsOf(card);
  const own = promos ? all.filter((v) => !promos.has(key(card.id, v))) : all;
  const printings = own.length ? own : all;
  if (every) return printings;
  // The main one: its first plain printing from the packs (VARIANTS order: holo before reverse)
  const plain = (card.variants?.length ? card.variants : ['normal']).filter((v) => printings.includes(v));
  return [plain[0] ?? printings[0]];
}

/**
 * How many printings a binder made from cards has: one of each card, a master set (every printing
 * from the set's own packs), or a grand master set (the master set, then the promo printings, then
 * the set's stamped promo cards).
 */
export type PrintingChoice = 'one' | 'master' | 'grand';

/**
 * Binder cards for catalog cards, in their order, `copies` of each printing. A grand master set has
 * the promo printings last, then `stamped` promo cards (stampedPromosOf) in every printing.
 */
export function binderCards(
  cards: CatalogCard[],
  choice: PrintingChoice,
  copies: number,
  promos: ReadonlySet<string> = new Set(),
  stamped: readonly CatalogCard[] = [],
): BinderCard[] {
  const line = (cardId: string, variant: string): BinderCard => ({ cardId, variant, copies });
  const main = cards.flatMap((card) => printingsOf(card, choice !== 'one', promos).map((v) => line(card.id, v)));
  if (choice !== 'grand') return main;
  const inMain = new Set(main.map((c) => key(c.cardId, c.variant)));
  const extra = cards.flatMap((card) => allPrintingsOf(card).filter((v) => promos.has(key(card.id, v)) && !inMain.has(key(card.id, v))).map((v) => line(card.id, v)));
  const promoCards = stamped.flatMap((card) => allPrintingsOf(card).map((v) => line(card.id, v)));
  return [...main, ...extra, ...promoCards];
}

/** Every card in a set, in number order. */
export const setCardsOf = (catalog: Catalog, setId: string) => catalog.bySet.get(setId) ?? [];

/** Every card of a Pokémon ("Shuckle", "Mr. Mime", also Dark Shuckle and Shuckle GX), oldest first. */
export function pokemonCardsOf(catalog: Pick<Catalog, 'cards'>, name: string): CatalogCard[] {
  const q = normName(name);
  if (!q) return [];
  return catalog.cards.filter((c) => c.category !== 'Trainer' && c.category !== 'Energy' && ` ${c.nameKey} `.includes(` ${q} `));
}
