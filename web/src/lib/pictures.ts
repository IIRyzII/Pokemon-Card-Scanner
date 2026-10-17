// Recognising a card by its picture: every catalog card's fingerprint (prints.bin, made by the
// catalog builder) compared with the fingerprint of the card the camera sees.

import { hamming, PRINT_BITS, PRINT_WORDS } from '../../../shared/cardprint.ts';
import type { CatalogCard } from './catalog.ts';

export interface PictureMatch {
  card: CatalogCard;
  /** Bits that differ (0 = identical pictures) */
  distance: number;
}

// Thresholds, scaled to the print size (they were tuned on 286-bit prints).
const scale = PRINT_BITS / 286;
/** A match this close is the same picture, through glare, blur and odd lighting. */
export const CLOSE = Math.round(70 * scale);
/** …and the next different card must be at least this much further away. */
export const CLEAR = Math.round(20 * scale);
/** Other printings of the same card within this much of the best look alike (reprints): the number decides. */
export const TWIN = Math.round(40 * scale);
/** A clear match this close is certain from a single look; others must come up twice in a row. */
export const CERTAIN = Math.round(40 * scale);
/** Beyond this, the picture is clearly a different card. */
export const UNLIKE = Math.round(100 * scale);

/** Points a picture match adds to a candidate card: up to 60 for a near-identical picture, 0 when unalike. */
export function picturePoints(distance: number): number {
  const best = Math.round(20 * scale);
  return Math.round(60 * Math.max(0, Math.min(1, (UNLIKE - distance) / (UNLIKE - best))));
}

export class PrintIndex {
  readonly words: Uint32Array;
  readonly cards: CatalogCard[];

  /** `words`: PRINT_WORDS per card, in catalog order; all zeros = no picture for that card. */
  constructor(words: Uint32Array, cards: CatalogCard[]) {
    if (words.length !== cards.length * PRINT_WORDS) throw new Error('Card pictures index does not match the catalog');
    this.words = words;
    this.cards = cards;
  }

  /** The cards whose pictures are closest to `print`, closest first. */
  nearest(print: Uint32Array, limit = 30): PictureMatch[] {
    const best: { i: number; d: number }[] = [];
    for (let i = 0; i < this.cards.length; i++) {
      const o = i * PRINT_WORDS;
      if (this.words[o] === 0 && this.words[o + 1] === 0 && this.words[o + 2] === 0) continue; // no picture
      const d = hamming(print, this.words, o);
      if (best.length === limit && d >= best[limit - 1].d) continue;
      let at = best.length;
      while (at > 0 && best[at - 1].d > d) at--;
      best.splice(at, 0, { i, d });
      if (best.length > limit) best.pop();
    }
    return best.map(({ i, d }) => ({ card: this.cards[i], distance: d }));
  }
}

/** Closest matches for a card that may be upside down: whichever way round matches better. */
export function nearestEitherWay(index: PrintIndex, upright: Uint32Array, upsideDown: Uint32Array, limit = 30): { matches: PictureMatch[]; flipped: boolean } {
  const a = index.nearest(upright, limit);
  const b = index.nearest(upsideDown, limit);
  const flipped = (b[0]?.distance ?? Infinity) < (a[0]?.distance ?? Infinity);
  return { matches: flipped ? b : a, flipped };
}

export interface PictureVerdict {
  /** The closest card */
  best: PictureMatch;
  /** Other printings of the same card whose pictures look alike (reprints), closest first */
  twins: PictureMatch[];
  /** How much further away the closest *different* card is */
  gap: number;
  /** Close and clear: the picture names the card (or, with twins, the card but not which printing) */
  clear: boolean;
}

/** What the picture alone says about which card this is. */
export function pictureVerdict(matches: PictureMatch[]): PictureVerdict | null {
  const [best, ...rest] = matches;
  if (!best) return null;
  const twins = rest.filter((m) => m.card.nameKey === best.card.nameKey && m.distance <= best.distance + TWIN);
  const rival = rest.find((m) => m.card.nameKey !== best.card.nameKey);
  const gap = rival ? rival.distance - best.distance : PRINT_BITS;
  return { best, twins, gap, clear: best.distance <= CLOSE && gap >= CLEAR };
}
