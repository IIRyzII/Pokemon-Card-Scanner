// Runs against the real generated catalog (npm run catalog).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildCatalog, type CatalogJson } from './catalog.ts';
import { percentText, setProgress } from './sets.ts';

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
});
