// Sealed products in the collection: finding them in the catalogue's list (Cardmarket's), and
// what they're worth against what was paid.

import type { SealedItem } from '../../../shared/types.ts';
import { normName } from './catalog.ts';
import type { SealedProduct } from './useCatalog.ts';

/** Products whose name (or set's name) has every word searched for, of one kind or any; newest first. */
export function searchSealed(products: readonly SealedProduct[], query: string, type: string | null, limit = 60): SealedProduct[] {
  const words = normName(query).split(' ').filter(Boolean);
  const out: SealedProduct[] = [];
  for (const p of products) {
    if ((type && p.type !== type) || !words.every((w) => p.key.includes(w))) continue;
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export interface SealedValue {
  /** One's value now, in the display currency, or null when there's no price */
  each: number | null;
  /** All of them */
  total: number | null;
  /** What all of them cost, in the display currency, or null when not recorded */
  paid: number | null;
}

type Convert = (amount: number | null | undefined, from: string) => number | null;

/** An entry's value (Cardmarket's price, in EUR, converted) and cost. */
export function sealedValue(item: SealedItem, product: SealedProduct | undefined, convert: Convert, currency: string): SealedValue {
  const each = product?.price != null ? convert(product.price, 'EUR') : null;
  const cost = item.purchasePrice != null ? convert(item.purchasePrice, item.purchaseCurrency ?? currency) : null;
  return { each, total: each === null ? null : each * item.quantity, paid: cost === null ? null : cost * item.quantity };
}

export interface SealedTotals {
  /** Products (each copy counted) and entries */
  count: number;
  entries: number;
  value: number;
  /** Entries without a price */
  unpriced: number;
  /** What was paid for the entries that say, and what those are worth now */
  paid: number;
  paidValue: number;
  /** Entries with a price paid and a value */
  costed: number;
}

export function sealedTotals(items: readonly SealedItem[], value: (item: SealedItem) => SealedValue): SealedTotals {
  const t: SealedTotals = { count: 0, entries: items.length, value: 0, unpriced: 0, paid: 0, paidValue: 0, costed: 0 };
  for (const item of items) {
    const v = value(item);
    t.count += item.quantity;
    if (v.total === null) t.unpriced++;
    else t.value += v.total;
    if (v.paid !== null && v.total !== null) {
      t.paid += v.paid;
      t.paidValue += v.total;
      t.costed++;
    }
  }
  return t;
}
