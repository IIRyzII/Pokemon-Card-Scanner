import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameChange } from './motion.ts';

const W = 24;
const H = 34;
/** A dark card-sized rectangle on a lighter table, offset by dx pixels. */
function scene(dx: number, brightness = 0): number[] {
  const px: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.push((x - dx >= 4 && x - dx < 20 && y >= 3 && y < 31 ? 40 : 170) + brightness);
  return px;
}

test('steady: the same view barely changes', () => {
  assert.equal(frameChange(scene(0), scene(0)), 0);
  const noisy = scene(0).map((v, i) => v + ((i * 7) % 5) - 2); // sensor noise of ±2
  assert.ok(frameChange(scene(0), noisy) < 3);
});

test('steady: the camera brightening or darkening is not movement', () => {
  assert.ok(frameChange(scene(0), scene(0, 25)) < 1);
});

test('moving: a card sliding across the frame is', () => {
  assert.ok(frameChange(scene(0), scene(3)) > 12);
});
