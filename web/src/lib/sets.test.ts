// Runs against the real generated catalog (npm run catalog).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildCatalog, type CatalogJson } from './catalog.ts';
import { percentText, priceLookup, setProgress, setValue } from './sets.ts';

const cat = buildCatalog(JSON.parse(readFileSync(new URL('../../public/catalog/catalog.json', import.meta.url), 'utf8')) as CatalogJson);

test('set progress counts different cards owned in each set', () => {
  const copies = new Map([
    ['base1-4', 2],
    ['base1-2', 1],
    ['sv03.5-025', 1],
    ['not-a-real-card', 5],
  ]);
  const progress = setProgress(cat, copies);
  const base = progress.find((p) => p.set.id === 'base1')!;
  assert.equal(base.cards.length, 102);
  assert.deepEqual([base.owned, base.copies], [2, 3]);
  assert.equal(progress.find((p) => p.set.id === 'sv03.5')!.owned, 1);
  assert.equal(progress.find((p) => p.set.id === 'swsh3')!.owned, 0);
  assert.ok(progress.every((p) => p.cards.length > 0), 'sets with no cards in the catalog are left out');
});

test('set progress never shows 100% until the set is complete', () => {
  const cards = cat.bySet.get('base1')!;
  assert.equal(percentText({ owned: 101, cards }), '99%');
  assert.equal(percentText({ owned: 102, cards }), '100%');
  assert.equal(percentText({ owned: 0, cards }), '0%');
  assert.equal(percentText({ owned: 1, cards: cat.bySet.get('sv04')! }), '<1%', '1 of 266: started, so not 0%');
});

test('set value adds up market prices: the whole set, what you have and what is missing', () => {
  const cards = cat.bySet.get('base1')!;
  const usd = new Array(cat.cards.length).fill(null);
  const eur = new Array(cat.cards.length).fill(null);
  usd[cards[0].order] = 10; // priced on TCGplayer (USD)
  usd[cards[1].order] = 20;
  eur[cards[2].order] = 5; // only on Cardmarket (EUR)
  // GBP at made-up rates: 1 USD = 0.8, 1 EUR = 0.9
  const priceOf = priceLookup({ updated: '2026-10-17', usd, eur }, (amount, from) => (amount === null ? null : amount * (from === 'USD' ? 0.8 : 0.9)));
  const owned = new Set([cards[1].id]);
  const v = setValue({ cards }, priceOf, (c) => owned.has(c.id));
  assert.equal(v.priced, 3);
  assert.equal(v.total, 8 + 16 + 4.5);
  assert.equal(v.owned, 16);
  assert.equal(v.missing, 8 + 4.5);
  assert.equal(priceLookup(null, () => 1)(cards[0]), null, 'no prices file: no value');
});
