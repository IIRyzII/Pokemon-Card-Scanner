// Selling: what each sale made, the totals and months of the sales history, and the cards worth
// selling (spare copies, and the ones that have gained most since they were bought).

import type { CollectionItem, SoldItem } from '../../../shared/types.ts';

type Convert = (amount: number | null | undefined, from: string) => number | null;

export interface SaleResult {
  /** What the copies sold for, all together */
  takings: number;
  /** Fees and postage */
  costs: number;
  /** What the copies cost when bought (null: not recorded) */
  paid: number | null;
  /** Takings less costs, less what they cost (null when that isn't recorded) */
  profit: number | null;
}

const money = (n: number) => Math.round(n * 100) / 100;

/** What one sale made, in the display currency (null if a rate is missing). */
export function saleResult(s: SoldItem, convert: Convert): SaleResult | null {
  const takings = convert(s.price * s.quantity, s.currency);
  const costs = convert((s.fees ?? 0) + (s.postage ?? 0), s.currency);
  if (takings === null || costs === null) return null;
  const paid = s.purchasePrice === null ? null : convert(s.purchasePrice * s.quantity, s.purchaseCurrency ?? s.currency);
  return { takings: money(takings), costs: money(costs), paid: paid === null ? null : money(paid), profit: paid === null ? null : money(takings - costs - paid) };
}

export interface SalesTotals {
  /** Sales and the copies in them */
  sales: number;
  copies: number;
  takings: number;
  costs: number;
  /** Profit over the sales whose purchase price is recorded, and how many those are */
  profit: number;
  costed: number;
}

export function salesTotals(sold: readonly SoldItem[], convert: Convert): SalesTotals {
  const t: SalesTotals = { sales: 0, copies: 0, takings: 0, costs: 0, profit: 0, costed: 0 };
  for (const s of sold) {
    const r = saleResult(s, convert);
    if (!r) continue;
    t.sales++;
    t.copies += s.quantity;
    t.takings += r.takings;
    t.costs += r.costs;
    if (r.profit !== null) {
      t.profit += r.profit;
      t.costed++;
    }
  }
  return { ...t, takings: money(t.takings), costs: money(t.costs), profit: money(t.profit) };
}

/** The sales history by month ("2026-11"), latest first, each with its totals. */
export function salesByMonth(sold: readonly SoldItem[], convert: Convert): { month: string; sales: SoldItem[]; totals: SalesTotals }[] {
  const months = new Map<string, SoldItem[]>();
  for (const s of sold) {
    const m = s.soldOn.slice(0, 7);
    months.set(m, [...(months.get(m) ?? []), s]);
  }
  return [...months]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, sales]) => ({ month, sales: [...sales].sort((a, b) => b.soldOn.localeCompare(a.soldOn) || b.createdAt.localeCompare(a.createdAt)), totals: salesTotals(sales, convert) }));
}

/** "November 2026" */
export const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export interface Suggestion {
  item: CollectionItem;
  /** Why: the spare copies of it, or what one has gained since it was bought */
  reason: 'spare' | 'gain';
  /** Copies that could go: its spares (keeping one of the card), or all of it */
  copies: number;
  /** One's value now, and (for a gain) what one cost, in the display currency */
  each: number;
  paidEach: number | null;
}

/**
 * Cards worth selling, best first: spare copies (beyond one of each card, the least valuable
 * entries' first, as the Dupes view counts them), then the cards that have gained most since they
 * were bought (by how much one is up). Only cards with a value, and not already all for sale.
 */
export function sellSuggestions(items: readonly CollectionItem[], convert: Convert, limit = 12): Suggestion[] {
  const valued = items
    .filter((i) => !i.deletedAt)
    .map((item) => ({ item, each: convert(item.value, item.valueCurrency ?? 'USD') }))
    .filter((x): x is { item: CollectionItem; each: number } => x.each !== null && x.each > 0);
  // Spares: each card's copies beyond the most valuable one.
  const byCard = new Map<string, typeof valued>();
  for (const v of valued) byCard.set(v.item.cardId, [...(byCard.get(v.item.cardId) ?? []), v]);
  const spare: Suggestion[] = [];
  for (const entries of byCard.values()) {
    const copies = entries.reduce((n, e) => n + e.item.quantity, 0);
    if (copies < 2) continue;
    // Keep the most valuable copy; the rest can go, cheapest entries' copies counted last.
    const sorted = [...entries].sort((a, b) => b.each - a.each);
    sorted.forEach((e, i) => {
      const n = i === 0 ? e.item.quantity - 1 : e.item.quantity;
      const free = n - (e.item.forSale || 0);
      if (free > 0) spare.push({ item: e.item, reason: 'spare', copies: free, each: e.each, paidEach: null });
    });
  }
  spare.sort((a, b) => b.each * b.copies - a.each * a.copies);
  const taken = new Set(spare.map((s) => s.item.id));
  const gains = valued
    .filter((v) => !taken.has(v.item.id) && v.item.purchasePrice !== null && (v.item.forSale || 0) < v.item.quantity)
    .map((v) => ({ ...v, paidEach: convert(v.item.purchasePrice, v.item.purchaseCurrency ?? 'USD') }))
    .filter((v): v is typeof v & { paidEach: number } => v.paidEach !== null && v.each > v.paidEach)
    .sort((a, b) => b.each - b.paidEach - (a.each - a.paidEach))
    .map((v): Suggestion => ({ item: v.item, reason: 'gain', copies: v.item.quantity - (v.item.forSale || 0), each: v.each, paidEach: v.paidEach }));
  return [...spare, ...gains].slice(0, limit);
}
