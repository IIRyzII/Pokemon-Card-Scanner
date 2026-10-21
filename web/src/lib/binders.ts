// Binders: every pocket in order, page by page, and which ones the collection fills.

import type { BinderCard, CollectionItem } from '../../../shared/types.ts';
import { normName, type Catalog, type CatalogCard } from './catalog.ts';

/** A pocket's footnote: which printing goes in it. */
export const PRINTING_NOTES: Record<string, string> = {
  normal: 'Regular',
  holo: 'Holo',
  reverse: 'Reverse Holo',
  firstEdition: '1st Edition',
  wPromo: 'Promo stamp',
};
export const printingNote = (variant: string) => PRINTING_NOTES[variant] ?? variant;

export interface Pocket {
  cardId: string;
  variant: string;
  /** A copy of this card in this printing is in the collection */
  filled: boolean;
  /** The binder card it belongs to (index) */
  line: number;
}

const key = (cardId: string, variant: string) => `${cardId}|${variant}`;

/** Copies in the collection of each card in each printing (any condition or grade). */
export function ownedPrintings(items: Pick<CollectionItem, 'cardId' | 'variant' | 'quantity'>[]): Map<string, number> {
  const owned = new Map<string, number>();
  for (const i of items) owned.set(key(i.cardId, i.variant), (owned.get(key(i.cardId, i.variant)) ?? 0) + i.quantity);
  return owned;
}

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

/** The printings a binder starts with for a card: its first (as adding a card does) or all of them. */
export function printingsOf(card: Pick<CatalogCard, 'variants'>, every: boolean): string[] {
  const all = card.variants?.length ? card.variants : ['normal'];
  return every ? [...all] : [all[0]];
}

/** Binder cards for catalog cards, in their order: `copies` of each printing. */
export const binderCards = (cards: CatalogCard[], every: boolean, copies: number): BinderCard[] =>
  cards.flatMap((card) => printingsOf(card, every).map((variant) => ({ cardId: card.id, variant, copies })));

/** Every card in a set, in number order. */
export const setCardsOf = (catalog: Catalog, setId: string) => catalog.bySet.get(setId) ?? [];

/** Every card of a Pokémon ("Shuckle", "Mr. Mime", also Dark Shuckle and Shuckle GX), oldest first. */
export function pokemonCardsOf(catalog: Pick<Catalog, 'cards'>, name: string): CatalogCard[] {
  const q = normName(name);
  if (!q) return [];
  return catalog.cards.filter((c) => c.category !== 'Trainer' && c.category !== 'Energy' && ` ${c.nameKey} `.includes(` ${q} `));
}
