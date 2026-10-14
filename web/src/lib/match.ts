// Turns what the scanner read off a card into a ranked list of catalog matches.

import { artistKey, normName, normNum, type Catalog, type CatalogCard } from './catalog.ts';

export interface ScanGuess {
  /** Possible names read from the top of the card, best first */
  names: string[];
  /** Printed number, e.g. "025", "TG05", "SWSH050" */
  number: string | null;
  /** Printed set size, e.g. 165 from "025/165" */
  total: number | null;
  /** Set code printed on modern cards, e.g. "MEW", "SVI" */
  setCode: string | null;
  artist: string | null;
  /** Hit points printed top-right, e.g. 120 */
  hp?: number | null;
  /** Number/total readings when OCR dropped the slash ("4102" → 4/102) */
  alternatives?: { number: string; total: number }[];
}

export interface Candidate {
  card: CatalogCard;
  score: number;
  why: string[];
}

/** Sørensen–Dice similarity of character pairs; tolerant of OCR slips ("Charizarcl"). */
export function similarity(a: string, b: string): number {
  const A = a.replace(/\s+/g, '');
  const B = b.replace(/\s+/g, '');
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < A.length - 1; i++) {
    const g = A.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < B.length - 1; i++) {
    const g = B.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (A.length + B.length - 2);
}

/** Share of matching characters position-by-position, after left-padding: "025" vs "625" → 0.67. */
export function numberSimilarity(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  const len = Math.max(x.length, y.length);
  if (!len) return 0;
  const px = x.padStart(len, '0');
  const py = y.padStart(len, '0');
  let same = 0;
  for (let i = 0; i < len; i++) if (px[i] === py[i]) same++;
  return same / len;
}

export function identifyCard(cat: Catalog, guess: ScanGuess, limit = 12): Candidate[] {
  const found = new Map<string, Candidate>();
  const bump = (card: CatalogCard, points: number, why: string) => {
    let c = found.get(card.id);
    if (!c) found.set(card.id, (c = { card, score: 0, why: [] }));
    c.score += points;
    if (!c.why.includes(why)) c.why.push(why);
  };

  const numKey = guess.number ? normNum(guess.number) : null;
  const code = guess.setCode?.toLowerCase() ?? null;
  const sizeMatches = (set: CatalogCard['set']) => !!guess.total && (set.official === guess.total || set.total === guess.total);
  const codeMatches = (set: CatalogCard['set']) => !!code && !!set.codeKey && set.codeKey.split(':')[0] === code;
  if (numKey) {
    for (const card of cat.byNumber.get(numKey) ?? []) {
      bump(card, 25, 'number');
      if (sizeMatches(card.set)) bump(card, 35, 'set size');
      if (codeMatches(card.set)) bump(card, 35, 'set code');
    }
  }

  // The slash went missing ("4102"): only count splits that name a real card in a set of that size.
  if (!numKey && guess.alternatives?.length) {
    for (const alt of guess.alternatives) {
      for (const card of cat.byNumber.get(normNum(alt.number)) ?? []) {
        if (card.set.official === alt.total || card.set.total === alt.total) bump(card, 45, 'number');
      }
    }
  }

  // A digit misread ("625/165" for "025/165"): look for near-identical numbers
  // inside the sets whose size or code we did read.
  if (guess.number && (guess.total || code)) {
    for (const set of cat.sets) {
      const bySize = sizeMatches(set);
      const byCode = codeMatches(set);
      if (!bySize && !byCode) continue;
      for (const card of cat.bySet.get(set.id) ?? []) {
        if (card.numKey === numKey) continue; // exact matches were scored above
        const sim = numberSimilarity(card.number, guess.number);
        if (sim < 0.5) continue;
        bump(card, Math.round(20 * sim), 'number≈');
        if (bySize) bump(card, 25, 'set size');
        if (byCode) bump(card, 25, 'set code');
      }
    }
  }

  const targets = guess.names.map(normName).filter((n) => n.replace(/ /g, '').length >= 3);
  if (targets.length) {
    for (const [nameKey, cards] of cat.byName) {
      let best = 0;
      for (const t of targets) best = Math.max(best, similarity(t, nameKey));
      if (best < 0.55) continue;
      for (const card of cards) bump(card, Math.round(best * 40), 'name');
    }
  }

  if (guess.hp) {
    for (const c of found.values()) if (c.card.hp === guess.hp) bump(c.card, 20, 'HP');
  }

  if (guess.artist) {
    const a = artistKey(guess.artist);
    for (const c of found.values()) {
      if (c.card.artist && similarity(a, artistKey(c.card.artist)) >= 0.75) bump(c.card, 10, 'artist');
    }
  }

  return [...found.values()]
    .sort((x, y) => y.score - x.score || (y.card.set.date ?? '').localeCompare(x.card.set.date ?? ''))
    .slice(0, limit);
}
