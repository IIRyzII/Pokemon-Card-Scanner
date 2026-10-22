// The want list: the cards picked by hand and every gap in the binders, with the copies still to
// get of each (copies in the collection count towards both), grouped by set and priced; and the
// best cards a budget gets.

import { colourOf, type BinderColour } from '../../../shared/binders.ts';
import { fixPrinting } from '../../../shared/printings.ts';
import type { Binder, PriceRow, Want } from '../../../shared/types.ts';
import { valueItem, type ValueContext } from '../../../shared/values.ts';
import { DEFAULT_PRIORITY, isPriority, type WantPriority } from '../../../shared/wants.ts';
import { fixBinderPrintings, missingOf, pocketsOf, type KnownPrintings } from './binders.ts';
import type { Catalog, CatalogCard, CatalogSet } from './catalog.ts';

/** A binder the card goes in, and where its first empty pocket is. */
export interface WantPlace {
  binderId: string;
  name: string;
  colour: BinderColour;
  need: number;
  page: number;
  pocket: number;
}

export interface WantEntry {
  /** card id | printing */
  key: string;
  cardId: string;
  variant: string;
  /** Copies still to get */
  need: number;
  /** Copies of this printing in the collection */
  owned: number;
  /** Copies wanted in all: the most the hand-picked want or any binder asks for */
  wanted: number;
  want: Want | null;
  binders: WantPlace[];
  priority: WantPriority;
}

export const wantKey = (cardId: string, variant: string) => `${cardId}|${variant}`;

/**
 * Everything still wanted, and the hand-picked wants the collection now has enough of (`got`).
 * `owned`: copies per card and printing (ownedPrintings). Each binder counts every copy (as its
 * page does), so a card two binders want needs as many as the one that wants the most.
 */
export function wantList(wants: Want[], binders: Binder[], owned: Map<string, number>, known: KnownPrintings): { entries: WantEntry[]; got: Want[] } {
  const byKey = new Map<string, WantEntry>();
  const entry = (cardId: string, variant: string) => {
    const key = wantKey(cardId, variant);
    let e = byKey.get(key);
    if (!e) {
      e = { key, cardId, variant, need: 0, owned: owned.get(key) ?? 0, wanted: 0, want: null, binders: [], priority: DEFAULT_PRIORITY };
      byKey.set(key, e);
    }
    return e;
  };
  for (const b of binders) {
    const cards = fixBinderPrintings(b.cards, known);
    const copies = new Map<string, number>();
    for (const c of cards) copies.set(wantKey(c.cardId, c.variant), (copies.get(wantKey(c.cardId, c.variant)) ?? 0) + c.copies);
    const places = new Map<string, WantPlace & { cardId: string; variant: string }>();
    for (const m of missingOf(cards, pocketsOf(cards, owned), b.pockets)) {
      const k = wantKey(m.cardId, m.variant);
      const place = places.get(k);
      if (place) place.need += m.need;
      else places.set(k, { binderId: b.id, name: b.name, colour: colourOf(b), need: m.need, page: m.page, pocket: m.pocket, cardId: m.cardId, variant: m.variant });
    }
    for (const [k, { cardId, variant, ...place }] of places) {
      const e = entry(cardId, variant);
      e.binders.push(place);
      e.need = Math.max(e.need, place.need);
      e.wanted = Math.max(e.wanted, copies.get(k) ?? place.need);
    }
  }
  const got: Want[] = [];
  for (const w of wants) {
    const variant = fixPrinting(w.variant, known(w.cardId));
    const k = wantKey(w.cardId, variant);
    const need = Math.max(0, w.quantity - (owned.get(k) ?? 0));
    if (!need && !byKey.has(k)) {
      got.push(w);
      continue;
    }
    const e = entry(w.cardId, variant);
    e.want = w;
    e.need = Math.max(e.need, need);
    e.wanted = Math.max(e.wanted, w.quantity);
    if (isPriority(w.priority)) e.priority = w.priority;
  }
  return { entries: [...byKey.values()].filter((e) => e.need > 0), got };
}

export interface WantGroup {
  set: CatalogSet;
  /** In the set's order */
  entries: WantEntry[];
}

/** The want list set by set (cards the catalog doesn't know are left out). */
export function groupBySet(entries: WantEntry[], catalog: Pick<Catalog, 'byId'>): WantGroup[] {
  const groups = new Map<string, { set: CatalogSet; entries: { e: WantEntry; card: CatalogCard }[] }>();
  for (const e of entries) {
    const card = catalog.byId.get(e.cardId);
    if (!card) continue;
    const g = groups.get(card.set.id) ?? { set: card.set, entries: [] };
    g.entries.push({ e, card });
    groups.set(card.set.id, g);
  }
  return [...groups.values()].map((g) => ({
    set: g.set,
    entries: g.entries.sort((a, b) => a.card.order - b.card.order || a.e.variant.localeCompare(b.e.variant)).map((x) => x.e),
  }));
}

export interface EntryPrice {
  /** One copy, in the currency shown; null when no price is known */
  each: number | null;
  /** Priced for the printing wanted (else it's the card's usual printing) */
  exact: boolean;
  detail: string;
}

/**
 * One raw near-mint copy of the printing wanted, valued the way the collection is (TCGplayer for
 * that printing, PriceCharting, Cardmarket) from the prices stored for the card; without any, the
 * catalog's price for the card's usual printing (`usual`).
 */
