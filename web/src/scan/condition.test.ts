import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARD_MM, centering, edgeWear, ENDS, measureBorders, straightenPadded, wearLevel, type Colour, type Measured, type Padded, type SideName } from './condition.ts';
import { detectCard, shrink, type Corners } from './detect.ts';
import { homography, type Rgba } from './warp.ts';

/** A card face: its border's widths (mm) at the start and end of each side (they differ when the print is tilted), and what's inside. */
interface Face {
  left: [number, number];
  right: [number, number];
  top: [number, number];
  bottom: [number, number];
  border: Colour;
  inside: (x: number, y: number) => Colour;
  /** White specks of wear, at (x, y) mm */
  specks?: { x: number; y: number }[];
  /** A line of small print inside the bottom border, as recent cards have their copyright line */
  print?: boolean;
}

const W = 640;
const H = 860;
const DARK: Colour = [38, 34, 30];
const held: Corners = [
  { x: 112, y: 70 },
  { x: 548, y: 92 },
  { x: 532, y: 786 },
  { x: 96, y: 768 },
];

/** A frame (the type colour) round smoothly varying artwork, like a card's design. */
const art =
  (frame: Colour) =>
  (x: number, y: number, f: Face): Colour => {
    const inset = (side: [number, number], at: number) => side[0] + (side[1] - side[0]) * at;
    const dx = Math.min(x - inset(f.left, y / CARD_MM.h), CARD_MM.w - inset(f.right, y / CARD_MM.h) - x);
    const dy = Math.min(y - inset(f.top, x / CARD_MM.w), CARD_MM.h - inset(f.bottom, x / CARD_MM.w) - y);
    if (Math.min(dx, dy) < 1.4) return frame;
    return [130 + 70 * Math.sin(x / 3.1), 110 + 60 * Math.cos(y / 4.3), 120 + 50 * Math.sin((x + y) / 5.7)];
  };

function face(widths: Pick<Face, 'left' | 'right' | 'top' | 'bottom'>, border: Colour, frame: Colour, specks?: Face['specks']): Face {
  const f: Face = { ...widths, border, specks, inside: () => frame };
  const draw = art(frame);
  f.inside = (x, y) => draw(x, y, f);
  return f;
}

/** The back: a blue border round a darker, swirling blue. */
function back(widths: Pick<Face, 'left' | 'right' | 'top' | 'bottom'>, specks?: Face['specks']): Face {
  return {
    ...widths,
    border: [48, 88, 172],
    inside: (x, y) => [24 + 14 * Math.sin(x / 2.3 + y / 3.7), 50 + 22 * Math.sin(y / 2.9 - x / 4.1), 118 + 30 * Math.cos((x * y) / 40)],
    specks,
  };
}

function colourAt(f: Face, x: number, y: number, bg: Colour): Colour {
  if (x < 0 || y < 0 || x > CARD_MM.w || y > CARD_MM.h) return bg;
  const r = 3; // rounded corners
  const cx = Math.min(Math.max(x, r), CARD_MM.w - r);
  const cy = Math.min(Math.max(y, r), CARD_MM.h - r);
  if (Math.hypot(x - cx, y - cy) > r) return bg;
  if (f.specks?.some((s) => Math.hypot(x - s.x, y - s.y) < 0.2)) return [226, 229, 234];
  if (f.print && y > CARD_MM.h - 1.6 && y < CARD_MM.h - 0.9 && x > 14 && x < 49 && Math.floor(x / 0.45) % 3) return [52, 44, 30];
  const along = (side: [number, number], at: number) => side[0] + (side[1] - side[0]) * at;
  const inBorder =
    x < along(f.left, y / CARD_MM.h) ||
    x > CARD_MM.w - along(f.right, y / CARD_MM.h) ||
    y < along(f.top, x / CARD_MM.w) ||
    y > CARD_MM.h - along(f.bottom, x / CARD_MM.w);
  return inBorder ? f.border : f.inside(x, y);
}

