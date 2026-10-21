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
