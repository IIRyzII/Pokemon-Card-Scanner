import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expansionSets, SEALED_TYPES, sealedFile, sealedPrice, sealedType, type NonSingle } from './sealed.ts';

test("Cardmarket's sealed categories get our names; unknown ones are Other", () => {
  assert.equal(sealedType(53), 'Booster box');
  assert.equal(sealedType(1016), 'Elite Trainer Box');
  assert.equal(sealedType(52), 'Booster pack');
  assert.equal(sealedType(9999), 'Other');
});

test("an expansion is the set most of its linked cards are in", () => {
  const links = [
    { setId: 'sv03.5', idExpansion: 5001 },
    { setId: 'sv03.5', idExpansion: 5001 },
    { setId: 'svp', idExpansion: 5001 }, // a promo linked to the same expansion
    { setId: 'base1', idExpansion: 1523 },
  ];
  assert.deepEqual([...expansionSets(links)], [
    [5001, 'sv03.5'],
    [1523, 'base1'],
  ]);
});

test('sealed.json: our types, sets and prices, newest first', () => {
  const products: NonSingle[] = [
    { idProduct: 271824, name: 'Base Set Booster Box', idCategory: 53, idExpansion: 1523, dateAdded: '2007-01-01 00:00:00' },
    { idProduct: 700001, name: '151 Elite Trainer Box ', idCategory: 1016, idExpansion: 5001, dateAdded: '2023-06-14 10:00:00' },
    { idProduct: 700002, name: 'Dragon Blade Booster', idCategory: 52, idExpansion: 4200, dateAdded: '2023-06-14 09:00:00' },
    { idProduct: 700003, name: '', idCategory: 52, idExpansion: 4200, dateAdded: '2023-06-14 09:00:00' },
  ];
  const guide = [
    { idProduct: 271824, trend: 9875.5, avg30: 10123.456 },
    { idProduct: 700001, trend: null, avg30: 94.1 },
  ];
  const file = sealedFile(
    products,
    guide,
    new Map([
      [1523, 'base1'],
      [5001, 'sv03.5'],
    ]),
    '2026-11-01T01:47:16.000Z',
  );
  assert.equal(file.updated, '2026-11-01T01:47:16.000Z');
  assert.deepEqual(file.products, [
    [700001, '151 Elite Trainer Box', SEALED_TYPES.indexOf('Elite Trainer Box'), 'sv03.5', '2023-06-14', 0, 94.1],
    [700002, 'Dragon Blade Booster', SEALED_TYPES.indexOf('Booster pack'), 0, '2023-06-14', 0, 0],
    [271824, 'Base Set Booster Box', SEALED_TYPES.indexOf('Booster box'), 'base1', '2007-01-01', 9875.5, 10123.46],
  ]);
  assert.equal(sealedPrice(file.products[0]), 94.1, 'no trend: the 30-day average');
  assert.equal(sealedPrice(file.products[1]), null);
  assert.equal(sealedPrice(file.products[2]), 9875.5);
});
