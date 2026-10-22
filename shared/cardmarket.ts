// Our own link from each catalog card to its Cardmarket product, and Cardmarket's prices for it.
//
// TCGdex passes Cardmarket's prices on, but links some cards to the wrong product: Rayquaza ☆
// (EX Deoxys 107, thousands of euros) to the plain Rayquaza of the same set (about €20), Deoxys ex
// to plain Deoxys, the four Deoxys δ forms to one of them, some cards to the card next to them.
// Cardmarket publishes its whole product list (each card's name with its attacks in brackets:
// "Rayquaza Gold Star [Spiral Rush | Holy Star]") and a daily price guide, so the catalog builder
// checks every link against the card's name and attacks, corrects the wrong ones, and publishes
// Cardmarket's own prices for each set; the API values cards from those.

import type { PriceRow } from './values.ts';

/** A product in Cardmarket's product list (singles only). */
export interface CardmarketProduct {
  idProduct: number;
  name: string;
  idExpansion: number;
}

/** Cardmarket's prices for one product, in EUR. Its "holo" prices are the reverse holo's. */
export interface CardmarketPrices {
  trend: number | null;
  low: number | null;
  avg30: number | null;
  trendHolo: number | null;
  lowHolo: number | null;
  avg30Holo: number | null;
}

/**
 * What the catalog publishes per card (catalog/cardmarket/<set>.json): the product and its prices
 * [idProduct, trend, low, avg30, trend holo, low holo, avg30 holo], or 0 when no Cardmarket
 * product could be told to be this card.
 */
export type CardmarketEntry = [number, number | null, number | null, number | null, number | null, number | null, number | null] | 0;

export interface CardmarketSetFile {
  version: 1;
  /** When Cardmarket made the price guide */
  updated: string;
  cards: Record<string, CardmarketEntry>;
}

const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

/** A row of Cardmarket's price guide (or TCGdex's copy of it) → its prices. */
export function cardmarketPrices(row: Record<string, unknown>): CardmarketPrices {
  return {
    trend: amount(row.trend),
    low: amount(row.low),
    avg30: amount(row.avg30),
    trendHolo: amount(row['trend-holo']),
    lowHolo: amount(row['low-holo']),
    avg30Holo: amount(row['avg30-holo']),
  };
}

export function entryOf(idProduct: number, p: CardmarketPrices): CardmarketEntry {
  return [idProduct, p.trend, p.low, p.avg30, p.trendHolo, p.lowHolo, p.avg30Holo];
}

export function pricesOf(entry: Exclude<CardmarketEntry, 0>): CardmarketPrices {
  const [, trend, low, avg30, trendHolo, lowHolo, avg30Holo] = entry;
  return { trend, low, avg30, trendHolo, lowHolo, avg30Holo };
}

/** Our price rows for Cardmarket's prices: the main printing, and the holo (reverse) one. */
export function cardmarketRows(p: CardmarketPrices, updatedAt: string): PriceRow[] {
  const base = { source: 'cardmarket' as const, gradeKey: 'ungraded', high: null, currency: 'EUR', url: null, updatedAt };
  const rows: PriceRow[] = [];
  if (p.trend ?? p.avg30) rows.push({ ...base, market: p.trend, low: p.low, mid: p.avg30, variant: 'main', label: 'Cardmarket' });
  if (p.trendHolo ?? p.avg30Holo) rows.push({ ...base, market: p.trendHolo, low: p.lowHolo, mid: p.avg30Holo, variant: 'holo', label: 'Cardmarket (holo / reverse)' });
  return rows;
}

/** A card or product name, spelled the same way on both sides. */
export function cardmarketName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents (Pokémon → Pokemon)
    .toLowerCase()
    .replace(/☆|★|\bgold star\b/g, ' star ') // TCGdex "Rayquaza ☆" or "Pikachu Star"; Cardmarket "Gold Star"
    .replace(/δ(\s*delta species)?/g, ' delta ') // Cardmarket: "Latias δ Delta Species"
    .replace(/◇/g, ' prism star ')
    .replace(/♂/g, ' m ') // Cardmarket: "Nidoran [M]"
    .replace(/♀/g, ' f ')
    .replace(/\blv\.?\s*x\b/g, ' lvx ')
    .replace(/\blv\.?\s*\d+\b/g, ' ') // Cardmarket gives Diamond & Pearl era cards' levels: "Heatran Lv.47"
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A product's name and its attacks (Pokémon Powers and Abilities too), from "Name [Attack | Attack]". */
export function productParts(name: string): { name: string; moves: string[] } {
  // The last bracket holds the attacks; an earlier one is part of the name ("Unown [Y] [Yield | …]").
  const m = name.match(/^(.*?)\s*\[([^[\]]*)\]\s*$/);
  if (!m || /^[A-Z?!]$/.test(m[2].trim())) return { name: cardmarketName(name), moves: [] };
  return { name: cardmarketName(m[1]), moves: m[2].split('|').map(cardmarketName).filter(Boolean) };
}

/** Edit distance, for names and attacks spelled a little differently ("Imposter"/"Impostor"). */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** How far (in the set's order) a card's neighbours can be to say where its product is numbered… */
const NEARBY = 20;
/** …and how close to that a look-alike product must be numbered to be taken as the card's. */
const IN_PLACE = 3;

const near = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 6 && distance(a, b) <= 2) || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));

export interface LinkInput {
  id: string;
  name: string;
  /** The card's attacks, Abilities and Pokémon Powers / Bodies */
  moves: string[];
  /** TCGdex's Cardmarket product for the card, if it has one */
  hint: number | null;
}

/**
 * How a card's product was settled: TCGdex's link confirmed, corrected, picked from several
 * products that look the same (a card and its holo printing, say), or none found.
 */
