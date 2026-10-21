// Duplicates: cards held more than once, in one entry (×3) or several (a Near Mint and a Played copy).

import type { CollectionItem } from '../../../shared/types.ts';

type Copies = Pick<CollectionItem, 'cardId' | 'quantity'>;

/** card id → copies of it across all entries */
export function copiesByCard(items: Copies[]): Map<string, number> {
  const copies = new Map<string, number>();
  for (const i of items) copies.set(i.cardId, (copies.get(i.cardId) ?? 0) + i.quantity);
  return copies;
}

export interface Spares {
  /** Cards held more than once */
  cards: number;
  /** Copies beyond one of each card (the ones you could trade or sell) */
  copies: number;
  /** What those copies are worth: every copy except the most valuable one of each card */
  value: number;
}

/** The spare copies among `items`, valued with `unitValue` (one copy's value, null without a price). */
export function spares<T extends Copies>(items: T[], unitValue: (item: T) => number | null): Spares {
  const byCard = new Map<string, { copies: number; value: number; best: number }>();
  for (const i of items) {
    const unit = unitValue(i) ?? 0;
    const card = byCard.get(i.cardId) ?? { copies: 0, value: 0, best: 0 };
    card.copies += i.quantity;
    card.value += unit * i.quantity;
    card.best = Math.max(card.best, unit);
    byCard.set(i.cardId, card);
  }
  const out: Spares = { cards: 0, copies: 0, value: 0 };
  for (const card of byCard.values()) {
    if (card.copies < 2) continue;
    out.cards++;
    out.copies += card.copies - 1;
    out.value += card.value - card.best;
  }
  return out;
}
