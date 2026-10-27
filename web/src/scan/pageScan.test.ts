import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardPrint, PRINT_WORDS } from '../../../shared/cardprint.ts';
import type { CatalogCard } from '../lib/catalog.ts';
import { PrintIndex } from '../lib/pictures.ts';
import { checkPage, distanceTo, MATCH_CLOSE, MATCH_GAP, pocketVerdict, readPage } from './pageScan.ts';

const card = (id: string, name = id): CatalogCard => ({ id, name, nameKey: name, number: '1', image: 'x' }) as unknown as CatalogCard;

/** Blocks of random colour: a picture that looks like nothing else. */
function picture(width: number, height: number, seed: number) {
  let r = seed;
  const next = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const data = new Uint8ClampedArray(width * height * 4);
  const block = 8;
  const across = Math.ceil(width / block);
  const shades = Array.from({ length: across * Math.ceil(height / block) }, () => [next() * 255, next() * 255, next() * 255]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = shades[Math.floor(y / block) * across + Math.floor(x / block)];
      data.set([s[0], s[1], s[2], 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

test('a page photo: the cards that go in their pockets are found; a wrong card or an empty pocket never is', () => {
  // A 2×2 page photo, 200×270 a pocket, cards 180×252 in them on a dark page
  const W = 400;
  const H = 540;
  const page = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < page.length; i += 4) page.set([24, 24, 28, 255], i);
  const arts = [11, 22, 33, 44, 55].map((seed) => picture(180, 252, seed));
  const put = (art: ReturnType<typeof picture>, col: number, row: number) => {
    for (let y = 0; y < art.height; y++) page.set(art.data.subarray(y * art.width * 4, (y + 1) * art.width * 4), ((row * 270 + 9 + y) * W + col * 200 + 10) * 4);
  };
  put(arts[0], 0, 0); // a: in its pocket
  put(arts[1], 1, 0); // b: in its pocket
  put(arts[4], 0, 1); // x: where c goes
  // d's pocket is empty

  const cards = ['a', 'b', 'c', 'd', 'x'].map((id) => card(id));
  const fillers = Array.from({ length: 30 }, (_, i) => card(`other-${i}`));
  const words = new Uint32Array((cards.length + fillers.length) * PRINT_WORDS);
  arts.forEach((art, i) => words.set(cardPrint({ ...art, channels: 4 }), i * PRINT_WORDS));
  fillers.forEach((_, i) => words.set(cardPrint({ ...picture(180, 252, 1000 + i), channels: 4 }), (cards.length + i) * PRINT_WORDS));
  const index = new PrintIndex(words, [...cards, ...fillers]);

  // Read from scratch (a page of any cards): each card named, the empty pocket not
  const reads = readPage(index, { data: page, width: W, height: H }, 2, 2);
  assert.deepEqual(
    reads.map((r) => [r.outcome, r.card?.id ?? null]),
    [
      ['clear', 'a'],
      ['clear', 'b'],
      ['clear', 'x'],
      ['none', null],
    ],
  );

  const checks = checkPage(index, { data: page, width: W, height: H }, 2, 2, cards.slice(0, 4));
  assert.deepEqual(
    checks.map((c) => c?.outcome),
    ['match', 'match', 'other', 'unsure'],
  );
  assert.equal(checks[2]?.seen?.id, 'x', 'the card in the wrong pocket is named');
  // The card found sits where it was put (photo pixels)
  assert.ok(Math.abs(checks[1]!.corners[0].x - 210) < 12 && Math.abs(checks[1]!.corners[0].y - 9) < 12, JSON.stringify(checks[1]!.corners[0]));
  // Pockets past the binder's end aren't looked at
  assert.deepEqual(checkPage(index, { data: page, width: W, height: H }, 2, 2, [cards[0], null, null, null]).slice(1), [null, null, null]);
});

test('what a pocket is: the card that goes there only when it is close and clearly closer than any other', () => {
  const expected = card('sv04-032', 'Kingdra');
  const m = (id: string, distance: number, name = id) => ({ card: card(id, name), distance });
  assert.equal(pocketVerdict(expected, 30, [m('sv04-032', 30, 'Kingdra'), m('x', 120)]).outcome, 'match');
  assert.equal(pocketVerdict(expected, MATCH_CLOSE + 1, [m('x', 140)]).outcome, 'unsure', 'not close enough');
  assert.equal(pocketVerdict(expected, 40, [m('y', 40 + MATCH_GAP - 1)]).outcome, 'unsure', 'another card nearly as close');
  // A reprint with the same picture doesn't count against it
  assert.equal(pocketVerdict(expected, 30, [m('reprint', 28, 'Kingdra'), m('x', 120)]).outcome, 'match');
  // A different card, clearly
  const other = pocketVerdict(expected, 130, [m('x', 20), m('y', 125)]);
  assert.deepEqual([other.outcome, other.seen?.id], ['other', 'x']);
  // No picture to compare with
  assert.equal(pocketVerdict(expected, Infinity, [m('x', 90), m('y', 100)]).outcome, 'unsure');
});

test('a card without a picture is never matched by it', () => {
  const index = new PrintIndex(new Uint32Array(2 * PRINT_WORDS), [card('a'), card('b')]);
  assert.equal(distanceTo(index, new Uint32Array(PRINT_WORDS), card('a')), Infinity);
  assert.equal(distanceTo(index, new Uint32Array(PRINT_WORDS), card('missing')), Infinity);
});
