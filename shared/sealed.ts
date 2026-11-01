// Sealed products (booster boxes, Elite Trainer Boxes, packs, tins and the rest), from Cardmarket's
// public list of the Pokémon products that aren't single cards, priced from its daily price guide.
// The catalogue build publishes them as sealed.json; sealed items in the collection refer to them
// by Cardmarket's product id.

/** What we call each kind of product, in the order they're offered. */
export const SEALED_TYPES = [
  'Booster box',
  'Elite Trainer Box',
  'Booster pack',
  'Box set',
  'Tin',
  'Theme deck',
  'Blister',
  'Trainer kit',
  'Coin',
  'Set',
  'Lot',
  'Other',
] as const;
export type SealedType = (typeof SEALED_TYPES)[number];

/** Cardmarket's categories of sealed Pokémon products (it calls booster boxes "displays"). */
const CATEGORIES: Readonly<Record<number, SealedType>> = {
  53: 'Booster box',
  1016: 'Elite Trainer Box',
  52: 'Booster pack',
  1015: 'Box set',
  1014: 'Tin',
  54: 'Theme deck',
  1083: 'Blister',
  1013: 'Trainer kit',
  1017: 'Coin',
  1654: 'Set',
  1064: 'Lot',
};

export const sealedType = (idCategory: number): SealedType => CATEGORIES[idCategory] ?? 'Other';

/**
 * A product in sealed.json: [Cardmarket's product id, name, type (index into SEALED_TYPES), our
 * set's id or 0 (its Cardmarket expansion isn't one of our sets), when Cardmarket added it
 * (YYYY-MM-DD), trend price, 30-day average price (EUR; 0 when there's none)].
 */
export type SealedRow = [number, string, number, string | 0, string, number, number];

export interface SealedFile {
  version: 1;
  /** When Cardmarket made its price guide */
  updated: string;
  products: SealedRow[];
}

/** A product in Cardmarket's list of sealed products */
export interface NonSingle {
  idProduct: number;
  name: string;
  idCategory: number;
  idExpansion: number;
  dateAdded: string;
}

/** A row of Cardmarket's price guide */
export interface GuideRow {
  idProduct: number;
  trend?: number | null;
  avg30?: number | null;
}

const euros = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0);

/**
 * Which of our sets each Cardmarket expansion is: the set most of the cards linked to its products
 * belong to. `links`: each linked card's set, and its Cardmarket product's expansion.
 */
export function expansionSets(links: Iterable<{ setId: string; idExpansion: number }>): Map<number, string> {
  const counts = new Map<number, Map<string, number>>();
  for (const { setId, idExpansion } of links) {
    const bySet = counts.get(idExpansion) ?? new Map<string, number>();
    bySet.set(setId, (bySet.get(setId) ?? 0) + 1);
    counts.set(idExpansion, bySet);
  }
  return new Map([...counts].map(([e, bySet]) => [e, [...bySet].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]]));
}

/** sealed.json from Cardmarket's list of sealed products and its price guide: newest first. */
export function sealedFile(products: readonly NonSingle[], guide: Iterable<GuideRow>, setOf: ReadonlyMap<number, string>, updated: string): SealedFile {
  const prices = new Map([...guide].map((g) => [g.idProduct, g]));
  const rows = products
    .filter((p) => typeof p.idProduct === 'number' && typeof p.name === 'string' && p.name.trim())
    .map((p): SealedRow => {
      const g = prices.get(p.idProduct);
      return [p.idProduct, p.name.trim(), SEALED_TYPES.indexOf(sealedType(p.idCategory)), setOf.get(p.idExpansion) ?? 0, String(p.dateAdded ?? '').slice(0, 10), euros(g?.trend), euros(g?.avg30)];
    });
  rows.sort((a, b) => b[4].localeCompare(a[4]) || a[1].localeCompare(b[1]));
  return { version: 1, updated, products: rows };
}

/**
 * A sealed product's value (EUR): Cardmarket's trend price, else its 30-day average. Not its lowest
 * price: one odd listing (a booster box offered at €100,000) makes that meaningless.
 */
export const sealedPrice = (row: SealedRow): number | null => row[5] || row[6] || null;