/** A photo of the card held at `corners` (2×2 samples a pixel, then noise and a little blur). */
function photo(f: Face, corners: Corners = held, opts: { bg?: Colour; glare?: { x: number; y: number; r: number }; seed?: number } = {}): Rgba {
  const bg = opts.bg ?? DARK;
  const toCard = homography(corners, [
    { x: 0, y: 0 },
    { x: CARD_MM.w, y: 0 },
    { x: CARD_MM.w, y: CARD_MM.h },
    { x: 0, y: CARD_MM.h },
  ]);
  let seed = opts.seed ?? 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 10;
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
        let c = colourAt(f, u, v, bg);
        if (opts.glare && Math.hypot(u - opts.glare.x, v - opts.glare.y) < opts.glare.r) c = [235, 238, 242];
        for (let k = 0; k < 3; k++) raw[(y * W + x) * 3 + k] += c[k] / 4;
      }
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = noise();
      for (let k = 0; k < 3; k++) {
        let s = 0;
        let wsum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(W - 1, Math.max(0, x + dx));
            const yy = Math.min(H - 1, Math.max(0, y + dy));
            const w = (dx ? 1 : 2) * (dy ? 1 : 2);
            s += raw[(yy * W + xx) * 3 + k] * w;
            wsum += w;
          }
        }
        out[(y * W + x) * 4 + k] = s / wsum + n;
      }
      out[(y * W + x) * 4 + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

/** Finds the card as the app does (on a small copy), and straightens it with its margin. */
function straighten(img: Rgba): Padded {
  const k = 400 / img.height;
  const found = detectCard(shrink(img, k));
  assert.ok(found, 'card not found');
  const corners = found.corners.map((p) => ({ x: p.x / k, y: p.y / k })) as Corners;
  const seen = (Math.hypot(corners[0].x - corners[3].x, corners[0].y - corners[3].y) + Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y)) / 2;
  return straightenPadded(img, corners, Math.min(1600, Math.max(700, seen)));
}

/** The true centering of a face at the worse end of an axis: the larger border's share, %. */
function truth(f: Face, a: SideName, b: SideName): number {
  return Math.max(
    ...ENDS.map((u) => {
      const wa = f[a][0] + (f[a][1] - f[a][0]) * u;
      const wb = f[b][0] + (f[b][1] - f[b][0]) * u;
      return (100 * Math.max(wa, wb)) / (wa + wb);
    }),
  );
}

function check(f: Face, m: Measured, p: Padded, label: string) {
  assert.equal(m.uneven, false, `${label}: borders across and down taken as not adding up`);
  for (const [axis, a, b] of [
    ['leftRight', 'left', 'right'],
    ['topBottom', 'top', 'bottom'],
  ] as const) {
    assert.ok(m.quality[a] && m.quality[b], `${label}: ${a}/${b} not measured`);
    const c = centering(m.lines, m.quality, p.scale, axis);
    assert.ok(c, `${label}: no ${axis} centering`);
    const want = truth(f, a, b);
    assert.ok(Math.abs(c.share - want) <= 1.5, `${label} ${axis}: measured ${c.share.toFixed(1)}, truly ${want.toFixed(1)}`);
    assert.ok(c.error >= 1 && c.error < 4, `${label} ${axis}: error ±${c.error.toFixed(1)}`);
  }
}

const YELLOW: Colour = [236, 198, 52];
const GREEN: Colour = [86, 150, 74];

test('measures a well-centred card held at an angle', () => {
  const f = face({ left: [2.8, 2.8], right: [2.8, 2.8], top: [2.9, 2.9], bottom: [2.9, 2.9] }, YELLOW, GREEN);
  const p = straighten(photo(f));
  check(f, measureBorders(p), p, 'centred');
});

test('measures an off-centre card (60/40 across, 45/55 down)', () => {
  const f = face({ left: [3.36, 3.36], right: [2.24, 2.24], top: [2.61, 2.61], bottom: [3.19, 3.19] }, YELLOW, GREEN);
  const p = straighten(photo(f));
  const m = measureBorders(p);
  check(f, m, p, 'off-centre');
  assert.equal(centering(m.lines, m.quality, p.scale, 'leftRight')?.wider, 'left');
  assert.equal(centering(m.lines, m.quality, p.scale, 'topBottom')?.wider, 'bottom');
});

test('reads a tilted print at its worst point, not its middle', () => {
  // Left border 2.2 mm at the top to 3.4 mm at the bottom; the right the other way round: 50/50 in
  // the middle, about 60/40 at the ends.
  const f = face({ left: [2.2, 3.4], right: [3.4, 2.2], top: [2.8, 2.8], bottom: [2.8, 2.8] }, YELLOW, GREEN);
  const p = straighten(photo(f));
  const m = measureBorders(p);
  check(f, m, p, 'tilted');
  const c = centering(m.lines, m.quality, p.scale, 'leftRight')!;
  assert.ok(c.share > 57, `worst point read as ${c.share.toFixed(1)}`);
});

