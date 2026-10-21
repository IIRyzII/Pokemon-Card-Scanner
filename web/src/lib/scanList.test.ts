import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ItemFields } from '../../../shared/types.ts';
import type { CatalogCard } from './catalog.ts';
import { addCard, copiesIn, listCardOf, takeBack, withVariants, type ListCard, type ListEntry } from './scanList.ts';

const fields = (patch: Partial<ItemFields> = {}): ItemFields => ({
  variant: 'normal',
  grader: 'RAW',
  grade: null,
  gradeLabel: null,
  condition: 'NM',
  quantity: 1,
  purchasePrice: null,
  purchaseCurrency: 'GBP',
  purchaseDate: null,
  certNumber: null,
  notes: null,
  ...patch,
});

const card = (id: string): ListCard => ({ id, name: id, setId: 'sv03.5', setName: '151', number: '025', setTotal: 165, image: null });

test('a new card goes on top of the list; another copy counts its entry up', () => {
  let list: ListEntry[] = [];
  list = addCard(list, card('a'), fields(), 'k1').list;
  const second = addCard(list, card('b'), fields(), 'k2');
  assert.equal(second.more, false);
  assert.deepEqual(
    second.list.map((e) => e.card.id),
    ['b', 'a'],
  );
  const again = addCard([{ ...second.list[1], error: 'Server busy' }, second.list[0]], card('a'), fields(), 'k3');
  assert.equal(again.more, true);
  assert.equal(again.entry.key, 'k1', 'the existing entry, not a new one');
  assert.equal(again.list.length, 2);
  assert.equal(again.entry.fields.quantity, 2);
  assert.equal(again.entry.error, undefined, 'a failed add is retried with the new count');
  assert.equal(copiesIn(again.list), 3);
});

test('a card already in the list keeps its edited details when another copy is scanned', () => {
  const list = addCard([], card('a'), fields({ variant: 'reverse', condition: 'LP' }), 'k1').list;
  const { entry } = addCard(list, card('a'), fields(), 'k2');
  assert.deepEqual([entry.fields.variant, entry.fields.condition, entry.fields.quantity], ['reverse', 'LP', 2]);
});

test('undo takes a new card out, or counts another copy back down', () => {
  const one = addCard([], card('a'), fields(), 'k1');
  assert.deepEqual(takeBack(one.list, one.entry.key, one.more), []);
  const two = addCard(one.list, card('a'), fields(), 'k2');
  const back = takeBack(two.list, two.entry.key, two.more);
  assert.equal(back.length, 1);
  assert.equal(back[0].fields.quantity, 1);
});

test('the first printing the API reports is the starting one; later it only moves off one the card lacks', () => {
  let list = addCard([], card('a'), fields(), 'k1').list;
  list = addCard(list, card('b'), fields(), 'k2').list;
  list = withVariants(list, 'a', ['holo', 'reverse']);
  const a = () => list.find((e) => e.card.id === 'a')!;
  assert.deepEqual(a().variants, ['holo', 'reverse']);
  assert.equal(a().fields.variant, 'holo');
  assert.equal(list.find((e) => e.card.id === 'b')!.variants, null, 'other cards are untouched');

  list = list.map((e) => (e.card.id === 'a' ? { ...e, fields: { ...e.fields, variant: 'reverse' } } : e));
  list = withVariants(list, 'a', ['holo', 'reverse']);
  assert.equal(a().fields.variant, 'reverse', 'a printing picked by hand stays');
  list = withVariants(list, 'a', ['holo']);
  assert.equal(a().fields.variant, 'holo');

  list = withVariants(list, 'b', []);
  assert.equal(list.find((e) => e.card.id === 'b')!.fields.variant, 'normal', 'no printings known: keep the default');
});

test('list cards keep what the list shows: set, printed number and picture', () => {
  const c = {
    id: 'sv03.5-025',
    name: 'Pikachu',
    number: '025',
    image: 'https://assets.tcgdex.net/en/sv/sv03.5/025',
    set: { id: 'sv03.5', name: '151', official: 165 },
  } as CatalogCard;
  assert.deepEqual(listCardOf(c), {
    id: 'sv03.5-025',
    name: 'Pikachu',
    setId: 'sv03.5',
    setName: '151',
    number: '025',
    setTotal: 165,
    image: 'https://assets.tcgdex.net/en/sv/sv03.5/025',
  });
});
