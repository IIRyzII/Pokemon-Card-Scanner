// Raw market prices from TCGdex (which aggregates TCGplayer in USD and Cardmarket in EUR).
// Used by the API for the cards in the collection, and by the catalog builder for every card
// (the "standard price" behind set values).

import type { PriceRow } from './values.ts';

/** The pricing part of a TCGdex card. */
export interface TcgdexPricing {
  pricing?: {
    tcgplayer?: Record<string, unknown> | null;
    cardmarket?: Record<string, unknown> | null;
  } | null;
}

/** TCGplayer's printing names → our variant keys. */
export function tcgplayerVariant(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('1st')) return 'firstEdition';
  if (k.includes('reverse')) return 'reverse';
  if (k.includes('holo')) return 'holo';
  if (k.includes('normal')) return 'normal';
  return k;
}

const price = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

export function extractPrices(raw: TcgdexPricing, now: string): PriceRow[] {
  const rows: PriceRow[] = [];
  const tcg = raw.pricing?.tcgplayer;
  if (tcg && typeof tcg === 'object') {
    const updated = typeof tcg.updated === 'string' ? tcg.updated : now;
    for (const [key, value] of Object.entries(tcg)) {
      if (key === 'unit' || key === 'updated' || !value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      const row: PriceRow = {
        source: 'tcgplayer',
        variant: tcgplayerVariant(key),
        gradeKey: 'ungraded',
        market: price(v.marketPrice),
        low: price(v.lowPrice),
        mid: price(v.midPrice),
        high: price(v.highPrice),
        currency: 'USD',
        label: key,
        url: typeof v.productId === 'number' ? `https://www.tcgplayer.com/product/${v.productId}` : null,
        updatedAt: updated,
      };
      if (row.market ?? row.low ?? row.mid ?? row.high) rows.push(row);
    }
  }
  const cm = raw.pricing?.cardmarket;
  if (cm && typeof cm === 'object') {
    const updated = typeof cm.updated === 'string' ? cm.updated : now;
    const base = { source: 'cardmarket' as const, gradeKey: 'ungraded', high: null, currency: 'EUR', url: null, updatedAt: updated };
    const main = { market: price(cm.trend), low: price(cm.low), mid: price(cm.avg30) };
    const holo = { market: price(cm['trend-holo']), low: price(cm['low-holo']), mid: price(cm['avg30-holo']) };
    if (main.market ?? main.mid) rows.push({ ...base, ...main, variant: 'main', label: 'Cardmarket' });
    if (holo.market ?? holo.mid) rows.push({ ...base, ...holo, variant: 'holo', label: 'Cardmarket (holo / reverse)' });
  }
  return rows;
}

// The printing a set collector would buy: the plain one when it exists.
const STANDARD_ORDER = ['normal', 'holo', 'firstEdition', 'reverse', 'wPromo'];

/**
 * Market price of one raw (near mint) copy of a card's standard printing, in the currency it's
 * quoted in: TCGplayer's market price, else Cardmarket's trend for cards TCGplayer doesn't list.
 * `variants`: TCGdex's printing flags for the card ({ normal: true, reverse: true, … }).
 */
export function standardPrice(variants: Record<string, boolean> | null | undefined, rows: PriceRow[]): { amount: number; currency: string } | null {
  const printings = STANDARD_ORDER.filter((v) => variants?.[v]);
  for (const v of printings.length ? printings : STANDARD_ORDER) {
    const row = rows.find((r) => r.source === 'tcgplayer' && r.variant === v && r.market !== null);
    if (row?.market) return { amount: row.market, currency: row.currency };
  }
  // Cardmarket's top-level price is the main printing; its "holo" price is the reverse holo.
  const cm =
    rows.find((r) => r.source === 'cardmarket' && r.variant === (printings[0] === 'reverse' ? 'holo' : 'main') && r.market !== null) ??
    rows.find((r) => r.source === 'cardmarket' && r.market !== null);
  return cm?.market ? { amount: cm.market, currency: cm.currency } : null;
}