test("says when the borders across and down don't add up alike (a line in the wrong place)", () => {
  // A frame the same colour as the border along the bottom: its inner edge is found much further in.
  const f = face({ left: [2.8, 2.8], right: [2.8, 2.8], top: [2.8, 2.8], bottom: [2.8, 2.8] }, YELLOW, GREEN);
  const draw = f.inside;
  f.inside = (x, y) => (y > CARD_MM.h - 6 ? YELLOW : draw(x, y));
  const m = measureBorders(straighten(photo(f)));
  assert.equal(m.uneven, true);
});

test('measures past print inside the border (the copyright line along the bottom)', () => {
  const f = { ...face({ left: [2.8, 2.8], right: [2.8, 2.8], top: [2.4, 2.4], bottom: [2.6, 2.6] }, YELLOW, [40, 150, 210]), print: true };
  const p = straighten(photo(f));
  check(f, measureBorders(p), p, 'print in the border');
});

test('measures a silver-bordered card on a light table', () => {
  const f = face({ left: [2.5, 2.5], right: [3.1, 3.1], top: [2.8, 2.8], bottom: [2.8, 2.8] }, [196, 198, 204], [64, 110, 196]);
  const p = straighten(photo(f, held, { bg: [120, 96, 70] }));
  check(f, measureBorders(p), p, 'silver');
});

const BACK = { left: [2.9, 2.9], right: [2.6, 2.6], top: [2.7, 2.7], bottom: [3.0, 3.0] } satisfies Pick<Face, 'left' | 'right' | 'top' | 'bottom'>;

test("measures the back's blue border", () => {
  const f = back(BACK);
  const p = straighten(photo(f));
  check(f, measureBorders(p), p, 'back');
});

test('finds no wear on a clean back', () => {
  const p = straighten(photo(back(BACK)));
  const wear = edgeWear(p, measureBorders(p));
  assert.equal(wear.problem, null);
  for (const [where, spots] of [...Object.entries(wear.edges), ...Object.entries(wear.corners)]) {
    assert.ok(spots, `${where} not judged`);
    assert.equal(spots.count, 0, `${where}: ${spots.count} spots on a clean card`);
  }
});

test('finds white specks along an edge and at a corner', () => {
  const specks = [
    { x: 20, y: 0.35 },
    { x: 41, y: 0.4 },
    { x: CARD_MM.w - 0.35, y: 50 },
    { x: 1.3, y: CARD_MM.h - 1.3 }, // on the bottom-left corner's rounding
  ];
  const p = straighten(photo(back(BACK, specks)));
  const wear = edgeWear(p, measureBorders(p));
  assert.equal(wear.problem, null);
  assert.equal(wear.edges.top?.count, 2);
  assert.equal(wear.edges.right?.count, 1);
  assert.equal(wear.edges.left?.count, 0);
  assert.equal(wear.edges.bottom?.count, 0);
  assert.equal(wear.corners.bottomLeft?.count, 1);
  assert.equal(wear.corners.topLeft?.count, 0);
  assert.equal(wearLevel(wear.edges.top!), 'specks');
  assert.equal(wearLevel(wear.edges.left!), 'clean');
});

test("doesn't judge wear where there's glare, or on a light background", () => {
  const glared = straighten(photo(back(BACK), held, { glare: { x: 30, y: 2, r: 2.2 } }));
  const wear = edgeWear(glared, measureBorders(glared));
  assert.equal(wear.edges.top, null, 'glare on the top edge was judged');
  assert.ok(wear.edges.bottom, 'the bottom edge, without glare, should be judged');

  const light = straighten(photo(back(BACK), held, { bg: [225, 222, 215] }));
  assert.equal(edgeWear(light, measureBorders(light)).problem, 'background');
});

test("a card with no border to find isn't given a centering", () => {
  // Full art to the edge: whatever is found as a border's inner edge, the pair check or the fit fails.
  const f: Face = { left: [0, 0], right: [0, 0], top: [0, 0], bottom: [0, 0], border: YELLOW, inside: (x, y) => [130 + 70 * Math.sin(x / 3.1), 110 + 60 * Math.cos(y / 4.3), 120] };
  const p = straighten(photo(f));
  const m = measureBorders(p);
  const measured = (['left', 'right', 'top', 'bottom'] as const).filter((s) => m.quality[s]);
  assert.ok(measured.length < 4, `all four borders "measured" on a borderless card: ${JSON.stringify(m.lines)}`);
});
