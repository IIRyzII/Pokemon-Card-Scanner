import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { binderCards, missingOf, ownedPrintings, pagesOf, pocketsOf, pokemonCardsOf, printingsOf, setCardsOf } from './binders.ts';
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
  const oneEach = binderCards(cards, false, 1);
  assert.equal(oneEach.length, 266);
  assert.deepEqual(oneEach[0], { cardId: 'sv04-001', variant: 'normal', copies: 1 });
  const master = binderCards(cards, true, 1);
  assert.ok(master.length > 266, 'reverse holos too');
  assert.deepEqual(
    master.slice(0, 2).map((c) => `${c.cardId} ${c.variant}`),
    ['sv04-001 normal', 'sv04-001 reverse'],
    "each card's printings side by side",
  );
  assert.equal(binderCards(cards.slice(-1), true, 1)[0].variant, 'holo', 'the last secret rare only comes as a holo');
});

test("a Pokémon binder has all that Pokémon's cards, oldest first, with the copies asked for", () => {
  const shuckles = pokemonCardsOf(cat, 'shuckle');
  assert.ok(shuckles.length >= 18, String(shuckles.length));
  assert.ok(shuckles.every((c) => / ?shuckle\b/i.test(c.name)));
  assert.equal(shuckles[0].id, 'neo1-72', 'Neo Genesis first');
  assert.ok(shuckles.some((c) => c.name === 'Shuckle GX'));
  assert.deepEqual(
    binderCards(shuckles.slice(0, 1), false, 9),
    [{ cardId: 'neo1-72', variant: 'normal', copies: 9 }],
  );
  assert.deepEqual(pokemonCardsOf(cat, '  '), []);
  assert.ok(pokemonCardsOf(cat, 'mr. mime').every((c) => c.nameKey.includes('mr mime')));
});

test('printings: the first one, or all of them; unknown printings count as regular', () => {
  assert.deepEqual(printingsOf({ variants: ['holo', 'reverse'] }, false), ['holo']);
  assert.deepEqual(printingsOf({ variants: ['holo', 'reverse'] }, true), ['holo', 'reverse']);
  assert.deepEqual(printingsOf({ variants: null }, true), ['normal']);
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
