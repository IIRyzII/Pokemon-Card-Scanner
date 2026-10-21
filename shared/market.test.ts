import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPrices, reportedSources, standardPrice } from './market.ts';

const now = '2026-10-17T00:00:00Z';
// TCGdex's pricing for Paradox Rift #001 (normal + reverse holo)
const sv04001 = {
  pricing: {
    cardmarket: { updated: now, unit: 'EUR', avg: 0.03, low: 0.02, trend: 0.03, avg30: 0.02, 'trend-holo': 0.1, 'low-holo': 0.02, 'avg30-holo': 0.1 },
    tcgplayer: {
      unit: 'USD',
      updated: now,
      normal: { productId: 523584, lowPrice: 0.01, midPrice: 0.15, highPrice: 20, marketPrice: 0.11 },
      'reverse-holofoil': { productId: 523584, lowPrice: 0.03, midPrice: 0.23, highPrice: 18.86, marketPrice: 0.21 },
    },
  },
};

test('extracts TCGplayer printings and Cardmarket main/holo prices', () => {
  const rows = extractPrices(sv04001, now);
  assert.deepEqual(
    rows.map((r) => `${r.source}:${r.variant}:${r.market} ${r.currency}`),
    ['tcgplayer:normal:0.11 USD', 'tcgplayer:reverse:0.21 USD', 'cardmarket:main:0.03 EUR', 'cardmarket:holo:0.1 EUR'],
  );
});

test('standard price: the plain printing, not the reverse holo', () => {
  assert.deepEqual(standardPrice({ normal: true, reverse: true }, extractPrices(sv04001, now)), { amount: 0.11, currency: 'USD' });
});

test('standard price: a holo-only card uses its holo price', () => {
  const rows = extractPrices({ pricing: { tcgplayer: { holofoil: { marketPrice: 45.5 }, 'reverse-holofoil': { marketPrice: 50 } } } }, now);
  assert.deepEqual(standardPrice({ holo: true, reverse: true }, rows), { amount: 45.5, currency: 'USD' });
});

test('standard price: Cardmarket when TCGplayer has nothing', () => {
  const rows = extractPrices({ pricing: { cardmarket: { trend: 2.5, 'trend-holo': 4 } } }, now);
  assert.deepEqual(standardPrice({ normal: true }, rows), { amount: 2.5, currency: 'EUR' });
  assert.deepEqual(standardPrice({ reverse: true }, rows), { amount: 4, currency: 'EUR' }, 'reverse-only cards: Cardmarket holo');
  assert.equal(standardPrice({ normal: true }, extractPrices({ pricing: null }, now)), null);
});

test('a source left out of the response is not reported (its old prices stay)', () => {
  assert.deepEqual(reportedSources(sv04001), ['tcgplayer', 'cardmarket']);
  assert.deepEqual(reportedSources({ pricing: { cardmarket: sv04001.pricing.cardmarket } }), ['cardmarket']);
  assert.deepEqual(reportedSources({ pricing: { tcgplayer: null, cardmarket: sv04001.pricing.cardmarket } }), ['cardmarket']);
  assert.deepEqual(reportedSources({}), []);
});
