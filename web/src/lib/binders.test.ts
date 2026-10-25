import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Variant } from '../../../shared/grading.ts';
import {
  allPrintingsOf,
  binderCards,
  binderStats,
  copyToRemove,
  fixBinderPrintings,
  knownPrintings,
  missingOf,
  percentFilled,
  ownedPrintings,
  pagesOf,
  pocketsOf,
  pokemonCardsOf,
  printingsOf,
  promoPrintings,
  promosOf,
  setCardsOf,
  stampedPromosOf,
  withPending,
} from './binders.ts';
import { buildCatalog, type CatalogCard, type CatalogJson } from './catalog.ts';

// Runs against the real generated catalog (npm run catalog).
const cat = buildCatalog(JSON.parse(readFileSync(new URL('../../public/catalog/catalog.json', import.meta.url), 'utf8')) as CatalogJson);

test('a Paradox Rift binder has every card in number order; a master set has every printing', () => {
  const cards = setCardsOf(cat, 'sv04');
  assert.equal(cards.length, 266);
  assert.deepEqual(
    cards.slice(0, 3).map((c) => c.number),
    ['001', '002', '003'],
  );
  const oneEach = binderCards(cards, 'one', 1);
  assert.equal(oneEach.length, 266);
  assert.deepEqual(oneEach[0], { cardId: 'sv04-001', variant: 'normal', copies: 1 });
  const master = binderCards(cards, 'master', 1);
  assert.ok(master.length > 266, 'reverse holos too');
  assert.deepEqual(
    master.slice(0, 2).map((c) => `${c.cardId} ${c.variant}`),
    ['sv04-001 normal', 'sv04-001 reverse'],
    "each card's printings side by side",
  );
  assert.equal(binderCards(cards.slice(-1), 'master', 1)[0].variant, 'holo', 'the last secret rare only comes as a holo');
});

test("a Pokémon binder has all that Pokémon's cards, oldest first, with the copies asked for", () => {
  const shuckles = pokemonCardsOf(cat, 'shuckle');
  assert.ok(shuckles.length >= 18, String(shuckles.length));
  assert.ok(shuckles.every((c) => / ?shuckle\b/i.test(c.name)));
  assert.equal(shuckles[0].id, 'neo1-72', 'Neo Genesis first');
  assert.ok(shuckles.some((c) => c.name === 'Shuckle GX'));
  assert.deepEqual(
    binderCards(shuckles.slice(0, 1), 'one', 9),
    [{ cardId: 'neo1-72', variant: 'normal', copies: 9 }],
  );
  assert.deepEqual(pokemonCardsOf(cat, '  '), []);
  assert.ok(pokemonCardsOf(cat, 'mr. mime').every((c) => c.nameKey.includes('mr mime')));
});

test('printings: the first one, or all of them; unknown printings count as regular', () => {
  assert.deepEqual(printingsOf({ id: 'x', variants: ['holo', 'reverse'] }, false), ['holo'], 'one of each: the pack printing');
  assert.deepEqual(printingsOf({ id: 'x', variants: ['holo', 'reverse'] }, true), ['reverse', 'holo'], 'a master set: reverse holo, then holo');
  assert.deepEqual(printingsOf({ id: 'x', variants: null }, true), ['normal']);
});

