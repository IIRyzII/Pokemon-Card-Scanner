// Adding another copy of a card already in the collection counts it with that entry (one entry,
// a bigger quantity) instead of making a second entry, as long as nothing recorded differs.

import type { ItemFields } from './types.ts';

/** Most copies one entry holds (the limit when editing a quantity). */
export const MAX_QUANTITY = 999;

/**
 * Copies that can share an entry: the same printing and condition or grade, bought at the same
 * price on the same date, with the same notes (all usually blank). A slab with a cert number is
 * one specific copy, so it always has an entry of its own.
 */
export function sameCopy(a: ItemFields, b: ItemFields): boolean {
  return (
    a.variant === b.variant &&
    a.grader === b.grader &&
    (a.grade ?? null) === (b.grade ?? null) &&
    (a.gradeLabel ?? null) === (b.gradeLabel ?? null) &&
    (a.grader !== 'RAW' || (a.condition ?? null) === (b.condition ?? null)) &&
    !a.certNumber &&
    !b.certNumber &&
    (a.purchasePrice ?? null) === (b.purchasePrice ?? null) &&
    (a.purchasePrice === null || a.purchaseCurrency === b.purchaseCurrency) &&
    (a.purchaseDate ?? null) === (b.purchaseDate ?? null) &&
    (a.notes ?? '').trim() === (b.notes ?? '').trim()
  );
}

/** The entry new copies are counted with: the first (oldest) that's the same copy and has room. */
export function entryFor<T extends ItemFields>(entries: T[], add: ItemFields): T | undefined {
  return entries.find((e) => sameCopy(e, add) && e.quantity + add.quantity <= MAX_QUANTITY);
}

interface Entry extends ItemFields {
  id: string;
  cardId: string;
  createdAt: string;
}

/** Entries of the same copy to combine: `absorb` are counted into `keep`, giving it `quantity` copies. */
export interface Merge<T extends Entry> {
  keep: T;
  absorb: T[];
  quantity: number;
}

/**
 * Entries that are copies of the same card with the same details (made before adding a card
 * counted it with the ones already there, or by edits since): each is combined into the oldest,
 * the same way adding them now would.
 */
export function planMerges<T extends Entry>(entries: T[]): Merge<T>[] {
  const kept = new Map<string, Merge<T>[]>(); // card id → its entries so far
  for (const e of [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const card = kept.get(e.cardId) ?? [];
    kept.set(e.cardId, card);
    const into = card.find((m) => sameCopy(m.keep, e) && m.quantity + e.quantity <= MAX_QUANTITY);
    if (into) {
      into.absorb.push(e);
      into.quantity += e.quantity;
    } else {
      card.push({ keep: e, absorb: [], quantity: e.quantity });
    }
  }
  return [...kept.values()].flat().filter((m) => m.absorb.length > 0);
}
