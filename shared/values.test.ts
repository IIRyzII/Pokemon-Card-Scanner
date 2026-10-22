import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convert, parseEcbXml, type FxRates } from './currency.ts';
import { priceGradeKey } from './grading.ts';
import { cardNumberText, ebaySoldUrl, artistSlug } from './links.ts';
import { median, valueItem, type PriceRow, type SaleRow } from './values.ts';

const now = new Date('2026-10-14T12:00:00Z');
const fx: FxRates = { date: '2026-10-14', perEur: { EUR: 1, USD: 1.1195, GBP: 0.84385 } };
const USD = { currency: 'USD', fx };
const GBP = { currency: 'GBP', fx };
const EUR = { currency: 'EUR', fx };

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
  currency: 'USD',
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

test('currency conversion through ECB euro rates', () => {
  assert.equal(convert(100, 'USD', 'GBP', fx), 75.38);
  assert.equal(convert(100, 'GBP', 'USD', fx), 132.67);
  assert.equal(convert(50, 'EUR', 'GBP', fx), 42.19);
  assert.equal(convert(10, 'GBP', 'GBP', null), 10);
  assert.equal(convert(10, 'USD', 'GBP', null), null);
  assert.equal(convert(10, 'USD', 'XYZ', fx), null);
});

test('parses the ECB daily XML', () => {
  const xml = `<Cube><Cube time='2026-10-14'><Cube currency='USD' rate='1.1195'/><Cube currency='GBP' rate='0.84385'/></Cube></Cube>`;
  assert.deepEqual(parseEcbXml(xml), { date: '2026-10-14', perEur: { EUR: 1, USD: 1.1195, GBP: 0.84385 } });
  assert.equal(parseEcbXml('<html>maintenance</html>'), null);
});

test('raw copies use the TCGplayer price of the same printing, converted', () => {
  const prices = [price({ variant: 'normal', market: 1 }), price({ variant: 'reverse', market: 3.5 })];
  const item = { variant: 'reverse', grader: 'RAW', grade: null, gradeLabel: null };
  const usd = valueItem(item, prices, [], USD, now);
  assert.deepEqual([usd.unit, usd.currency, usd.source, usd.detail], [3.5, 'USD', 'tcgplayer', 'TCGplayer market price']);
  const gbp = valueItem(item, prices, [], GBP, now);
  assert.deepEqual([gbp.unit, gbp.currency], [2.64, 'GBP']);
  assert.match(gbp.detail, /converted from USD/);
});

test('raw copies fall back to Cardmarket when TCGplayer has no price', () => {
  const prices = [
    price({ source: 'cardmarket', variant: 'main', market: 67.37, currency: 'EUR' }),
    price({ source: 'cardmarket', variant: 'holo', market: 10, currency: 'EUR' }),
  ];
  const normal = valueItem({ variant: 'normal', grader: 'RAW', grade: null, gradeLabel: null }, prices, [], GBP, now);
  assert.deepEqual([normal.unit, normal.source], [56.85, 'cardmarket']);
  const reverse = valueItem({ variant: 'reverse', grader: 'RAW', grade: null, gradeLabel: null }, prices, [], GBP, now);
  assert.equal(reverse.unit, 8.44); // Cardmarket's "holo" price is the reverse holo
  const first = valueItem({ variant: 'firstEdition', grader: 'RAW', grade: null, gradeLabel: null }, prices, [], GBP, now);
  assert.equal(first.unit, null); // the unlimited price must not value a 1st Edition copy
});

test('raw copy of a printing with no price is not valued with another printing', () => {
  const v = valueItem({ variant: 'firstEdition', grader: 'RAW', grade: null, gradeLabel: null }, [price({ market: 900 })], [], USD, now);
  assert.equal(v.unit, null);
});

test('graded copies prefer recent logged sales, then PriceCharting', () => {
  const item = { variant: 'holo', grader: 'PSA', grade: 9, gradeLabel: null };
  const pc = price({ source: 'pricecharting', gradeKey: 'g9', market: 2000 });
  const fromPc = valueItem(item, [pc], [], USD, now);
  assert.deepEqual([fromPc.unit, fromPc.source], [2000, 'pricecharting']);
  const sales = [sale({ price: 1500 }), sale({ price: 1700, soldOn: '2026-09-01' }), sale({ price: 1600, soldOn: '2026-08-01' })];
  const v = valueItem(item, [pc], sales, USD, now);
  assert.deepEqual([v.unit, v.source], [1600, 'sales']);
  // Sales of a different grade/grader don't count.
  const other = valueItem(item, [], [sale({ grade: 10 }), sale({ grader: 'BGS' })], USD, now);
  assert.equal(other.unit, null);
});