export type LinkHow = 'checked' | 'corrected' | 'guessed' | 'none';

export interface CardmarketIndex {
  byId: Map<number, CardmarketProduct>;
  byExpansion: Map<number, CardmarketProduct[]>;
  parts: Map<number, { name: string; moves: string[] }>;
}

export function cardmarketIndex(products: CardmarketProduct[]): CardmarketIndex {
  const byExpansion = new Map<number, CardmarketProduct[]>();
  for (const p of products) {
    const list = byExpansion.get(p.idExpansion);
    if (list) list.push(p);
    else byExpansion.set(p.idExpansion, [p]);
  }
  return { byId: new Map(products.map((p) => [p.idProduct, p])), byExpansion, parts: new Map(products.map((p) => [p.idProduct, productParts(p.name)])) };
}

/**
 * Each card of one set (in the set's order) → its Cardmarket product. Products are looked for in the
 * Cardmarket expansions TCGdex links the set's cards to: the same name (spelled the same way), and
 * the most attacks in common.
 */
export function linkSet(index: CardmarketIndex, cards: LinkInput[]): Map<string, { product: number | null; how: LinkHow }> {
  const counts = new Map<number, number>();
  for (const c of cards) {
    const e = c.hint !== null ? index.byId.get(c.hint)?.idExpansion : undefined;
    if (e !== undefined) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  const hinted = [...counts.values()].reduce((a, b) => a + b, 0);
  const mainExpansions = [...counts].filter(([, n]) => n >= Math.max(2, 0.1 * hinted)).map(([e]) => e);

  // Each card's best-fitting products: none (null), one, or several that look the same.
  const fits = cards.map((card) => {
    const hint = card.hint !== null ? index.byId.get(card.hint) : undefined;
    const name = cardmarketName(card.name);
    const moves = card.moves.map(cardmarketName).filter(Boolean);
    const movesInCommon = (id: number) => {
      const theirs = index.parts.get(id)!.moves;
      return moves.filter((m) => theirs.some((t) => near(m, t))).length;
    };
    const contradicts = (id: number) => moves.length > 0 && index.parts.get(id)!.moves.length > 0 && movesInCommon(id) === 0;
    const expansions = new Set([...mainExpansions, ...(hint ? [hint.idExpansion] : [])]);
    let best: number[] = [];
    let bestKey = -1;
    for (const e of expansions) {
      for (const p of index.byExpansion.get(e) ?? []) {
        const theirs = index.parts.get(p.idProduct)!;
        const named = theirs.name === name ? 2 : Math.min(name.length, theirs.name.length) >= 8 && distance(name, theirs.name) <= 2 ? 1 : 0;
        if (!named || contradicts(p.idProduct)) continue;
        const key = movesInCommon(p.idProduct) * 4 + named;
        if (key > bestKey) {
          bestKey = key;
          best = [p.idProduct];
        } else if (key === bestKey) best.push(p.idProduct);
      }
    }
    // No product by that name: keep TCGdex's when its attacks agree (a name spelled differently).
    if (!best.length && hint && moves.length && movesInCommon(hint.idProduct) > 0) best = [hint.idProduct];
    return { hint: hint?.idProduct ?? null, best };
  });

  // Products that look the same (Aquapolis: each holo "H" card and its numbered printing; TCGdex
  // swaps every pair; full-art and regular printings in some sets). Cardmarket numbers a set's
  // products in the set's order, so one numbered right where the nearest cards only one product
  // fits say it should be goes to that card; the rest get TCGdex's, or one no other card has.
  // (Promos come in many look-alike versions, staff and prerelease stamps, numbered in no order.)
  const anchors = fits.map((f) => (f.best.length === 1 ? f.best[0] : null));
  const taken = new Set(anchors.filter((a) => a !== null));
  // Where the card's product would be numbered, going by the nearest such card on each side (each
  // on its own: the two can be in different runs of numbers, like a set's main cards and its holos).
  const expected = (i: number): number[] => {
    const guesses: number[] = [];
    for (let j = i - 1; j >= Math.max(0, i - NEARBY); j--) if (anchors[j] !== null) { guesses.push(anchors[j]! + (i - j)); break; }
    for (let j = i + 1; j <= Math.min(cards.length - 1, i + NEARBY); j++) if (anchors[j] !== null) { guesses.push(anchors[j]! - (j - i)); break; }
    return guesses;
  };
  const open = fits.flatMap((f, i) => (f.best.length > 1 ? [{ i, ...f }] : []));
  const picked = new Map<number, number>();
  const fitsBest = open
    .flatMap(({ i, best }) => {
      const at = expected(i);
      return best.flatMap((p) => (at.length ? [{ i, p, off: Math.min(...at.map((g) => Math.abs(p - g))) }] : []));
    })
    .filter((f) => f.off <= IN_PLACE)
    .sort((a, b) => a.off - b.off || a.p - b.p);
  for (const { i, p } of fitsBest) {
    if (picked.has(i) || taken.has(p)) continue;
    picked.set(i, p);
    taken.add(p);
  }
  for (const { i, hint, best } of open) {
    if (picked.has(i)) continue;
    const order = [...best].sort((a, b) => (b === hint ? 1 : 0) - (a === hint ? 1 : 0) || a - b);
    const p = order.find((id) => !taken.has(id)) ?? order[0];
    picked.set(i, p);
    taken.add(p);
  }

  const result = new Map<string, { product: number | null; how: LinkHow }>();
  fits.forEach(({ hint, best }, i) => {
    const product = best.length > 1 ? picked.get(i)! : (best[0] ?? null);
    const how: LinkHow = product === null ? 'none' : product === hint ? 'checked' : best.length > 1 ? 'guessed' : 'corrected';
    result.set(cards[i].id, { product, how });
  });
  return result;
}
