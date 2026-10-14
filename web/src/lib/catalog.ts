// Our own card catalog (built by scripts/build-catalog.mjs, served as static JSON):
// fast offline search, artist index and the data the scanner matches against.

export interface CatalogSet {
  id: string;
  name: string;
  serie: string | null;
  serieName: string | null;
  date: string | null;
  official: number | null;
  total: number | null;
  code: string | null;
  logo: string | null;
  symbol: string | null;
  /** normalized helpers */
  words: string[];
  codeKey: string | null;
}

export interface CatalogCard {
  id: string;
  name: string;
  number: string;
  set: CatalogSet;
  artist: string | null;
  rarity: string | null;
  category: string | null;
  hp: number | null;
  /** Base image URL (append /low.webp or /high.webp), null when no scan exists */
  image: string | null;
  nameKey: string;
  nameWords: string[];
  nameCompact: string;
  numKey: string;
  order: number;
}

export interface ArtistInfo {
  name: string;
  key: string;
  cards: CatalogCard[];
}

export interface Catalog {
  builtAt: string;
  sets: CatalogSet[];
  cards: CatalogCard[];
  byId: Map<string, CatalogCard>;
  byNumber: Map<string, CatalogCard[]>;
  byName: Map<string, CatalogCard[]>;
  bySet: Map<string, CatalogCard[]>;
  artists: ArtistInfo[];
  artistByKey: Map<string, ArtistInfo>;
}

export interface CatalogJson {
  builtAt: string;
  imageBase: string;
  sets: Omit<CatalogSet, 'words' | 'codeKey'>[];
  artists: string[];
  rarities: string[];
  categories: string[];
  imageOverrides: Record<string, string>;
  cards: [string, string, string, number, number, number, number, number, number?][];
}

/** "Farfetch'd" → "farfetchd", "Flabébé" → "flabebe", "Mr. Mime" → "mr mime" */
export function normName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Same grouping key the catalog builder uses for artists. */
export const artistKey = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Card numbers compared without padding: "025" → "25", "TG05" → "TG5", "SWSH050" → "SWSH50". */
export function normNum(s: string): string {
  const t = s.toUpperCase().replace(/\s+/g, '');
  const m = t.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
  return m ? `${m[1]}${parseInt(m[2], 10)}${m[3]}` : t;
}

export function buildCatalog(json: CatalogJson): Catalog {
  const sets: CatalogSet[] = json.sets.map((s) => ({
    ...s,
    words: normName(s.name).split(' ').filter(Boolean),
    codeKey: s.code ? s.code.toLowerCase() : null,
  }));
  const cards: CatalogCard[] = [];
  const byId = new Map<string, CatalogCard>();
  const byNumber = new Map<string, CatalogCard[]>();
  const byName = new Map<string, CatalogCard[]>();
  const bySet = new Map<string, CatalogCard[]>();
  const artistCards = new Map<string, CatalogCard[]>();

  json.cards.forEach(([id, name, number, setIdx, artistIdx, rarityIdx, categoryIdx, hasImage, hp], order) => {
    const set = sets[setIdx];
    const nameKey = normName(name);
    const card: CatalogCard = {
      id,
      name,
      number,
      set,
      artist: artistIdx >= 0 ? json.artists[artistIdx] : null,
      rarity: rarityIdx >= 0 ? json.rarities[rarityIdx] : null,
      category: categoryIdx >= 0 ? json.categories[categoryIdx] : null,
      hp: hp || null,
      image: json.imageOverrides[id] ?? (hasImage ? `${json.imageBase}/${set.serie}/${set.id}/${number}` : null),
      nameKey,
      nameWords: nameKey.split(' ').filter(Boolean),
      nameCompact: nameKey.replace(/ /g, ''),
      numKey: normNum(number),
      order,
    };
    cards.push(card);
    byId.set(id, card);
    push(byNumber, card.numKey, card);
    push(byName, nameKey, card);
    push(bySet, set.id, card);
    if (card.artist) push(artistCards, card.artist, card);
  });

  const artists: ArtistInfo[] = [...artistCards.entries()]
    .map(([name, list]) => ({ name, key: artistKey(name), cards: list }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    builtAt: json.builtAt,
    sets,
    cards,
    byId,
    byNumber,
    byName,
    bySet,
    artists,
    artistByKey: new Map(artists.map((a) => [a.key, a])),
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export const imageUrl = (base: string | null | undefined, quality: 'low' | 'high' = 'low') =>
  base ? `${base}/${quality}.webp` : null;

/** Display name for an artist string (maps TCGdex spellings to the catalog's). */
export function canonicalArtist(cat: Catalog | null, artist: string | null | undefined): string | null {
  if (!artist) return null;
  return cat?.artistByKey.get(artistKey(artist))?.name ?? artist;
}

interface ParsedQuery {
  numTotal: { num: string; total: number | null } | null;
  words: string[];
  text: string;
}

export function parseQuery(query: string): ParsedQuery {
  let text = query.toLowerCase();
  let numTotal: ParsedQuery['numTotal'] = null;
  // "4/102", "#025/165", "tg05/tg30" — must start at a word boundary ("charizard 4/102" ≠ "zard 4").
  const m = text.match(/(?:^|[\s#])([a-z]{0,4}\d{1,3}[a-z]?)\s*\/\s*([a-z]{0,4}\d{1,3})(?=\s|$)/);
  if (m) {
    numTotal = { num: normNum(m[1]), total: parseInt(m[2].replace(/\D/g, ''), 10) || null };
    text = text.replace(m[0], ' ');
  }
  const words = normName(text.replace(/#/g, ' ')).split(' ').filter(Boolean);
  return { numTotal, words, text: words.join(' ') };
}

function wordScore(card: CatalogCard, w: string): number {
  if (card.nameWords.includes(w)) return 20;
  if (card.nameWords.some((x) => x.startsWith(w))) return 14;
  if (w.length >= 3 && card.nameCompact.includes(w)) return 8;
  if (card.set.codeKey && card.set.codeKey === w) return 12;
  if (card.set.words.some((x) => x.startsWith(w))) return 6;
  if (/\d/.test(w) && card.numKey === normNum(w)) return 10;
  return 0;
}

/**
 * Search by any mix of name, set name/code and number:
 * "charizard", "charizard base set", "pikachu 25", "025/165", "umbreon vmax evs", "TG05/TG30".
 */
export function searchCards(cat: Catalog, query: string, limit = 60): CatalogCard[] {
  const q = parseQuery(query);
  if (!q.words.length && !q.numTotal) return [];
  const results: { card: CatalogCard; score: number }[] = [];
  for (const card of cat.cards) {
    let score = 0;
    if (q.numTotal) {
      if (card.numKey !== q.numTotal.num) continue;
      const t = q.numTotal.total;
      if (t !== null && card.set.official !== t && card.set.total !== t) continue;
      score += 50;
    }
    let ok = true;
    for (const w of q.words) {
      const s = wordScore(card, w);
      if (!s) {
        ok = false;
        break;
      }
      score += s;
    }
    if (!ok) continue;
    if (q.text && q.text === card.nameKey) score += 30;
    results.push({ card, score });
  }
  results.sort(
    (a, b) => b.score - a.score || (b.card.set.date ?? '').localeCompare(a.card.set.date ?? '') || a.card.order - b.card.order,
  );
  return results.slice(0, limit).map((r) => r.card);
}