export function priceEntry(entry: Pick<WantEntry, 'variant'>, rows: PriceRow[] | undefined, ctx: ValueContext, usual: number | null): EntryPrice {
  if (rows?.length) {
    const v = valueItem({ variant: entry.variant, language: 'en', grader: 'RAW', grade: null, gradeLabel: null }, rows, [], ctx);
    if (v.unit !== null) return { each: v.unit, exact: true, detail: v.detail };
  }
  return { each: usual, exact: false, detail: usual === null ? 'No price yet' : 'Market price of its usual printing' };
}

/** At or under the most you said you'd pay. */
export function isDeal(entry: Pick<WantEntry, 'want'>, each: number | null, convert: (amount: number | null, from: string) => number | null): boolean {
  const w = entry.want;
  if (!w || w.maxPrice === null || each === null) return false;
  const limit = convert(w.maxPrice, w.maxCurrency ?? 'USD');
  return limit !== null && each <= limit + 0.005;
}

// ---------- budget ----------

export const PLAN_MODES = {
  priority: 'Must-haves first',
  most: 'Most cards',
  top: 'Biggest cards',
} as const;
export type PlanMode = keyof typeof PLAN_MODES;
export const isPlanMode = (v: unknown): v is PlanMode => typeof v === 'string' && v in PLAN_MODES;

export interface PlanPick {
  entry: WantEntry;
  /** One copy */
  price: number;
  copies: number;
}

export interface BudgetPlan {
  budget: number;
  /** Kept back for prices moving and postage */
  buffer: number;
  /** The budget less the buffer: what the plan spends at most */
  spendable: number;
  /** In the order they were picked */
  picks: PlanPick[];
  spent: number;
  copies: number;
  /** Per priority: copies picked of those wanted, and what they cost */
  tiers: Record<WantPriority, { got: number; of: number; spent: number }>;
  /** The most wanted card that didn't fit, and how much more it would take */
  next: { entry: WantEntry; price: number; short: number } | null;
  /** Copies left out for having no price */
  unpriced: number;
}

/**
 * The best cards a budget gets, keeping `bufferPercent` of it back:
 *  - priority: as many must-haves as it can (cheapest first), then wants, then somedays. Taking
 *    the cheapest of each first gets the most of each, and leaves the most for the next.
 *  - most: as many cards as it can, cheapest first.
 *  - top: within each priority, the most valuable cards that fit.
 */
export function planBudget(
  entries: WantEntry[],
  priceOf: (e: WantEntry) => number | null,
  budget: number,
  bufferPercent: number,
  mode: PlanMode,
): BudgetPlan {
  const total = Math.max(0, budget);
  const buffer = Math.round(total * Math.min(Math.max(bufferPercent, 0), 90)) / 100;
  const spendable = total - buffer;
  const tiers = { 1: { got: 0, of: 0, spent: 0 }, 2: { got: 0, of: 0, spent: 0 }, 3: { got: 0, of: 0, spent: 0 } } as BudgetPlan['tiers'];
  const units: { entry: WantEntry; price: number; at: number }[] = [];
  let unpriced = 0;
  entries.forEach((entry, at) => {
    tiers[entry.priority].of += entry.need;
    const price = priceOf(entry);
    if (price === null) unpriced += entry.need;
    else for (let i = 0; i < entry.need; i++) units.push({ entry, price, at });
  });
  const order = {
    priority: (a: (typeof units)[number], b: (typeof units)[number]) => a.entry.priority - b.entry.priority || a.price - b.price || a.at - b.at,
    most: (a: (typeof units)[number], b: (typeof units)[number]) => a.price - b.price || a.entry.priority - b.entry.priority || a.at - b.at,
    top: (a: (typeof units)[number], b: (typeof units)[number]) => a.entry.priority - b.entry.priority || b.price - a.price || a.at - b.at,
  }[mode];
  units.sort(order);

  const picks = new Map<string, PlanPick>();
  let spent = 0;
  let missed: (typeof units)[number] | null = null;
  for (const u of units) {
    if (spent + u.price <= spendable + 0.005) {
      spent += u.price;
      tiers[u.entry.priority].got++;
      tiers[u.entry.priority].spent += u.price;
      const p = picks.get(u.entry.key);
      if (p) p.copies++;
      else picks.set(u.entry.key, { entry: u.entry, price: u.price, copies: 1 });
    } else {
      missed ??= u;
    }
  }
  const left = spendable - spent;
  return {
    budget: total,
    buffer,
    spendable,
    picks: [...picks.values()],
    spent,
    copies: [...picks.values()].reduce((n, p) => n + p.copies, 0),
    tiers,
    next: missed ? { entry: missed.entry, price: missed.price, short: Math.max(0.01, missed.price - left) } : null,
    unpriced,
  };
}

// ---------- ticked off ----------

/** Copies of each card on the want list last time, to notice ones got since. */
export type WantSnapshot = Record<string, number>;

export const snapshotOf = (entries: WantEntry[]): WantSnapshot => Object.fromEntries(entries.map((e) => [e.key, e.owned]));

/** Cards that were on the list and of which the collection has more copies now. */
export function gotSince(before: WantSnapshot | null, owned: Map<string, number>): string[] {
  if (!before) return [];
  return Object.entries(before)
    .filter(([key, had]) => (owned.get(key) ?? 0) > had)
    .map(([key]) => key);
}
