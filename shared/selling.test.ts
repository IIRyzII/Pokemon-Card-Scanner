import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listingDescription, listingTitle, TITLE_LIMIT, type ListingCopy } from './selling.ts';

const charizard: ListingCopy = {
  name: 'Charizard',
  setName: 'Base Set',
  number: '4',
  setTotal: 102,
  rarity: 'Rare Holo',
  artist: 'Mitsuhiro Arita',
  variant: 'holo',
  language: 'en',
  grader: 'PSA',
  grade: 9,
  gradeLabel: null,
  condition: null,
  certNumber: '12345678',
};

test('a listing title: the card, its set and printing, and its grade or condition', () => {
  assert.equal(listingTitle(charizard), 'Charizard 4/102 Base Set Holo Pokemon Card PSA 9');
  assert.equal(
    listingTitle({ ...charizard, variant: 'reverse', language: 'fr', grader: 'RAW', grade: null, condition: 'NM' }),
    'Charizard 4/102 Base Set Reverse Holo French Pokemon Card NM',
  );
  assert.equal(listingTitle({ ...charizard, variant: 'normal', grader: 'RAW', grade: null, condition: 'LP' }), 'Charizard 4/102 Base Set Pokemon Card LP');
  assert.equal(listingTitle({ ...charizard, grader: 'BGS', grade: 10, gradeLabel: 'Black Label' }), 'Charizard 4/102 Base Set Holo Pokemon Card BGS 10 Black Label');
});

test('a long title drops its least useful words to fit eBay’s 80 characters', () => {
  const long = { ...charizard, name: 'Pikachu & Zekrom-GX', setName: 'Sun & Moon Black Star Promos Collection', number: 'SM168', setTotal: null, variant: 'holo~cosmos+staff' };
  const title = listingTitle(long);
  assert.ok(title.length <= TITLE_LIMIT, `${title.length}: ${title}`);
  assert.ok(title.startsWith('Pikachu & Zekrom-GX SM168'), title);
  assert.ok(title.endsWith('PSA 9'), 'the grade stays');
  assert.ok(!title.includes('Card'), '"Card" goes first');
});

test('a listing description: one fact a line, the certificate for a slab, the condition for a raw card', () => {
  assert.equal(
    listingDescription(charizard),
    ['Charizard, Base Set, 4/102', 'Rarity: Rare Holo', 'Printing: Holo', 'Language: English', 'Graded: PSA 9 (certificate 12345678)', 'Illustrator: Mitsuhiro Arita'].join('\n'),
  );
  assert.equal(
    listingDescription({ ...charizard, variant: 'normal', rarity: null, artist: null, grader: 'RAW', grade: null, condition: 'NM', certNumber: null }),
    ['Charizard, Base Set, 4/102', 'Printing: Regular', 'Language: English', 'Condition: Near Mint'].join('\n'),
  );
});
