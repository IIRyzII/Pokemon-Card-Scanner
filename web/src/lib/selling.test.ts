import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CollectionItem, SoldItem } from '../../../shared/types.ts';
import { monthName, saleResult, salesByMonth, salesTotals, sellSuggestions } from './selling.ts';

// GBP display; USD → GBP at 0.75, EUR → GBP at 0.85; no rate for anything else (like the app: null)
const RATES: Record<string, number> = { GBP: 1, USD: 0.75, EUR: 0.85 };
const convert = (amount: number | null | undefined, from: string) => (amount == null || !(from in RATES) ? null : Math.round(amount * RATES[from] * 100) / 100);

const sale = (over: Partial<SoldItem>): SoldItem => ({
  id: 's',
  itemId: 'i',
  cardId: 'base1-2',
  name: 'Blastoise',
  setName: 'Base Set',
  number: '2',
  setTotal: 102,
  image: null,
  variant: 'holo',
  language: 'en',
  grader: 'RAW',
  grade: null,
  gradeLabel: null,
  condition: 'NM',
  quantity: 1,
  fromSale: 1,
  price: 55,
  currency: 'GBP',
  fees: 7.5,
  postage: 2.1,
  purchasePrice: 20,
  purchaseCurrency: 'GBP',
  platform: 'eBay',
  soldOn: '2026-11-01',
  note: null,
  saleId: null,
  emptied: false,
  createdAt: '2026-11-01T12:00:00Z',
  ...over,
});

test("a sale's takings, costs and profit, converted", () => {
  assert.deepEqual(saleResult(sale({}), convert), { takings: 55, costs: 9.6, paid: 20, profit: 25.4 });
  assert.deepEqual(saleResult(sale({ quantity: 2, price: 40, currency: 'USD', fees: 8, postage: null, purchasePrice: 10 }), convert), {
    takings: 60,
    costs: 6,
    paid: 20,
    profit: 34,
  });
  assert.deepEqual(saleResult(sale({ purchasePrice: null, fees: null, postage: null }), convert), { takings: 55, costs: 0, paid: null, profit: null });
  assert.equal(saleResult(sale({ currency: 'XYZ' }), convert), null, 'no rate: left out');
});

test('totals: profit only over the sales whose cost is known', () => {
  const t = salesTotals([sale({}), sale({ quantity: 3, price: 10, fees: 2, postage: 0, purchasePrice: null })], convert);
  assert.deepEqual(t, { sales: 2, copies: 4, takings: 85, costs: 11.6, profit: 25.4, costed: 1 });
});

test('the history by month, latest first', () => {
  const months = salesByMonth(
    [sale({ id: 'a', soldOn: '2026-10-03' }), sale({ id: 'b', soldOn: '2026-11-01' }), sale({ id: 'c', soldOn: '2026-10-28' })],
    convert,
  );
  assert.deepEqual(
    months.map((m) => [m.month, m.sales.map((s) => s.id), m.totals.sales]),
    [
      ['2026-11', ['b'], 1],
      ['2026-10', ['c', 'a'], 2],
    ],
  );
  assert.equal(monthName('2026-11'), 'November 2026');
});

const item = (over: Partial<CollectionItem>): CollectionItem =>
  ({
    id: 'x',
    cardId: 'c1',
    name: 'Card',
    quantity: 1,
    value: 10,
    valueCurrency: 'GBP',
    purchasePrice: null,
    purchaseCurrency: null,
    forSale: 0,
    deletedAt: null,
    ...over,
  }) as CollectionItem;

test('what to sell: spare copies first (keeping the best copy), then the biggest gains since buying', () => {
  const items = [
    item({ id: 'nm', cardId: 'zard', quantity: 1, value: 300 }), // the best copy: kept
    item({ id: 'lp', cardId: 'zard', quantity: 2, value: 150 }), // both spare
    item({ id: 'pika', cardId: 'pika', quantity: 3, value: 2, forSale: 1 }), // 2 spare, 1 already for sale
    item({ id: 'gain', cardId: 'mew', value: 80, purchasePrice: 20, purchaseCurrency: 'GBP' }),
    item({ id: 'small', cardId: 'eevee', value: 12, purchasePrice: 10, purchaseCurrency: 'GBP' }),
    item({ id: 'loss', cardId: 'onix', value: 5, purchasePrice: 9, purchaseCurrency: 'GBP' }),
    item({ id: 'listed', cardId: 'lugia', value: 90, purchasePrice: 10, purchaseCurrency: 'GBP', forSale: 1 }),
    item({ id: 'unpriced', cardId: 'ho', value: null, quantity: 4 }),
  ];
  assert.deepEqual(
    sellSuggestions(items, convert).map((s) => [s.item.id, s.reason, s.copies]),
    [
      ['lp', 'spare', 2],
      ['pika', 'spare', 1],
      ['gain', 'gain', 1],
      ['small', 'gain', 1],
    ],
  );
});
