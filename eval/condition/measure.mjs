// Runs the grade check's border measurement (web/src/scan/condition.ts) on real card designs: each
// picture flat (as if the card had been found exactly), and in a simulated phone photo of it (held
// at an angle on a dark table, slightly soft and noisy, found the way the app finds it). The true
// centering of the pictures isn't known, so this measures how often a design's borders can be
// measured at all, and how much a photo changes the result.
//
// Usage: node --experimental-strip-types measure.mjs LIST [--details]
//   LIST: the file fetch.py wrote.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { centering, measureBorders, SIDES, straightenPadded } from '../../web/src/scan/condition.ts';
import { detectCard, shrink } from '../../web/src/scan/detect.ts';
import { homography } from '../../web/src/scan/warp.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const [list, ...flags] = process.argv.slice(2);
const details = flags.includes('--details');
const { cards, catalog, seed, perSet } = JSON.parse(fs.readFileSync(list, 'utf8'));
const DARK = [36, 33, 30];

function load({ file }) {
  const { data, width, height } = jpeg.decode(fs.readFileSync(path.join(here, '.cache', `${file}.jpg`)), { useTArray: true, formatAsRGBA: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height };
}

/** The picture edge to edge on a dark background, `m` pixels round it, straightened as if found exactly. */
function flat(img, m = 40) {
  const W = img.width + 2 * m;
  const H = img.height + 2 * m;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...DARK, 255], i * 4);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + m) * W + m) * 4);
  const corners = [
    { x: m, y: m },
    { x: m + img.width, y: m },
    { x: m + img.width, y: m + img.height },
    { x: m, y: m + img.height },
  ];
  return straightenPadded({ data, width: W, height: H }, corners, img.height);
}

function sample(img, x, y) {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const at = (xx, yy, k) => img.data[(yy * img.width + xx) * 4 + k];
  return [0, 1, 2].map((k) => (at(x0, y0, k) * (1 - fx) + at(x1, y0, k) * fx) * (1 - fy) + (at(x0, y1, k) * (1 - fx) + at(x1, y1, k) * fx) * fy);
}

/** A 640×860 photo of the picture held at `corners`: 2×2 samples a pixel, a slight blur and noise. */
function photo(img, corners, seed) {
  const W = 640;
  const H = 860;
  const toCard = homography(corners, [
    { x: 0, y: 0 },
    { x: img.width, y: 0 },
    { x: img.width, y: img.height },
    { x: 0, y: img.height },
  ]);
  const raw = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const [ox, oy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const X = x + ox;
        const Y = y + oy;
        const d = toCard[6] * X + toCard[7] * Y + 1;
        const u = (toCard[0] * X + toCard[1] * Y + toCard[2]) / d;
        const v = (toCard[3] * X + toCard[4] * Y + toCard[5]) / d;
        const c = u < 0 || v < 0 || u > img.width || v > img.height ? DARK : sample(img, u - 0.5, v - 0.5);
        for (let k = 0; k < 3; k++) raw[(y * W + x) * 3 + k] += c[k] / 4;
      }
    }
  }
  let s = seed;
  const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 10;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = noise();
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        let weights = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const w = (dx ? 1 : 2) * (dy ? 1 : 2);
            sum += raw[(Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))) * 3 + k] * w;
            weights += w;
          }
        }
        data[(y * W + x) * 4 + k] = sum / weights + n;
      }
      data[(y * W + x) * 4 + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

/** Three ways of holding the card: tilted and in perspective. */
const HOLDS = [
  [
    { x: 112, y: 70 },
    { x: 548, y: 92 },
    { x: 532, y: 786 },
    { x: 96, y: 768 },
  ],
  [
    { x: 90, y: 96 },
    { x: 520, y: 80 },
    { x: 545, y: 770 },
    { x: 110, y: 790 },
  ],
  [
    { x: 120, y: 84 },
    { x: 530, y: 84 },
    { x: 540, y: 776 },
    { x: 108, y: 776 },
  ],
];

/** Each axis's centering (the larger border's share at the worse end), when both its borders were measured. */
function readings(padded) {
  const m = measureBorders(padded);
  const axis = (a, b, name) => (m.quality[a] && m.quality[b] ? centering(m.lines, m.quality, padded.scale, name).share : null);
  return { leftRight: axis('left', 'right', 'leftRight'), topBottom: axis('top', 'bottom', 'topBottom'), uneven: m.uneven, measured: SIDES.filter((s) => m.quality[s]).length };
}

const rows = cards.map((card, k) => {
  const img = load(card);
  const f = readings(flat(img));
  const shot = photo(img, HOLDS[k % HOLDS.length], 11 + k);
  const scale = 400 / shot.height;
  const found = detectCard(shrink(shot, scale));
  let p = null;
  if (found) {
    const c = found.corners.map((q) => ({ x: q.x / scale, y: q.y / scale }));
    const seen = (Math.hypot(c[0].x - c[3].x, c[0].y - c[3].y) + Math.hypot(c[1].x - c[2].x, c[1].y - c[2].y)) / 2;
    p = readings(straightenPadded(shot, c, Math.min(1600, Math.max(700, seen))));
  }
  return { id: card.id, flat: f, photo: p };
});

const pct = (n, of) => `${n} of ${of} (${((100 * n) / of).toFixed(1)}%)`;
const both = (r) => r && r.leftRight !== null && r.topBottom !== null;
const flatBoth = rows.filter((r) => both(r.flat));
console.log(`catalogue ${catalog}, seed ${seed}, ${perSet} a set: ${rows.length} cards`);
console.log(`flat: both axes measured on ${pct(flatBoth.length, rows.length)}; left/right on ${rows.filter((r) => r.flat.leftRight !== null).length}, top/bottom on ${rows.filter((r) => r.flat.topBottom !== null).length}`);
console.log(`photo: card found in ${pct(rows.filter((r) => r.photo).length, rows.length)}; both axes measured on ${pct(flatBoth.filter((r) => both(r.photo)).length, flatBoth.length)} of those measured flat`);
const pairs = rows.flatMap((r) =>
  ['leftRight', 'topBottom'].flatMap((a) => (r.flat[a] !== null && r.photo?.[a] != null ? [{ id: r.id, axis: a, flat: r.flat[a], photo: r.photo[a], diff: Math.abs(r.photo[a] - r.flat[a]), uneven: r.photo.uneven }] : [])),
);
const diffs = pairs.map((p) => p.diff).sort((a, b) => a - b);
const q = (f) => diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * f))].toFixed(1);
console.log(`photo against flat, ${pairs.length} axis readings: median difference ${q(0.5)} points, 90th percentile ${q(0.9)}`);
for (const limit of [1, 3, 5]) console.log(`  more than ${limit} point${limit > 1 ? 's' : ''} apart: ${pct(pairs.filter((p) => p.diff > limit).length, pairs.length)}`);
const out = pairs.filter((p) => p.diff > 3);
const fine = pairs.filter((p) => p.diff <= 3);
console.log(`"check the lines" warning (borders across and down not adding up): on ${out.filter((p) => p.uneven).length} of the ${out.length} readings more than 3 points apart, and ${fine.filter((p) => p.uneven).length} of the other ${fine.length}`);
if (details) for (const p of out.sort((a, b) => b.diff - a.diff)) console.log(`  ${p.id} ${p.axis}: flat ${p.flat.toFixed(1)}, photo ${p.photo.toFixed(1)}${p.uneven ? ' (warned)' : ''}`);