// The catalog has TCGdex's printing details card by card as builds fetch them (a build can stop part
// way), so these hold either way; the ones that need the details are skipped until it has them.
test('promo printings: not in a master set; last in a grand master set, then the stamped promo cards', () => {
  const rift = setCardsOf(cat, 'sv04');
  const promos = promosOf(cat, rift);
  const stamped = stampedPromosOf(cat, rift);
  const master = binderCards(rift, 'master', 1, promos, stamped);
  const grand = binderCards(rift, 'grand', 1, promos, stamped);
  const tail = grand.slice(master.length).map((c) => `${c.cardId}|${c.variant}`);
  // Snorunt, Vanilluxe, Honedge and Doublade came as (cosmos) holos only in blister packs and boxes
  for (const id of ['sv04-037', 'sv04-045', 'sv04-131', 'sv04-132']) {
    assert.ok(tail.some((p) => p.startsWith(`${id}|holo`)), `${id}: its holo at the end`);
    assert.ok(!master.some((c) => c.cardId === id && c.variant.startsWith('holo')), `${id}: no holo in a master set`);
  }
  assert.deepEqual(
    master.filter((c) => c.cardId === 'sv04-037').map((c) => c.variant),
    ['normal', 'reverse'],
  );
  assert.deepEqual(grand.slice(0, master.length), master, 'a grand master set starts with the master set…');
  assert.deepEqual(new Set(tail.slice(0, promos.size)), promos, '…then has the promo printings…');
  assert.deepEqual(
    tail.slice(promos.size),
    stamped.flatMap((c) => allPrintingsOf(c).map((v) => `${c.id}|${v}`)),
    '…then the stamped promo cards',
  );
  // A holo rare whose non-holo is a stamped deck card: its main printing is the holo
  const tempest = setCardsOf(cat, 'swsh12');
  const dragonite = tempest.find((c) => c.id === 'swsh12-131')!;
  assert.deepEqual(printingsOf(dragonite, false, promoPrintings(tempest)), ['holo']);
  // A promo set's card is never a promo printing of itself (a staff-stamped extra can be)
  const svp = setCardsOf(cat, 'svp');
  const svpPromos = promoPrintings(svp);
  assert.ok(svp.every((c) => !svpPromos.has(`${c.id}|${printingsOf(c, false)[0]}`)));
  assert.ok(!promosOf(cat, setCardsOf(cat, 'xy7')).has('xy7-75a|holo'), "a card's only printing is never one");
});

const realKingdra = cat.byId.get('sv04-032');
test(
  "Paradox Rift's Kingdra: its cosmos holo (from blister packs) only in a grand master set",
  { skip: !realKingdra?.specials.length && "the catalog doesn't have TCGdex's printing details for it yet" },
  () => {
    const rift = setCardsOf(cat, 'sv04');
    const promos = promosOf(cat, rift);
    const kingdras = (choice: 'master' | 'grand') =>
      binderCards(rift, choice, 1, promos)
        .filter((c) => c.cardId === 'sv04-032')
        .map((c) => c.variant);
    assert.deepEqual(allPrintingsOf(realKingdra!), ['reverse', 'holo', 'holo~cosmos']);
    assert.deepEqual(kingdras('master'), ['reverse', 'holo']);
    assert.deepEqual(kingdras('grand'), ['reverse', 'holo', 'holo~cosmos']);
  },
);

test(
  "Paradox Rift's grand master set ends with its Build & Battle promos (SVP 057 Chi-Yu, stamped with the set's logo)",
  { skip: cat.byId.get('svp-057')?.versionOf !== 'sv04-029' && "the catalog doesn't have TCGdex's printing details for it yet" },
  () => {
    const rift = setCardsOf(cat, 'sv04');
    const promos = promosOf(cat, rift);
    const stamped = stampedPromosOf(cat, rift);
    assert.ok(stamped.every((c) => c.set.id === 'svp' && c.versionOf!.startsWith('sv04-')));
    const lines = (choice: 'master' | 'grand') => binderCards(rift, choice, 1, promos, stamped).map((c) => `${c.cardId} ${c.variant}`);
    assert.ok(!lines('master').some((l) => l.startsWith('svp-')));
    const grand = lines('grand');
    assert.deepEqual(
      grand.filter((l) => l.startsWith('svp-057 ')),
      ['svp-057 holo', 'svp-057 holo+set-logo+staff'],
      'the card, and its staff-stamped version',
    );
    const stampedLines = stamped.flatMap((c) => allPrintingsOf(c).map((v) => `${c.id} ${v}`));
    assert.deepEqual(grand.slice(-stampedLines.length), stampedLines, 'at the very end');
  },
);

test('copies in the collection fill pockets of their card and printing, first pockets first', () => {
  const cards = [
    { cardId: 'shuckle-a', variant: 'normal', copies: 9 },
    { cardId: 'shuckle-b', variant: 'reverse', copies: 3 },
    { cardId: 'shuckle-a', variant: 'reverse', copies: 2 },
  ];
  const owned = ownedPrintings([
    { cardId: 'shuckle-a', variant: 'normal', quantity: 3 },
    { cardId: 'shuckle-a', variant: 'normal', quantity: 1 }, // another entry (a played copy)
    { cardId: 'shuckle-b', variant: 'normal', quantity: 5 }, // wrong printing: fills nothing
    { cardId: 'shuckle-a', variant: 'reverse', quantity: 7 }, // more than there are pockets
  ]);
  const pockets = pocketsOf(cards, owned);
  assert.equal(pockets.length, 14);
  assert.deepEqual(
    pockets.map((p) => (p.filled ? 'x' : '.')).join(''),
    'xxxx.....' + '...' + 'xx',
  );
  assert.deepEqual(
    pagesOf(pockets, 9).map((p) => p.length),
    [9, 5],
  );
  assert.deepEqual(missingOf(cards, pockets, 9), [
    { line: 0, cardId: 'shuckle-a', variant: 'normal', need: 5, page: 1, pocket: 5 },
    { line: 1, cardId: 'shuckle-b', variant: 'reverse', need: 3, page: 2, pocket: 1 },
  ]);
});

