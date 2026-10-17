import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardPrint, hamming, PRINT_BITS, PRINT_WORDS, resample } from './cardprint.ts';

/** A synthetic "card": rectangles of different shades (placed in card fractions, so any size draws the same picture). */
function card(seed: number, width = 245, height = 337, light = 1): { data: Uint8ClampedArray; width: number; height: number; channels: 4 } {
  let r = seed * 9301 + 49297;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const rects = Array.from({ length: 40 }, () => ({ x: rnd(), y: rnd(), w: rnd() * 0.4, h: rnd() * 0.3, v: rnd() * 255 }));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      let value = 120;
      for (const q of rects) if (u >= q.x && u < q.x + q.w && v >= q.y && v < q.y + q.h) value = q.v;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value * light;
      data[i + 3] = 255;
    }
  }
  return { data, width, height, channels: 4 };
}

const distance = (a: Uint32Array, b: Uint32Array) => hamming(a, b, 0);

test('a print has the advertised size', () => {
  assert.equal(cardPrint(card(1)).length, PRINT_WORDS);
  assert.ok(PRINT_BITS > 200 && PRINT_BITS <= PRINT_WORDS * 32);
});

test('the same picture at another size or brightness prints (nearly) the same', () => {
  const a = cardPrint(card(1));
  assert.ok(distance(a, cardPrint(card(1, 600, 825))) <= 12, 'resized');
  assert.ok(distance(a, cardPrint(card(1, 245, 337, 0.7))) <= 12, 'darker');
});

test('different pictures print very differently', () => {
  const a = cardPrint(card(1));
  for (const seed of [2, 3, 5]) assert.ok(distance(a, cardPrint(card(seed))) > PRINT_BITS / 4, `seed ${seed}`);
});

test('area-averaged resample keeps the average', () => {
  const gray = Float32Array.from({ length: 10 * 10 }, (_, i) => (i % 2 ? 200 : 0));
  const out = resample(gray, 10, 10, [0, 0, 1, 1], 5, 5);
  for (const v of out) assert.ok(Math.abs(v - 100) < 1e-3);
});
