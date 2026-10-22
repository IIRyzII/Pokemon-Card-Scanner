import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  binderCards,
  binderStats,
  fixBinderPrintings,
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
} from './binders.ts';
import { buildCatalog, type CatalogJson } from './catalog.ts';

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

test('promo printings: the holos of a few commons, last in a grand master set', () => {
  const rift = setCardsOf(cat, 'sv04');
  const promos = promoPrintings(rift);
  // Snorunt, Vanilluxe, Honedge and Doublade came as cosmos holos in blister packs and boxes
  assert.deepEqual([...promos].sort(), ['sv04-037|holo', 'sv04-045|holo', 'sv04-131|holo', 'sv04-132|holo']);
  const master = binderCards(rift, 'master', 1, promos);
  assert.ok(!master.some((c) => c.cardId === 'sv04-037' && c.variant === 'holo'), 'not in a master set');
  const grand = binderCards(rift, 'grand', 1, promos);
  assert.equal(grand.length, master.length + 4);
  assert.deepEqual(
    grand.slice(-4).map((c) => `${c.cardId} ${c.variant}`),
    ['sv04-037 holo', 'sv04-045 holo', 'sv04-131 holo', 'sv04-132 holo'],
    'at the end, in the set order',
  );
  assert.deepEqual(
    master.filter((c) => c.cardId === 'sv04-037').map((c) => c.variant),
    ['normal', 'reverse'],
  );
  // A holo rare whose non-holo is a stamped deck card: its main printing is the holo
  const tempest = setCardsOf(cat, 'swsh12');
  const dragonite = tempest.find((c) => c.id === 'swsh12-131')!;
  assert.deepEqual(printingsOf(dragonite, false, promoPrintings(tempest)), ['holo']);
  // Promo sets have no promo printings of their own; a card's only printing is never one
  assert.equal(promoPrintings(setCardsOf(cat, 'svp')).size, 0);
  assert.ok(!promosOf(cat, setCardsOf(cat, 'xy7')).has('xy7-75a|holo'));
});

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
