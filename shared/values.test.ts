import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceGradeKey } from './grading.ts';
import { cardNumberText, ebaySoldUrl, artistSlug } from './links.ts';
import { median, valueItem, type PriceRow, type SaleRow } from './values.ts';

const now = new Date('2026-10-14T12:00:00Z');
const price = (p: Partial<PriceRow>): PriceRow => ({
  source: 'tcgplayer',
  variant: 'holo',
  gradeKey: 'ungraded',
  market: null,
  low: null,
  mid: null,
  high: null,
  currency: 'USD',
  label: null,
  url: null,
  updatedAt: '2026-10-14',
  ...p,
});
const sale = (s: Partial<SaleRow>): SaleRow => ({
  id: Math.random().toString(36),
  cardId: 'base1-4',
  grader: 'PSA',
  grade: 9,
  gradeLabel: null,
  price: 100,
  soldOn: '2026-10-01',
  source: 'eBay',
  url: null,
  note: null,
  createdBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  ...s,
});

test('priceGradeKey maps grades to PriceCharting price points', () => {
  assert.equal(priceGradeKey('RAW', null), 'ungraded');
  assert.equal(priceGradeKey('PSA', 10), 'psa10');
  assert.equal(priceGradeKey('BGS', 10, 'Black Label'), 'bgs10black');
  assert.equal(priceGradeKey('CGC', 10, 'Pristine'), 'cgc10pristine');
  assert.equal(priceGradeKey('PSA', 9.5), 'g9.5');
  assert.equal(priceGradeKey('BGS', 8.5), 'g8');
  assert.equal(priceGradeKey('OTHER', 10), null);
});

test('raw copies use the TCGplayer market price of the same printing', () => {
  const v = valueItem(
    { variant: 'reverse', grader: 'RAW', grade: null, gradeLabel: null },
    [price({ variant: 'normal', market: 1 }), price({ variant: 'reverse', market: 3.5 })],
    [],
    now,
  );
  assert.deepEqual([v.unit, v.source], [3.5, 'tcgplayer']);
});

test('raw copy of a printing with no price is not valued with another printing', () => {
  const v = valueItem({ variant: 'firstEdition', grader: 'RAW', grade: null, gradeLabel: null }, [price({ market: 900 })], [], now);
  assert.equal(v.unit, null);
});

test('graded copies prefer recent logged sales, then PriceCharting', () => {
  const item = { variant: 'holo', grader: 'PSA', grade: 9, gradeLabel: null };
  const pc = price({ source: 'pricecharting', gradeKey: 'g9', market: 2000 });
  assert.deepEqual(
    [valueItem(item, [pc], [], now).unit, valueItem(item, [pc], [], now).source],
    [2000, 'pricecharting'],
  );
  const sales = [sale({ price: 1500 }), sale({ price: 1700, soldOn: '2026-09-01' }), sale({ price: 1600, soldOn: '2026-08-01' })];
  const v = valueItem(item, [pc], sales, now);
  assert.deepEqual([v.unit, v.source], [1600, 'sales']);
  // Sales of a different grade/grader don't count.
  const other = valueItem(item, [], [sale({ grade: 10 }), sale({ grader: 'BGS' })], now);
  assert.equal(other.unit, null);
});

test('old sales are used only when nothing better exists', () => {
  const item = { variant: 'holo', grader: 'PSA', grade: 10, gradeLabel: null };
  const old = [sale({ grade: 10, price: 5000, soldOn: '2024-01-01' })];
  assert.equal(valueItem(item, [], old, now).unit, 5000);
  const pc = price({ source: 'pricecharting', gradeKey: 'psa10', market: 7000 });
  assert.equal(valueItem(item, [pc], old, now).unit, 7000);
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 2.5);
});

test('links', () => {
  assert.equal(cardNumberText('4', 102), '4/102');
  assert.equal(cardNumberText('TG05', 30), 'TG05');
  const url = ebaySoldUrl({ name: 'Charizard', number: '4', setName: 'Base Set', setTotal: 102 }, 'PSA', 9);
  assert.ok(url.includes('LH_Sold=1') && url.includes('Charizard%204%2F102%20PSA%209'), url);
  assert.equal(artistSlug('Mitsuhiro Arita'), 'mitsuhiro-arita');
  assert.equal(artistSlug('Dr.Ooyama'), 'dr-ooyama');
});
