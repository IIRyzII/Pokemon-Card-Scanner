// Which printings a card comes in. TCGdex details each card's printings (special foils and
// stamps too); for the sets it has no printing data for (it marks every card in them "normal":
// most Black & White, XY and Sun & Moon sets) they're worked out from its rarity. Those eras
// follow one pattern: commons, uncommons and rares come as a regular card and a reverse holo, holo
// rares as a holo and a reverse holo, and EX / GX / BREAK / full art / secret cards only as holos.

import { VARIANTS, type Variant } from './grading.ts';

/** Sets without reverse holos: promos, starter and special sets sold outside booster packs. */
const NO_REVERSE = /^(bwp|xyp|smp|xy0|xya|g1|dc1|dv1|det1|sma|ru1|mfb|ex5\.5|tk-|mcd)/;

/** Cards that are only ever holos (the "special" rarities, or EX / GX / BREAK / LV.X / Prism Star names). */
const HOLO_ONLY =
  /ultra|secret|rainbow|prism|break|shiny|amazing|radiant|legend|lv\.?x|prime|ace|star|holo (ex|gx|v|vmax|vstar)\b|full art/;
const HOLO_NAME = /(?:[ -](?:ex|gx|break|lv\.x))$|◇|☆/i;

export interface PrintingInput {
  setId: string;
  name: string;
  /** Its rarity as pokemon-tcg-data (or TCGdex) gives it: "Rare Holo", "Rare Holo GX", "Common"… */
  rarity: string | null;
}

// ---------- special printings ----------
//
// Beyond the five plain printings, a card can come with a special foil (a cosmos holo from a
// blister pack, Prismatic Evolutions' Poké Ball and Master Ball reverse holos) or stamps (a set
// logo on Build & Battle promos, a staff stamp, a GameStop or EB Games stamp). TCGdex details them;
// we write each as its plain printing, then "~foil", then its stamps: "holo~cosmos",
// "reverse+gamestop", "holo~cosmos+snowflake", "holo+set-logo+staff".

export interface PrintingParts {
  base: string;
  foil: string | null;
  stamps: string[];
}

const PLAIN = VARIANTS as readonly string[];

/** A TCGdex printing's key. A kind of card that isn't a plain printing (a metal card) is a special holo: "holo~gold-metal". */
export function printingKey({ type, foil, stamp }: { type: string; foil?: string | null; stamp?: readonly string[] | null }): string {
  const plain = PLAIN.includes(type);
  const finish = plain ? foil : [foil, type].filter(Boolean).join('-');
  return `${plain ? type : 'holo'}${finish ? `~${finish}` : ''}${stamp?.length ? `+${[...stamp].sort().join('+')}` : ''}`;
}

export function parsePrinting(key: string): PrintingParts {
  const [head, ...stamps] = key.split('+');
  const [base, foil = null] = head.split('~');
  return { base, foil, stamps };
}

/** A printing with a special foil or stamps (not one of the five plain ones). */
export const isSpecialPrinting = (key: string) => key.includes('~') || key.includes('+');

export const basePrinting = (key: string) => parsePrinting(key).base;

/** A printing as the API stores it: a plain one, or a special one built on a plain one. */
export const isPrintingKey = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 120 && /^(normal|holo|reverse|firstEdition|wPromo)(~[a-z0-9-]{1,40})?(\+[a-z0-9-]{1,40}){0,6}$/.test(v);

const FOIL_LABELS: Record<string, string> = {
  pokeball: 'Poké Ball',
  masterball: 'Master Ball',
  quickball: 'Quick Ball',
  friendball: 'Friend Ball',
  loveball: 'Love Ball',
  duskball: 'Dusk Ball',
  'team-rocket': 'Team Rocket',
};
const STAMP_LABELS: Record<string, string> = {
  'set-logo': 'Set logo',
  'pre-release': 'Prerelease',
  gamestop: 'GameStop',
  'eb-games': 'EB Games',
  'pokemon-center': 'Pokémon Center',
  'pokemon-center-ny': 'Pokémon Center NY',
  'player-rewards-program': 'Player Rewards',
  '1st-edition': '1st Edition',
  mcdonalds: "McDonald's",
  wotc: 'WotC',
  'w-promo': 'W Promo',
  'trick-or-trade': 'Trick or Trade',
};
const words = (slug: string) =>
  slug
    .replace(/-/g, ' ')
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    .replace(/\bPokemon\b/g, 'Pokémon');
const PLAIN_LABELS: Record<string, string> = { normal: 'Regular', holo: 'Holo', reverse: 'Reverse Holo', firstEdition: '1st Edition', wPromo: 'W Promo' };

