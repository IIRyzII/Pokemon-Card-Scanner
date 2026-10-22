import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectCard, type Corners, type Image } from './detect.ts';
import { homography, rotate180, warpCard } from './warp.ts';

const W = 300;
const H = 400;

/** A card-shaped quad (tilted, slightly in perspective) on a noisy background, like a camera frame. */
function scene(corners: Corners, colours: { bg: number[]; border: number[]; art: number[] }, seed = 1): Image {
  let r = seed;
  const noise = () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 12;
  const data = new Uint8ClampedArray(W * H * 4);
  // Card-space coordinates of each pixel: invert the card → image mapping.
  const toCard = homography(corners, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = toCard[6] * x + toCard[7] * y + 1;
      const u = (toCard[0] * x + toCard[1] * y + toCard[2]) / d;
      const v = (toCard[3] * x + toCard[4] * y + toCard[5]) / d;
      const inCard = u >= 0 && u <= 1 && v >= 0 && v <= 1;
      const inArt = u > 0.1 && u < 0.9 && v > 0.11 && v < 0.5;
      const c = inArt ? colours.art : inCard ? colours.border : colours.bg;
      const n = noise();
      const i = (y * W + x) * 4;
      data[i] = c[0] + n;
      data[i + 1] = c[1] + n;
      data[i + 2] = c[2] + n;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

const tilted: Corners = [
  { x: 70, y: 70 },
  { x: 232, y: 82 },
  { x: 222, y: 315 },
  { x: 55, y: 300 },
];
const error = (a: Corners, b: Corners) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

test('finds a tilted card on a table', () => {
  const found = detectCard(scene(tilted, { bg: [90, 70, 50], border: [235, 200, 60], art: [60, 110, 160] }));
  assert.ok(found, 'no card found');
  assert.ok(error(found.corners, tilted) < 4, `corners off by ${error(found.corners, tilted).toFixed(1)}px`);
});

test('finds a yellow-bordered card on white paper (by colour, not brightness)', () => {
  const found = detectCard(scene(tilted, { bg: [236, 236, 232], border: [240, 215, 70], art: [200, 90, 60] }, 7));
  assert.ok(found, 'no card found');
  assert.ok(error(found.corners, tilted) < 4, `corners off by ${error(found.corners, tilted).toFixed(1)}px`);
});

test('offers the card itself when the most card-like outline is its binder pocket', () => {
  const card: Corners = [
    { x: 80, y: 90 },
    { x: 224, y: 90 },
    { x: 224, y: 291 },
    { x: 80, y: 291 },
  ];
  const img = scene(card, { bg: [20, 20, 22], border: [235, 200, 60], art: [60, 110, 160] }, 3);
  // The pocket's welded seams: a thin light line a little way round the card, slid to its bottom.
  const seam = (x: number, y: number) => img.data.set([200, 200, 205], (y * W + x) * 4);
  for (let t = 0; t < 2; t++) {
    for (let x = 70; x <= 234; x++) {
      seam(x, 70 + t);
      seam(x, 299 + t);
    }
    for (let y = 70; y <= 300; y++) {
      seam(70 + t, y);
      seam(233 + t, y);
    }
  }
  const found = detectCard(img);
  assert.ok(found, 'no card found');
  const outlines = [found.corners, ...found.others];
  const best = Math.min(...outlines.map((o) => error(o, card)));
  assert.ok(best < 4, `card's own outline off by ${best.toFixed(1)}px`);
});

test('finds nothing in an empty scene', () => {
  const empty: Corners = [
    { x: -10, y: -10 },
    { x: -5, y: -10 },
    { x: -5, y: -5 },
    { x: -10, y: -5 },
  ];
  assert.equal(detectCard(scene(empty, { bg: [90, 70, 50], border: [0, 0, 0], art: [0, 0, 0] })), null);
});

test('straightening maps the corners onto the output rectangle', () => {
  const h = homography(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 140 },
      { x: 0, y: 140 },
    ],
    tilted,
  );
  const map = (u: number, v: number) => {
    const d = h[6] * u + h[7] * v + 1;
    return { x: (h[0] * u + h[1] * v + h[2]) / d, y: (h[3] * u + h[4] * v + h[5]) / d };
  };
  for (const [[u, v], p] of [[[0, 0], tilted[0]], [[100, 0], tilted[1]], [[100, 140], tilted[2]], [[0, 140], tilted[3]]] as const) {
    const m = map(u, v);
    assert.ok(Math.hypot(m.x - p.x, m.y - p.y) < 1e-6);
  }
  // The straightened card's art box lands where it is on the card.
  const img = scene(tilted, { bg: [90, 70, 50], border: [235, 200, 60], art: [60, 110, 160] });
  const flat = warpCard(img, tilted, 100, 140);
  const at = (x: number, y: number) => Array.from(flat.data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3));
  assert.ok(at(50, 40)[2] > 140, 'art box should be blue'); // inside the art (v ≈ 0.29)
  assert.ok(at(50, 110)[0] > 200, 'lower half should be the yellow border colour');
  assert.deepEqual(Array.from(rotate180(flat).data.slice(0, 4)), Array.from(flat.data.slice(-4)));
});
