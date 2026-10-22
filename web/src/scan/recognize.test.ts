import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardPrint, PRINT_WORDS } from '../../../shared/cardprint.ts';
import type { CatalogCard } from '../lib/catalog.ts';
import { PrintIndex } from '../lib/pictures.ts';
import type { Corners } from './detect.ts';
import type { Located } from './locate.ts';
import { matchLocated } from './recognize.ts';

const card = (id: string): CatalogCard => ({ id, name: id, nameKey: id, number: '1', image: 'x' }) as unknown as CatalogCard;

/** Blocks of random colour: a picture that looks like nothing else. */
function picture(width: number, height: number, seed: number) {
  let r = seed;
  const next = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const data = new Uint8ClampedArray(width * height * 4);
  const block = 6;
  const shades = Array.from({ length: Math.ceil(width / block) * Math.ceil(height / block) }, () => [next() * 255, next() * 255, next() * 255]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = shades[Math.floor(y / block) * Math.ceil(width / block) + Math.floor(x / block)];
      data.set([s[0], s[1], s[2], 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const box = (x: number, y: number, w: number, h: number): Corners => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

test('a card in a binder page is matched in its own outline, not the most card-like one', () => {
  // The card (126×176) in a page of dark backing; the outline found first reaches across to the
  // next pocket, the card's own outline is among the others.
  const art = picture(126, 176, 7);
  const W = 300;
  const H = 400;
  const page = new Uint8ClampedArray(W * H * 4).fill(25);
  for (let y = 0; y < art.height; y++) page.set(art.data.subarray(y * art.width * 4, (y + 1) * art.width * 4), ((110 + y) * W + 80) * 4);
  const own = box(80, 110, 126, 176);
  const across = box(130, 100, 136, 190);

  const cards = [card('target'), ...Array.from({ length: 20 }, (_, i) => card(`other-${i}`))];
  const words = new Uint32Array(cards.length * PRINT_WORDS);
  words.set(cardPrint({ ...art, channels: 4 }), 0);
  cards.slice(1).forEach((_, i) => words.set(cardPrint({ ...picture(126, 176, 100 + i), channels: 4 }), (i + 1) * PRINT_WORDS));
  const index = new PrintIndex(words, cards);

  const small = { data: page, width: W, height: H } as unknown as ImageData;
  const found: Located = { corners: across, score: 0.8, others: [own], small, smallCorners: across, smallOthers: [own] };
  const match = matchLocated(index, found);
  assert.equal(match.matches[0].card.id, 'target');
  assert.ok(match.picture?.clear, 'the card should be clear in its own outline');
  assert.equal(match.corners, own);

  // With its own outline found first, the others aren't needed.
  const direct = matchLocated(index, { ...found, corners: own, smallCorners: own, others: [across], smallOthers: [across] });
  assert.equal(direct.corners, own);
  assert.equal(direct.matches[0].card.id, 'target');
});
