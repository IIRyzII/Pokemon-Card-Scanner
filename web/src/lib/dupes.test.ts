import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copiesByCard, spares } from './dupes.ts';

const items = [
  { cardId: 'pikachu', quantity: 3, value: 2 }, // ×3 in one entry
  { cardId: 'furret', quantity: 1, value: 0.5 }, // a Near Mint…
  { cardId: 'furret', quantity: 1, value: 40 }, // …and a PSA 10
  { cardId: 'charizard', quantity: 1, value: 300 }, // just the one
  { cardId: 'mew', quantity: 2, value: null }, // no price yet
];

test('copies are counted per card across its entries', () => {
  assert.deepEqual(Object.fromEntries(copiesByCard(items)), { pikachu: 3, furret: 2, charizard: 1, mew: 2 });
});

test('spare copies are the ones beyond one of each card, keeping the most valuable copy', () => {
  const s = spares(items, (i) => i.value);
  assert.equal(s.cards, 3, 'Pikachu, Furret and Mew');
  assert.equal(s.copies, 4, '2 Pikachu + 1 Furret + 1 Mew');
  assert.equal(s.value, 2 * 2 + 0.5, 'two Pikachu, and the raw Furret (the PSA 10 is the one kept)');
  assert.deepEqual(spares([], (i) => i.value), { cards: 0, copies: 0, value: 0 });
});