/** "Cosmos Holo", "Poké Ball Reverse Holo", "Gold Metal", "Holo · Set logo + Staff stamps", "Regular · GameStop stamp". */
export function printingLabel(key: string): string {
  const { base, foil, stamps } = parsePrinting(key);
  const plain = PLAIN_LABELS[base] ?? words(base);
  const foilLabel = foil ? (FOIL_LABELS[foil] ?? words(foil)) : '';
  // A metal card isn't a holo of any kind
  const finish = !foil ? plain : /(^|-)metal$/.test(foil) ? foilLabel : `${foilLabel} ${base === 'normal' ? 'Foil' : plain}`;
  return stamps.length ? `${finish} · ${stamps.map((s) => STAMP_LABELS[s] ?? words(s)).join(' + ')} stamp${stamps.length > 1 ? 's' : ''}` : finish;
}

/**
 * A printing the card doesn't come in (recorded before its printings were known, e.g. a Shuckle-GX
 * saved as "normal") taken as its main printing, or as the special printing it only comes in that
 * way (Paradox Rift's Snorunt was only ever a holo as a cosmos holo); anything else as it is.
 */
export function fixPrinting(variant: string, known: readonly string[] | null | undefined): string {
  if (!known?.length || known.includes(variant) || isSpecialPrinting(variant)) return variant;
  return known.find((k) => isSpecialPrinting(k) && basePrinting(k) === variant) ?? known.find((k) => !isSpecialPrinting(k)) ?? known[0];
}

/**
 * The order printings are offered in (and the first one picked): the plain ones as they come, except
 * that a card that only comes as a holo and a reverse holo offers the reverse holo first (Regular
 * cards offer Regular, then Reverse Holo; holo-and-reverse cards Reverse Holo, then Holo), then the
 * special ones.
 */
export function printingOrder<T extends string>(printings: readonly T[]): T[] {
  const plain = printings.filter((p) => !isSpecialPrinting(p));
  const special = printings.filter((p) => isSpecialPrinting(p));
  const holoAndReverse = plain.length === 2 && plain.includes('holo' as T) && plain.includes('reverse' as T);
  return [...(holoAndReverse ? (['reverse', 'holo'] as T[]) : plain), ...special];
}

/**
 * The printings to offer when adding a card: the catalog's (best guess first, its special ones
 * too), then any other plain ones the API allows, unless the card only comes in that printing as a
 * special one (Snorunt's holo is its cosmos holo).
 */
export function preferPrintings(allowed: readonly string[], preferred: readonly string[] | null | undefined): string[] {
  const first = (preferred ?? []).filter((v) => allowed.includes(v) || isSpecialPrinting(v));
  const covered = (v: string) => first.includes(v) || first.some((f) => isSpecialPrinting(f) && basePrinting(f) === v);
  return printingOrder([...first, ...allowed.filter((v) => !covered(v))]);
}

// ---------- the printings of a set's cards (the catalog builder) ----------

/** One of a card's printings as TCGdex details it: its key, and its Cardmarket product (0: none). */
export type DetailedPrinting = [key: string, cardmarket: number];

export interface CardPrintings {
  /** The plain printings it comes in (VARIANTS order) */
  basics: Variant[];
  /** Its special printings (a foil or stamps), plain printing order */
  specials: string[];
}

const byPlainOrder = (a: string, b: string) => PLAIN.indexOf(basePrinting(a)) - PLAIN.indexOf(basePrinting(b)) || a.localeCompare(b);