test('a card in a binder twice: copies fill the first place, then the next', () => {
  const cards = [
    { cardId: 'a', variant: 'normal', copies: 2 },
    { cardId: 'a', variant: 'normal', copies: 2 },
  ];
  const pockets = pocketsOf(cards, ownedPrintings([{ cardId: 'a', variant: 'normal', quantity: 3 }]));
  assert.deepEqual(
    pockets.map((p) => p.filled),
    [true, true, true, false],
  );
});

test("a binder's −: the raw copy added last, never a slab", () => {
  const items = [
    { id: 'a', cardId: 'sv04-032', variant: 'holo', grader: 'RAW', createdAt: '2026-01-01T10:00:00Z' },
    { id: 'b', cardId: 'sv04-032', variant: 'holo', grader: 'RAW', createdAt: '2026-03-01T10:00:00Z' },
    { id: 'c', cardId: 'sv04-032', variant: 'holo', grader: 'PSA', createdAt: '2026-05-01T10:00:00Z' },
    { id: 'd', cardId: 'sv04-032', variant: 'reverse', grader: 'RAW', createdAt: '2026-06-01T10:00:00Z' },
    { id: 'e', cardId: 'sm8-17', variant: 'normal', grader: 'RAW', createdAt: '2026-01-01T10:00:00Z' },
  ];
  assert.equal(copyToRemove(items, 'sv04-032', 'holo')?.id, 'b');
  assert.equal(copyToRemove(items, 'sv04-032', 'reverse')?.id, 'd');
  assert.equal(copyToRemove(items.slice(2, 3), 'sv04-032', 'holo'), null, 'only a slab left');
  assert.equal(copyToRemove(items, 'sv04-032', 'holo~cosmos'), null);
  // A Shuckle-GX saved as "normal" before its printings were known is its holo
  assert.equal(copyToRemove(items, 'sm8-17', 'holo', (id) => (id === 'sm8-17' ? ['holo'] : null))?.id, 'e');
});

test("a binder's + and − count at once, before the collection has them", () => {
  const owned = new Map([['a|holo', 1]]);
  assert.equal(withPending(owned, []), owned);
  assert.deepEqual(
    Object.fromEntries(
      withPending(owned, [
        { key: 'a|holo', delta: 1 },
        { key: 'b|normal', delta: 1 },
        { key: 'a|holo', delta: -1 },
        { key: 'c|reverse', delta: -1 },
      ]),
    ),
    { 'a|holo': 1, 'b|normal': 1, 'c|reverse': 0 },
  );
});

test('binder stats: pockets filled, pages, and the value of what is in it and what is missing', () => {
  const cards = [
    { cardId: 'a', variant: 'normal', copies: 9 },
    { cardId: 'b', variant: 'holo', copies: 2 },
  ];
  const pockets = pocketsOf(cards, ownedPrintings([{ cardId: 'a', variant: 'normal', quantity: 4 }, { cardId: 'b', variant: 'holo', quantity: 1 }]));
  const prices: Record<string, number> = { a: 0.5, b: 10 };
  assert.deepEqual(binderStats(pockets, 9, (id) => prices[id] ?? null), { pockets: 11, filled: 5, pages: 2, value: 12, toComplete: 12.5 });
  assert.deepEqual(binderStats(pockets, 9, null), { pockets: 11, filled: 5, pages: 2, value: null, toComplete: null });
  assert.deepEqual(binderStats([], 9, null), { pockets: 0, filled: 0, pages: 0, value: null, toComplete: null });
});

