// Set completion: which cards of each set are in the collection.

import type { Catalog, CatalogCard, CatalogSet } from './catalog.ts';
import type { MarketPrices } from './useCatalog.ts';

export interface SetProgress {
  set: CatalogSet;
  /** Every card of the set in the catalog, in set order */
  cards: CatalogCard[];
  /** Different cards of the set in the collection (any printing, condition or grade) */
  owned: number;
  /** Copies of those cards, counting quantities */
  copies: number;
}

/** Progress for every set that has cards in the catalog. `copiesByCard`: card id → copies owned. */
export function setProgress(cat: Catalog, copiesByCard: Map<string, number>): SetProgress[] {
  const out: SetProgress[] = [];
  for (const set of cat.sets) {
    const cards = cat.bySet.get(set.id) ?? [];
    if (!cards.length) continue;
    let owned = 0;
    let copies = 0;
    for (const card of cards) {
      const n = copiesByCard.get(card.id) ?? 0;
      if (n > 0) {
        owned++;
        copies += n;
      }
    }
    out.push({ set, cards, owned, copies });
  }
  return out;
}

export const percent = (p: Pick<SetProgress, 'owned' | 'cards'>) => (p.cards.length ? (100 * p.owned) / p.cards.length : 0);

/** "12%": never rounded up to 100% before the set is complete, nor down to 0% once it's started. */
export function percentText(p: Pick<SetProgress, 'owned' | 'cards'>): string {
  if (p.cards.length && p.owned >= p.cards.length) return '100%';
  const v = percent(p);
  return p.owned > 0 && v < 1 ? '<1%' : `${Math.min(99, Math.floor(v))}%`;
}

/** A card's market price in the currency being shown (see MarketPrices), or null if it has none. */
export type PriceOf = (card: CatalogCard) => number | null;

export function priceLookup(prices: MarketPrices | null, convert: (amount: number | null, from: string) => number | null): PriceOf {
  return (card) => {
    if (!prices) return null;
    const usd = prices.usd[card.order];
    if (usd != null) return convert(usd, 'USD');
    const eur = prices.eur[card.order];
    return eur != null ? convert(eur, 'EUR') : null;
  };
}

export interface SetValue {
  /** Market value of one of every card in the set */
  total: number;
  /** …of the cards you have */
  owned: number;
  /** …of the cards still missing: what completing the set would cost */
  missing: number;
  /** How many of the set's cards have a market price */
  priced: number;
}

/** What a set is worth at market prices (one raw copy of each card's standard printing). */
export function setValue(p: Pick<SetProgress, 'cards'>, priceOf: PriceOf, has: (card: CatalogCard) => boolean): SetValue {
  const v: SetValue = { total: 0, owned: 0, missing: 0, priced: 0 };
  for (const card of p.cards) {
    const price = priceOf(card);
    if (price === null) continue;
    v.priced++;
    v.total += price;
    if (has(card)) v.owned += price;
    else v.missing += price;
  }
  return v;
}

/** Image URL for a set's logo, if TCGdex has one. */
export const setLogoUrl = (set: CatalogSet) => (set.logo ? `${set.logo}.webp` : null);