/** The stamps TCGdex uses that aren't a player's name (events, stores, programs, set logos…). */
const EVENT_STAMPS = new Set(
  (
    'set-logo 1st-edition 30th-anniversary player-rewards-program staff 25th-celebration pre-release snowflake winner ' +
    'professor-program pokemon-center countdown-calendar mcdonalds regional-championships pikachu national-championships ' +
    'eb-games gamestop gym-challenge platinum bulbasaur charmander squirtle finalist semi-finalist top-sixteen top-thirty-two ' +
    'state-championships pokemon-day pikachu-tail quarter-finalist city-championships pokeball comic-con horizons wotc top-eight ' +
    '1st-movie-inverted 1st-movie champion international-championship-europe international-championship-latin-america ' +
    'international-championship-north-america pop-tournament thank-you master-ball-league ultra-ball-league pokemon-4-ever ' +
    'pokemon-center-ny stadium-challenge gen-con distributor-meeting trick-or-trade 30th-pokeday ace-trainer poketour-99 grey-star ' +
    'jr-stamp-rally w-promo scrye inquest-gamer destiny-deoxys wizard-world-philadelphia nintendo-world wizard-world-chicago ' +
    'pokemon-rocks-america origins games-expo kraze-club rain-city asia-promo pokemon-together judge great-ball-league ' +
    'poke-ball-league fossil-museum'
  ).split(' '),
);

/**
 * Printings that aren't a set's at all: World Championships deck cards (stamped with the player's
 * name, a different back) and misprints ("1st-edition-scratch-error"). Left out of the catalog.
 * A new kind of event stamp looks like a name until it's added to EVENT_STAMPS.
 */
export function isOffSetStamp(stamp: string): boolean {
  if (EVENT_STAMPS.has(stamp) || /\d/.test(stamp) || /(^|-)(league|day|contest|championships?|anniversary|celebration)($|-)/.test(stamp)) {
    return stamp.endsWith('-error');
  }
  return /^[a-z]+(-[a-z]+){1,3}$/.test(stamp) || stamp.endsWith('-error');
}

/**
 * A card's printings from TCGdex's detailed list. A 1st Edition or W stamp alone is the plain
 * printing of that name. A card with no plain printing at all (a promo that only exists stamped,
 * like SVP 057 Chi-Yu with its set logo) has its own simplest form as its plain printing.
 * Two quirks of the list are undone: a foil it gives a card's 1st Edition printing is the card's
 * own finish (it gives every Fossil card a "galaxy" one, unlimited and 1st Edition alike), and it
 * lists some gold secret and hyper rares twice, as a holo and as a gold holo.
 */
export function cardPrintings(detailed: readonly DetailedPrinting[]): CardPrintings | null {
  if (!detailed.length) return null;
  const basics = new Set<Variant>();
  const specials: string[] = [];
  const plainOf = (key: string): Variant | null => {
    const { base, foil, stamps } = parsePrinting(key);
    if (foil) return null;
    if (!stamps.length) return PLAIN.includes(base) ? (base as Variant) : null;
    if (stamps.length === 1 && stamps[0] === '1st-edition') return 'firstEdition';
    if (stamps.length === 1 && stamps[0] === 'w-promo') return 'wPromo';
    return null;
  };
  const listed = [...new Set(detailed.map(([k]) => k))].filter((k) => !parsePrinting(k).stamps.some(isOffSetStamp));
  const ownFinish = new Set(
    listed
      .map(parsePrinting)
      .filter((p) => p.foil && p.stamps.length === 1 && p.stamps[0] === '1st-edition')
      .map((p) => `${p.base}~${p.foil}`),
  );
  let keys = [
    ...new Set(
      listed.map((k) => {
        const p = parsePrinting(k);
        return ownFinish.has(`${p.base}~${p.foil}`) ? printingKey({ type: p.base, stamp: p.stamps }) : k;
      }),
    ),
  ];
  if (keys.includes('holo')) keys = keys.filter((k) => k !== 'holo~gold');
  if (!keys.length) return null;
  if (keys.some((k) => plainOf(k))) {
    for (const k of keys) {
      const p = plainOf(k);
      if (p) basics.add(p);
      else specials.push(k);
    }
  } else {
    // Only special forms: for each plain printing, its simplest form is the card itself.
    const simplest = new Map<string, string>();
    const parts = (k: string) => parsePrinting(k).stamps.length + (parsePrinting(k).foil ? 1 : 0);
    for (const k of keys) {
      const base = basePrinting(k);
      const now = simplest.get(base);
      if (!now || parts(k) < parts(now)) simplest.set(base, k);
    }
    for (const k of keys) {
      if (simplest.get(basePrinting(k)) === k && PLAIN.includes(basePrinting(k))) basics.add(basePrinting(k) as Variant);
      else specials.push(k);
    }
  }
  return { basics: VARIANTS.filter((v) => basics.has(v)), specials: specials.sort(byPlainOrder) };
}