test('percent filled never says 0% once something is in, nor 100% until full', () => {
  assert.equal(percentFilled({ filled: 0, pockets: 266 }), '0%');
  assert.equal(percentFilled({ filled: 2, pockets: 266 }), '<1%');
  assert.equal(percentFilled({ filled: 133, pockets: 266 }), '50%');
  assert.equal(percentFilled({ filled: 265, pockets: 266 }), '99%');
  assert.equal(percentFilled({ filled: 266, pockets: 266 }), '100%');
  assert.equal(percentFilled({ filled: 0, pockets: 0 }), '0%');
});

test('a Shuckle-GX saved as "normal" before its printings were known fills a holo pocket', () => {
  const known = (id: string) => ({ 'sm8-17': ['holo'], 'sm8-16': ['normal', 'reverse'] })[id] ?? null;
  const owned = ownedPrintings(
    [
      { cardId: 'sm8-17', variant: 'normal', quantity: 2 },
      { cardId: 'sm8-16', variant: 'reverse', quantity: 1 },
      { cardId: 'unknown-1', variant: 'normal', quantity: 1 },
    ],
    known,
  );
  assert.deepEqual(Object.fromEntries(owned), { 'sm8-17|holo': 2, 'sm8-16|reverse': 1, 'unknown-1|normal': 1 });
  // …and a binder made then, with the GX as "normal", now wants the holo
  const cards = fixBinderPrintings(
    [
      { cardId: 'sm8-17', variant: 'normal', copies: 9 },
      { cardId: 'sm8-16', variant: 'reverse', copies: 9 },
    ],
    known,
  );
  assert.deepEqual(
    cards.map((c) => c.variant),
    ['holo', 'reverse'],
  );
  assert.equal(pocketsOf(cards, owned).filter((p) => p.filled).length, 3);
});

test('a grand master set: the packs’ printings, then the promo printings, then the stamped promo cards', () => {
  const rift = { id: 'sv04', name: 'Paradox Rift' } as CatalogCard['set'];
  const svpSet = { id: 'svp', name: 'SVP Black Star Promos' } as CatalogCard['set'];
  const card = (id: string, variants: Variant[], specials: string[], promos: string[], more: Partial<CatalogCard> = {}) =>
    ({ id, set: rift, rarity: 'Rare', variants, specials, promos, versionOf: null, ...more }) as CatalogCard;
  const moth = card('sv04-028', ['holo', 'reverse'], ['reverse~pokeball', 'reverse+gamestop'], ['reverse+gamestop']);
  const chiYu = card('sv04-029', ['holo', 'reverse'], [], []);
  const kingdra = card('sv04-032', ['holo', 'reverse'], ['holo~cosmos'], ['holo~cosmos']);
  const svp057 = card('svp-057', ['holo'], ['holo+set-logo+staff'], ['holo+set-logo+staff'], { set: svpSet, versionOf: 'sv04-029' });
  const all = [moth, chiYu, kingdra, svp057];
  const catalog = {
    cards: all,
    byId: new Map(all.map((c) => [c.id, c])),
    bySet: new Map([
      ['sv04', [moth, chiYu, kingdra]],
      ['svp', [svp057]],
    ]),
  };
  const cards = [moth, chiYu, kingdra];
  const promos = promosOf(catalog, cards);
  const stamped = stampedPromosOf(catalog, cards);
  assert.deepEqual(
    stamped.map((c) => c.id),
    ['svp-057'],
    "Chi-Yu's Build & Battle promo",
  );
  const binder = (choice: 'one' | 'master' | 'grand') => binderCards(cards, choice, 1, promos, stamped).map((c) => `${c.cardId} ${c.variant}`);
  assert.deepEqual(binder('one'), ['sv04-028 holo', 'sv04-029 holo', 'sv04-032 holo']);
  const master = [
    'sv04-028 reverse',
    'sv04-028 holo',
    'sv04-028 reverse~pokeball', // a pattern from the packs
    'sv04-029 reverse',
    'sv04-029 holo',
    'sv04-032 reverse',
    'sv04-032 holo',
  ];
  assert.deepEqual(binder('master'), master, 'no cosmos holo, no stamped ones');
  assert.deepEqual(binder('grand'), [...master, 'sv04-028 reverse+gamestop', 'sv04-032 holo~cosmos', 'svp-057 holo', 'svp-057 holo+set-logo+staff']);
  assert.deepEqual(allPrintingsOf(kingdra), ['reverse', 'holo', 'holo~cosmos']);
  assert.deepEqual(knownPrintings(catalog)('sv04-032'), ['reverse', 'holo', 'holo~cosmos']);
  assert.equal(knownPrintings(catalog)('nope'), null);
});
