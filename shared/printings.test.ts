import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPrinting, inferPrintings, preferPrintings } from './printings.ts';

const lostThunder = (name: string, rarity: string) => inferPrintings({ setId: 'sm8', name, rarity });

test('Sun & Moon: regular cards and holo rares also come as reverse holos; GX, Prism Star and secret cards only as holos', () => {
  assert.deepEqual(lostThunder('Tangela', 'Common'), ['normal', 'reverse']);
  assert.deepEqual(lostThunder('Shuckle', 'Uncommon'), ['normal', 'reverse']);
  assert.deepEqual(lostThunder('Tangrowth', 'Rare'), ['normal', 'reverse']);
  assert.deepEqual(lostThunder('Zebstrika', 'Rare Holo'), ['holo', 'reverse']);
  assert.deepEqual(lostThunder('Shuckle-GX', 'Rare Holo GX'), ['holo']);
  assert.deepEqual(lostThunder('Shuckle-GX', 'Rare Ultra'), ['holo']);
  assert.deepEqual(lostThunder('Shuckle-GX', 'Rare Rainbow'), ['holo']);
  assert.deepEqual(lostThunder('Lugia ◇', 'Rare Prism Star'), ['holo']);
  assert.deepEqual(lostThunder('Ultra Ball', 'Rare Secret'), ['holo']);
});

test('XY and Black & White: EX and BREAK cards are holo only', () => {
  assert.deepEqual(inferPrintings({ setId: 'xy10', name: 'Delphox BREAK', rarity: 'Rare BREAK' }), ['holo']);
  assert.deepEqual(inferPrintings({ setId: 'xy10', name: 'Zygarde-EX', rarity: 'Rare Holo EX' }), ['holo']);
  assert.deepEqual(inferPrintings({ setId: 'bw11', name: 'Shuckle', rarity: 'Common' }), ['normal', 'reverse']);
  assert.deepEqual(inferPrintings({ setId: 'bw7', name: 'Computer Search', rarity: 'Rare ACE' }), ['holo']);
});

test('promos and special sets have no reverse holos', () => {
  assert.deepEqual(inferPrintings({ setId: 'smp', name: 'Pikachu', rarity: 'Promo' }), ['normal']);
  assert.deepEqual(inferPrintings({ setId: 'xyp', name: 'Mewtwo-EX', rarity: 'Promo' }), ['holo'], 'EX promos are holos');
  assert.deepEqual(inferPrintings({ setId: 'g1', name: 'Pikachu', rarity: 'Common' }), ['normal']);
  assert.deepEqual(inferPrintings({ setId: 'det1', name: 'Detective Pikachu', rarity: 'Rare Holo' }), ['holo']);
  assert.deepEqual(inferPrintings({ setId: 'tk-xy-n', name: 'Pikachu', rarity: null }), ['normal']);
});

test("TCGdex's own rarities work where pokemon-tcg-data has no set", () => {
  assert.deepEqual(inferPrintings({ setId: 'sm3.5', name: 'Mewtwo', rarity: 'Holo Rare' }), ['holo', 'reverse']);
  assert.deepEqual(inferPrintings({ setId: 'sm3.5', name: 'Mewtwo-GX', rarity: 'Ultra Rare' }), ['holo']);
});

test('a printing a card does not come in is taken as its main one', () => {
  assert.equal(fixPrinting('normal', ['holo']), 'holo', 'a Shuckle-GX saved as normal');
  assert.equal(fixPrinting('reverse', ['normal', 'reverse']), 'reverse');
  assert.equal(fixPrinting('normal', null), 'normal', 'printings unknown: left alone');
  assert.equal(fixPrinting('normal', []), 'normal');
});

test("adding a card offers the catalog's printings first, then the rest the API allows", () => {
  assert.deepEqual(preferPrintings(['normal', 'holo', 'reverse', 'firstEdition'], ['holo']), ['holo', 'normal', 'reverse', 'firstEdition']);
  assert.deepEqual(preferPrintings(['normal', 'reverse'], ['normal', 'reverse']), ['normal', 'reverse']);
  assert.deepEqual(preferPrintings(['holo', 'reverse'], null), ['holo', 'reverse']);
  assert.deepEqual(preferPrintings(['normal'], ['holo']), ['normal'], 'only what the API accepts');
});
