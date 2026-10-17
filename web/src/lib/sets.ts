// Set completion: which cards of each set are in the collection.

import type { Catalog, CatalogCard, CatalogSet } from './catalog.ts';

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

/** "12%", but never rounds up to 100% before the set is actually complete. */
export function percentText(p: Pick<SetProgress, 'owned' | 'cards'>): string {
  const v = percent(p);
  return `${p.owned < p.cards.length ? Math.min(99, Math.floor(v)) : 100}%`;
}

/** Image URL for a set's logo, if TCGdex has one. */
export const setLogoUrl = (set: CatalogSet) => (set.logo ? `${set.logo}.webp` : null);
