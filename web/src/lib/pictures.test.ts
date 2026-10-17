import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRINT_WORDS } from '../../../shared/cardprint.ts';
import type { CatalogCard } from './catalog.ts';
import { identifyCard, matchConfidence, type Candidate, type ScanGuess } from './match.ts';
import { CLEAR, CLOSE, PrintIndex, pictureVerdict, TWIN, type PictureMatch } from './pictures.ts';

const card = (id: string, name: string, number = '1'): CatalogCard =>
  ({ id, name, number, nameKey: name.toLowerCase(), nameWords: name.toLowerCase().split(' '), numKey: number, image: 'x', set: { id: id.split('-')[0] } }) as unknown as CatalogCard;

test('nearest pictures come back closest first, skipping cards without one', () => {
  const cards = [card('a-1', 'A'), card('b-1', 'B'), card('c-1', 'C'), card('d-1', 'D')];
  const words = new Uint32Array(cards.length * PRINT_WORDS);
  words.fill(0xffffffff, 0, PRINT_WORDS); // a: every bit set
  words.fill(0x0000ffff, PRINT_WORDS, 2 * PRINT_WORDS); // b: half the bits set
  words.fill(0xfffffff0, 2 * PRINT_WORDS, 3 * PRINT_WORDS); // c: all but 4 bits a word
  // d: all zeros = no picture
  const query = new Uint32Array(PRINT_WORDS).fill(0xffffffff);
  const near = new PrintIndex(words, cards).nearest(query, 10);
  assert.deepEqual(
    near.map((m) => m.card.id),
    ['a-1', 'c-1', 'b-1'],
  );
  assert.equal(near[0].distance, 0);
});

const m = (c: CatalogCard, distance: number): PictureMatch => ({ card: c, distance });

test('picture verdict: one close, clear match names the card', () => {
  const v = pictureVerdict([m(card('a-1', 'Pikachu'), 30), m(card('b-1', 'Raichu'), 30 + CLEAR + 5)])!;
  assert.equal(v.clear, true);
  assert.equal(v.twins.length, 0);
});

test('picture verdict: reprints that look alike are twins; a near tie is not clear', () => {
  const v = pictureVerdict([m(card('a-1', 'Scoop Up'), 40), m(card('b-1', 'Scoop Up'), 40 + TWIN - 5), m(card('c-1', 'Potion'), 90)])!;
  assert.equal(v.clear, true);
  assert.deepEqual(
    v.twins.map((t) => t.card.id),
    ['b-1'],
  );
  assert.equal(pictureVerdict([m(card('a-1', 'Pikachu'), 50), m(card('b-1', 'Raichu'), 55)])!.clear, false);
  assert.equal(pictureVerdict([m(card('a-1', 'Pikachu'), CLOSE + 10)])!.clear, false);
});

const nothing: ScanGuess = { names: [], number: null, total: null, setCode: null, artist: null };
const cat = { byNumber: new Map(), byName: new Map(), sets: [], bySet: new Map() } as never;

test('confidence: a clear picture alone is sure; reprints need the printed number', () => {
  const pika = card('a-1', 'Pikachu');
  const picture = pictureVerdict([m(pika, 25), m(card('b-1', 'Raichu'), 100)]);
  const candidates = identifyCard(cat, nothing, 12, [m(pika, 25), m(card('b-1', 'Raichu'), 100)]);
  assert.equal(candidates[0].card.id, 'a-1');
  assert.equal(matchConfidence(nothing, candidates, picture), 'sure');

  const base = card('base1-91', 'Scoop Up', '91');
  const lc = card('lc-104', 'Scoop Up', '104');
  const twins = pictureVerdict([m(base, 30), m(lc, 35), m(card('x-1', 'Potion'), 110)]);
  const byPicture = identifyCard(cat, nothing, 12, [m(base, 30), m(lc, 35)]);
  assert.equal(matchConfidence(nothing, byPicture, twins), 'likely', 'no number read: which printing is unknown');
  // The number pins the printing (as identifyCard would score "number + set size").
  const withNumber: Candidate[] = [
    { card: lc, score: 110, why: ['number', 'set size', 'picture'] },
    { card: base, score: 52, why: ['picture'] },
  ];
  assert.equal(matchConfidence({ ...nothing, number: '104', total: 110 }, withNumber, twins), 'sure');
});

test('confidence: text that is "sure" but unlike the picture is only likely', () => {
  const read = { ...nothing, names: ['Charizard'], number: '4', total: 102, hp: 120 };
  const top: Candidate = { card: card('base1-4', 'Charizard', '4'), score: 120, why: ['number', 'set size', 'name', 'HP'] };
  const unclear = pictureVerdict([m(card('z-9', 'Zubat'), 95), m(card('y-9', 'Golbat'), 97)]);
  assert.equal(matchConfidence(read, [top], unclear), 'likely');
  assert.equal(matchConfidence(read, [top], null), 'sure', 'no picture to compare (card not found in the photo)');
});