test('logged sales in different currencies are converted before the median', () => {
  const item = { variant: 'holo', grader: 'PSA', grade: 10, gradeLabel: null };
  const sales = [
    sale({ grade: 10, price: 100, currency: 'GBP' }),
    sale({ grade: 10, price: 120, currency: 'GBP', soldOn: '2026-09-20' }),
    sale({ grade: 10, price: 150, currency: 'USD', soldOn: '2026-09-10' }), // ≈ £113.07
  ];
  const v = valueItem(item, [], sales, GBP, now);
  assert.deepEqual([v.unit, v.currency, v.source], [113.07, 'GBP', 'sales']);
});

test('without exchange rates, foreign prices are skipped rather than guessed', () => {
  const item = { variant: 'holo', grader: 'RAW', grade: null, gradeLabel: null };
  const v = valueItem(item, [price({ market: 5 })], [], { currency: 'GBP', fx: null }, now);
  assert.equal(v.unit, null);
});

test('old sales are used only when nothing better exists', () => {
  const item = { variant: 'holo', grader: 'PSA', grade: 10, gradeLabel: null };
  const old = [sale({ grade: 10, price: 5000, soldOn: '2024-01-01' })];
  assert.equal(valueItem(item, [], old, USD, now).unit, 5000);
  const pc = price({ source: 'pricecharting', gradeKey: 'psa10', market: 7000 });
  assert.equal(valueItem(item, [pc], old, USD, now).unit, 7000);
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 2.5);
});

test('links', () => {
  assert.equal(cardNumberText('4', 102), '4/102');
  assert.equal(cardNumberText('TG05', 30), 'TG05');
  const ref = { name: 'Charizard', number: '4', setName: 'Base Set', setTotal: 102 };
  const url = ebaySoldUrl(ref, 'PSA', 9);
  assert.ok(url.startsWith('https://www.ebay.com/') && url.includes('LH_Sold=1') && url.includes('Charizard%204%2F102%20PSA%209'), url);
  assert.ok(ebaySoldUrl(ref, 'RAW', null, null, 'www.ebay.co.uk').startsWith('https://www.ebay.co.uk/sch/'));
  assert.equal(artistSlug('Mitsuhiro Arita'), 'mitsuhiro-arita');
  assert.equal(artistSlug('Dr.Ooyama'), 'dr-ooyama');
});

test("English copies are valued from TCGplayer (English only), other languages from Cardmarket (any language)", () => {
  const prices = [
    price({ source: 'tcgplayer', variant: 'normal', market: 0.5, currency: 'USD' }),
    price({ source: 'cardmarket', variant: 'main', market: 0.2, currency: 'EUR' }),
  ];
  const copy = (language?: string) => ({ variant: 'normal', language, grader: 'RAW', grade: null, gradeLabel: null });
  const english = valueItem(copy('en'), prices, [], USD, now);
  assert.deepEqual([english.unit, english.source, english.detail], [0.5, 'tcgplayer', 'TCGplayer market price']);
  assert.equal(valueItem(copy(), prices, [], USD, now).source, 'tcgplayer', 'no language: English');
  const french = valueItem(copy('fr'), prices, [], EUR, now);
  assert.deepEqual([french.unit, french.source, french.detail], [0.2, 'cardmarket', 'Cardmarket trend (all languages)']);
  // No Cardmarket price: TCGplayer's, saying it's for English copies
  const german = valueItem(copy('de'), prices.slice(0, 1), [], USD, now);
  assert.deepEqual([german.unit, german.detail], [0.5, 'TCGplayer market price (English copies)']);
});

test('a special printing is valued by its own Cardmarket product, else its plain printing (said so)', () => {
  const cosmos = { variant: 'holo~cosmos', grader: 'RAW', grade: null, gradeLabel: null };
  const prices = [
    price({ source: 'tcgplayer', variant: 'holo', market: 0.14 }),
    price({ source: 'cardmarket', variant: 'main', market: 0.12, currency: 'EUR' }),
    price({ source: 'cardmarket', variant: 'holo~cosmos', market: 0.96, currency: 'EUR' }),
  ];
  const own = valueItem(cosmos, prices, [], EUR, now);
  assert.deepEqual([own.unit, own.source], [0.96, 'cardmarket']);
  const plain = valueItem(cosmos, prices.slice(0, 2), [], USD, now);
  assert.deepEqual([plain.unit, plain.source], [0.14, 'tcgplayer']);
  assert.match(plain.detail, /for its plain printing \(none for this one yet\)$/);
});