/** Under this share of the cards of one rarity in a set, a plain printing is a promo… */
const PROMO_SHARE = 0.15;
/** …judged among at least this many cards. */
const PROMO_AMONG = 8;
/**
 * Reverse holo patterns that come in packs (Prismatic Evolutions' Poké Ball and Master Ball, the
 * Energy and Team Rocket ones). Any other special foil is a promo's: a cosmos holo from a blister
 * pack or box, cracked ice from a trainer kit, a League reverse holo, a gold metal card. (How many
 * cards have it doesn't tell them apart: cosmos promos are 30-44% of some sets' rares, while a
 * pattern can be 13% of a rarity, when each Pokémon type gets its own Poké Ball.)
 */
const PACK_FOILS = new Set(['pokeball', 'masterball', 'quickball', 'friendball', 'loveball', 'duskball', 'energy', 'team-rocket']);

/**
 * Which printings of a set's cards are promos, not in its packs: card id → those printings.
 *  - Stamped ones (set logo, staff, store stamps…), and special foils other than pack patterns.
 *  - Plain ones: hardly any card of that rarity comes in it (a holo-rare's theme-deck non-holo).
 * Promo sets: their cards' own printings are the set; only their stamped extras are promos.
 */
export function setPromoPrintings(
  cards: readonly { id: string; rarity: string | null; basics: readonly string[]; specials: readonly string[] }[],
  promoSet: boolean,
): Map<string, string[]> {
  const byRarity = new Map<string, typeof cards[number][]>();
  for (const c of cards) byRarity.set(c.rarity ?? '', [...(byRarity.get(c.rarity ?? '') ?? []), c]);
  const promos = new Map<string, string[]>();
  for (const group of byRarity.values()) {
    const share = (key: string) => group.filter((c) => c.basics.includes(key) || c.specials.includes(key)).length / group.length;
    const judged = group.length >= PROMO_AMONG;
    for (const c of group) {
      const out: string[] = [];
      const all = c.basics.length + c.specials.length;
      for (const b of c.basics) if (!promoSet && judged && all > 1 && share(b) < PROMO_SHARE) out.push(b);
      for (const s of c.specials) {
        const { foil, stamps } = parsePrinting(s);
        if (stamps.length || !foil || !PACK_FOILS.has(foil)) out.push(s);
      }
      if (out.length) promos.set(c.id, out);
    }
  }
  return promos;
}

const sig = (name: string, moves: readonly string[]) => {
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return `${n(name)}|${moves.map(n).sort().join(',')}`;
};

/**
 * Stamped promos that are versions of a set's own cards (Build & Battle and prerelease promos: SVP
 * 057 Chi-Yu, with Paradox Rift's logo, has Paradox Rift Chi-Yu's attacks, in new art): promo card
 * id → the card it's a version of, in the first set (by release) that has a card with the same
 * name and attacks. Cards without attacks (trainers) aren't matched: too many are alike.
 */
export function stampedPromoLinks(
  promos: readonly { id: string; name: string; moves: readonly string[]; stamps: readonly string[] }[],
  setCards: readonly { id: string; name: string; moves: readonly string[]; released: string }[],
): Map<string, string> {
  const bySig = new Map<string, (typeof setCards)[number]>();
  for (const c of setCards) {
    if (!c.moves.length) continue;
    const k = sig(c.name, c.moves);
    const had = bySig.get(k);
    if (!had || c.released < had.released) bySig.set(k, c);
  }
  const links = new Map<string, string>();
  for (const p of promos) {
    if (!p.moves.length || !p.stamps.some((s) => s === 'set-logo' || s === 'pre-release')) continue;
    const card = bySig.get(sig(p.name, p.moves));
    if (card) links.set(p.id, card.id);
  }
  return links;
}

export function inferPrintings({ setId, name, rarity }: PrintingInput): Variant[] {
  const r = (rarity ?? '').toLowerCase().trim();
  const holoOnly = HOLO_ONLY.test(r) || HOLO_NAME.test(name.trim());
  const main: Variant = holoOnly || /holo/.test(r) ? 'holo' : 'normal';
  const reverse = !holoOnly && !NO_REVERSE.test(setId) && /^(common|uncommon|rare|rare holo|holo rare)$/.test(r);
  return reverse ? [main, 'reverse'] : [main];
}
