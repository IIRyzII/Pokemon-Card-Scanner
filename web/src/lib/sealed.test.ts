import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SealedItem } from '../../../shared/types.ts';
import { normName, type CatalogSet } from './catalog.ts';
import { searchSealed, sealedTotals, sealedValue } from './sealed.ts';
import type { SealedProduct } from './useCatalog.ts';

const set151 = { id: 'sv03.5', name: '151' } as CatalogSet;
const product = (id: number, name: string, type: SealedProduct['type'], price: number | null, set: CatalogSet | null = null): SealedProduct => ({
  id,
  name,
  type,
  set,
  added: '2023-06-14',
  price,
  key: normName(`${name} ${set?.name ?? ''}`),
});
const products = [
  product(1, '151 Elite Trainer Box', 'Elite Trainer Box', 95, set151),
  product(2, '151 Booster Bundle', 'Box set', 40, set151),
  product(3, 'Pokémon Center Elite Trainer Box: Surging Sparks', 'Elite Trainer Box', 180),
  product(4, 'Base Set Booster Box', 'Booster box', null),
];

test('searching sealed products: every word, in the name or the set, of one kind or any', () => {
  assert.deepEqual(
    searchSealed(products, '151', null).map((p) => p.id),
    [1, 2],
  );
  assert.deepEqual(
    searchSealed(products, 'elite trainer', 'Elite Trainer Box').map((p) => p.id),
    [1, 3],
  );
  assert.deepEqual(
    searchSealed(products, 'pokemon center', null).map((p) => p.id),
    [3],
    'accents don’t matter',
  );
  assert.deepEqual(searchSealed(products, '', 'Booster box').map((p) => p.id), [4]);
  assert.equal(searchSealed(products, '', null, 2).length, 2);
});

const item = (over: Partial<SealedItem>): SealedItem => ({
  id: 'x',
  productId: 1,
  name: '151 Elite Trainer Box',
  type: 'Elite Trainer Box',
  quantity: 1,
  purchasePrice: null,
  purchaseCurrency: null,
  purchaseDate: null,
  notes: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
});
// EUR → GBP at 0.85; USD → GBP at 0.75
const convert = (amount: number | null | undefined, from: string) => (amount == null ? null : amount * ({ EUR: 0.85, USD: 0.75, GBP: 1 }[from] ?? NaN));

test("an entry's value is Cardmarket's price converted, times how many; its cost likewise", () => {
  assert.deepEqual(sealedValue(item({ quantity: 2, purchasePrice: 50, purchaseCurrency: 'USD' }), products[0], convert, 'GBP'), {
    each: 80.75,
    total: 161.5,
    paid: 75,
  });
  assert.deepEqual(sealedValue(item({ productId: 4 }), products[3], convert, 'GBP'), { each: null, total: null, paid: null });
  assert.deepEqual(sealedValue(item({ productId: 99 }), undefined, convert, 'GBP').total, null, 'no longer in the catalogue');
});

test('totals: value, unpriced entries, and the cost against the value of those with both', () => {
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = [
    item({ id: 'a', quantity: 2, purchasePrice: 50, purchaseCurrency: 'GBP' }),
    item({ id: 'b', productId: 2, quantity: 3 }),
    item({ id: 'c', productId: 4, purchasePrice: 100, purchaseCurrency: 'GBP' }),
  ];
  const t = sealedTotals(items, (i) => sealedValue(i, byId.get(i.productId), convert, 'GBP'));
  assert.equal(t.count, 6);
  assert.equal(t.entries, 3);
  assert.equal(Math.round(t.value * 100) / 100, 263.5); // 2 × 80.75 + 3 × 34
  assert.equal(t.unpriced, 1);
  assert.equal(t.paid, 100, 'only the entry with both a cost and a value');
  assert.equal(t.paidValue, 161.5);
  assert.equal(t.costed, 1);
});
