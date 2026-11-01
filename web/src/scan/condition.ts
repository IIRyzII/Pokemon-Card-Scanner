// Measuring a card's condition from a photo, for the grade check: how well its picture is centred
// on the card (the widths of its borders, front and back) and, on the back, white wear along its
// edges and round its corners.
//
// PSA compares opposite borders, left with right and top with bottom, and designates centering "at
// the most off-center part of the card": a picture printed at a slight angle has borders that
// change along the side, and the worse end counts. So each border is measured in many places along
// its length, a straight line is fitted through those, and the ratio is read near its ends.
//
// Everything is measured on a straightened copy of the card with a margin of whatever is round it,
// finding both the card's own edge and its border's inner edge in that copy. A border's width is
// the distance between the two, so it doesn't depend on exactly where the card was found.

import type { Corners, Point } from './detect.ts';
import { warpCard, type Rgba } from './warp.ts';

export const CARD_MM = { w: 63, h: 88 } as const;
/** Background kept round the card in the straightened copy: this share of its height each side */
const MARGIN = 0.05;
/** Lengthways, each border is measured in this many places… */
const BANDS = 30;
/** …spread between these shares of the side's length (short of the rounded corners). */
const SPAN = [0.12, 0.88] as const;
/** The ratio is read this far along each side: its worst point, short of the corners. */
export const ENDS = [0.06, 0.94] as const;
/** Borders are looked for up to this wide, mm (the wide side of a card centred about 90/10) */
const MAX_BORDER = 7;
/** A border's usual width, mm: where a side's border couldn't be measured, its line starts here */
export const USUAL_BORDER = 2.8;
/** Opposite borders together are this wide, mm, on a bordered card; outside it, the measurement went wrong */
const PAIR_RANGE = [2.5, 9] as const;
/**
 * The borders across the card and those down it add up to about the same: an off-centre cut moves
 * the picture, not how much border there is. Pairs that differ by more than this (mm) were probably
 * mismeasured somewhere (on simulated photos of real designs, this caught about half of the
 * readings more than 3 points out, and few good ones).
 */
const UNEVEN = 1.2;
/** The weakest change of colour (RGB distance) taken for the card's edge */
const MIN_STEP = 24;
/** A card's corners are rounded to about this radius, mm */
const CORNER_RADIUS = 3;
/** The wear check looks at the outermost part of the card: from this far in from its edge… */
const WEAR_STRIP = [0.15, 0.75] as const;
/** …and round each corner, this far along each edge, mm. */
const CORNER_SIZE = 3.5;
/** Edges blurred more than this (mm, from a quarter to three quarters of the way across) are too soft to judge wear on */
const SOFTEST = 0.35;

export type SideName = 'left' | 'right' | 'top' | 'bottom';
export const SIDES: readonly SideName[] = ['left', 'right', 'top', 'bottom'];
export type CornerName = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';
export const CORNERS: readonly CornerName[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
export type Colour = [number, number, number];

/** A straightened card with a margin round it */
export interface Padded {
  img: Rgba;
  /** The margin, in pixels: the card spans pad … width − pad across and pad … height − pad down */
  pad: number;
  /** Pixels per millimetre */
  scale: number;
}

/** A straightened copy of the card outlined by `corners` in `src`, `height` pixels tall, with a margin round it. */
export function straightenPadded(src: Rgba, corners: Corners, height: number): Padded {
  const h = Math.round(height);
  const pad = Math.round(h * MARGIN);
  return { img: warpCard(src, corners, Math.round((h * CARD_MM.w) / CARD_MM.h), h, pad), pad, scale: h / CARD_MM.h };
}

/**
 * One side's two lines, the card's edge (`outer`) and its border's inner edge (`inner`): each as
 * its distance in from the image's edge, in pixels, at the start and the end of the card's side
 * (top to bottom for the left and right sides, left to right for the top and bottom).
 */
export interface SideLines {
  outer: [number, number];
  inner: [number, number];
}
export type Lines = Record<SideName, SideLines>;

export interface SideQuality {
  /** Share of the places measured along the side that agree with the line through them */
  agreement: number;
  /** How far those places typically stray from the line, mm */
  spread: number;
  /** Places measured that agree */
  places: number;
}

export interface Measured {
  lines: Lines;
  /** How well each side's border was measured; null: it couldn't be, and its lines are a guess to adjust */
  quality: Record<SideName, SideQuality | null>;
  /** Whether the card's own edge was found on each side (the wear check needs it) */
  edges: Record<SideName, boolean>;
  /** The colour of each side's border and of what's round the card there */
  colours: Record<SideName, { border: Colour; background: Colour } | null>;
  /** How soft the card's edges are in the photo, mm (from a quarter to three quarters of the way across), or null */
  softness: number | null;
  /** The borders across and down don't add up alike: a line is probably in the wrong place */
  uneven: boolean;
}

// ---------- reading across a side ----------

/** Where the pixel `s` along a side and `t` in from the image's edge is, as an index into the RGBA data. */
function locator(img: Rgba, side: SideName): (s: number, t: number) => number {
  const { width: W, height: H } = img;
  switch (side) {
    case 'left':
      return (s, t) => (s * W + t) * 4;
    case 'right':
      return (s, t) => (s * W + W - 1 - t) * 4;
    case 'top':
      return (s, t) => (t * W + s) * 4;
    case 'bottom':
      return (s, t) => ((H - 1 - t) * W + s) * 4;
  }
}

/** The pixel `s` along a side and `t` in from the image's edge (both continuous) as a point in the image. */
function pointOn(img: Rgba, side: SideName, s: number, t: number): Point {
  switch (side) {
    case 'left':
      return { x: t, y: s };
    case 'right':
      return { x: img.width - t, y: s };
    case 'top':
      return { x: s, y: t };
    case 'bottom':
      return { x: s, y: img.height - t };
  }
}

const upright = (side: SideName) => side === 'left' || side === 'right';
/** The card's length along a side, in pixels */
const lengthOf = (p: Padded, side: SideName) => (upright(side) ? p.img.height : p.img.width) - 2 * p.pad;

/** The average colour across `s0`…`s1` along a side, at each distance in from the image's edge up to `depth`. */
function profile(img: Rgba, at: (s: number, t: number) => number, s0: number, s1: number, depth: number): Float32Array {
  const d = img.data;
  const out = new Float32Array(depth * 3);
  for (let s = s0; s < s1; s++) {
    for (let t = 0; t < depth; t++) {
      const i = at(s, t);
      out[t * 3] += d[i];
      out[t * 3 + 1] += d[i + 1];
      out[t * 3 + 2] += d[i + 2];
    }
  }
  const n = Math.max(1, s1 - s0);
  for (let k = 0; k < out.length; k++) out[k] /= n;
  return out;
}

/** The average colour of a profile from `from` to `to` (pixels). */
function mean(prof: Float32Array, from: number, to: number): Colour {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(prof.length / 3, Math.max(a + 1, Math.ceil(to)));
  const c: Colour = [0, 0, 0];
  for (let t = a; t < b; t++) for (let k = 0; k < 3; k++) c[k] += prof[t * 3 + k];
  const n = Math.max(1, b - a);
  return [c[0] / n, c[1] / n, c[2] / n];
}

function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const medianColour = (cs: readonly Colour[]): Colour => [median(cs.map((c) => c[0])), median(cs.map((c) => c[1])), median(cs.map((c) => c[2]))];
const gap = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const away = (prof: Float32Array, t: number, c: Colour) => Math.hypot(prof[t * 3] - c[0], prof[t * 3 + 1] - c[1], prof[t * 3 + 2] - c[2]);
export const luma = (c: readonly number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/**
 * Where the profile first passes `level` of the way from colour `a` to colour `b`, between `from`
 * and `to`: a position in pixels (pixel t's middle is at t + 0.5), or null.
 */
function crossing(prof: Float32Array, a: Colour, b: Colour, level: number, from: number, to: number): number | null {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  from = Math.max(0, Math.floor(from));
  to = Math.min(prof.length / 3 - 1, Math.ceil(to));
  if (n < 1 || from >= to) return null;
  const f = (t: number) => ((prof[t * 3] - a[0]) * d[0] + (prof[t * 3 + 1] - a[1]) * d[1] + (prof[t * 3 + 2] - a[2]) * d[2]) / n;
  let prev = f(from);
  for (let t = from; t < to; t++) {
    const next = f(t + 1);
    if (prev < level && next >= level) return t + 0.5 + (level - prev) / (next - prev);
    prev = next;
  }
  return null;
}

/** A sharp change of colour across a side, where the card's edge could be. */
interface Step {
  t: number;
  strength: number;
  /** The colours a little way either side of it */
  outside: Colour;
  inside: Colour;
}

/** Sharp changes of colour in a profile near where the card was found (`pad` in), strongest first. */
function stepsNearEdge(prof: Float32Array, pad: number, scale: number): Step[] {
  const h = Math.max(2, Math.round(0.2 * scale));
  const near = Math.max(h + 1, Math.round(0.3 * scale));
  const far = Math.max(near + 2, Math.round(0.8 * scale));
  const depth = prof.length / 3;
  const lo = Math.max(far + 1, Math.round(0.1 * pad));
  const hi = Math.min(depth - far - 2, Math.round(pad + 1.5 * scale));
  const strength = new Float32Array(depth);
  for (let t = lo - 1; t <= hi + 1; t++) strength[t] = gap(mean(prof, t - h, t), mean(prof, t, t + h));
  const found: Step[] = [];
  for (let t = lo; t <= hi; t++) {
    if (strength[t] < MIN_STEP || strength[t] < strength[t - 1] || strength[t] <= strength[t + 1]) continue;
    found.push({ t, strength: strength[t], outside: mean(prof, t - far, t - near), inside: mean(prof, t + near, t + far) });
  }
  return found.sort((a, b) => b.strength - a.strength);
}

interface Fit {
  /** y = a + b·x */
  a: number;
  b: number;
  /** Points that agree with it */
  inliers: number;
  /** How far those typically stray from it */
  rms: number;
}

function leastSquares(xs: readonly number[], ys: readonly number[], keep: readonly boolean[]): { a: number; b: number } | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    if (!keep[i]) continue;
    n++;
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  if (n < 3) return null;
  const den = n * sxx - sx * sx;
  const b = den > 1e-9 ? (n * sxy - sx * sy) / den : 0;
  return { a: (sy - b * sx) / n, b };
}

/** A straight line through the points, leaving out those that stray from the rest by more than `tolerance` (or 3× the typical stray). */
function fitLine(xs: readonly number[], ys: readonly number[], tolerance: number): Fit | null {
  if (xs.length < 3) return null;
  const m = median(ys);
  const mad = median(ys.map((y) => Math.abs(y - m)));
  let keep = ys.map((y) => Math.abs(y - m) <= Math.max(tolerance, 4.5 * mad));
  let line = leastSquares(xs, ys, keep);
  let rms = 0;
  for (let pass = 0; pass < 3 && line; pass++) {
    const { a, b } = line;
    const off = ys.map((y, i) => y - (a + b * xs[i]));
    const kept = off.filter((_, i) => keep[i]);
    rms = Math.sqrt(kept.reduce((s, v) => s + v * v, 0) / Math.max(1, kept.length));
    keep = off.map((v) => Math.abs(v) <= Math.max(tolerance, 3 * rms));
    line = leastSquares(xs, ys, keep) ?? line;
  }
  if (!line) return null;
  const { a, b } = line;
  const off = ys.map((y, i) => y - (a + b * xs[i])).filter((_, i) => keep[i]);
  rms = Math.sqrt(off.reduce((s, v) => s + v * v, 0) / Math.max(1, off.length));
  return { a, b, inliers: off.length, rms };
}

// ---------- the borders ----------

interface SideMeasure {
  lines: SideLines;
  quality: SideQuality | null;
  edge: boolean;
  colours: { border: Colour; background: Colour } | null;
  /** Edge softness, mm */
  softness: number | null;
}

/**
 * The sharp changes of colour going in from the card's edge at `outer`, as far as a border could
 * reach, nearest first (up to `most`): where the border's inner edge could be. Print inside the
 * border (the copyright line along the bottom of recent cards) makes changes of its own before it.
 */
function stepsInside(prof: Float32Array, outer: number, scale: number, minStep: number, most = 6): number[] {
  const h = Math.max(2, Math.round(0.3 * scale));
  const start = Math.ceil(outer + Math.max(0.3 * scale, 2 * h + 1));
  const end = Math.min(prof.length / 3 - 2 * h - 1, Math.floor(outer + MAX_BORDER * scale));
  const strength = (t: number) => gap(mean(prof, t - h, t), mean(prof, t, t + h));
  const found: number[] = [];
  let prev = strength(start - 1);
  let here = strength(start);
  for (let t = start; t <= end && found.length < most; t++) {
    const next = strength(t + 1);
    if (here >= minStep && here >= prev && here > next) {
      found.push(crossing(prof, mean(prof, t - 2 * h, t - h), mean(prof, t + h, t + 2 * h), 0.5, t - h - 1, t + h) ?? t);
    }
    prev = here;
    here = next;
  }
  return found;
}

/**
 * The border's width (mm) that most places along the side agree on, from each place's candidates:
 * the inner edge runs the whole length of the side, where print inside the border doesn't. Of
 * widths about as well supported, the narrowest (further in is the picture).
 */
function agreedWidth(places: readonly (readonly number[])[]): number | null {
  const all = places.flat();
  const support = (w: number) => places.filter((c) => c.some((m) => Math.abs(m - w) <= 0.3)).length;
  const votes = all.map((w) => ({ w, n: support(w) }));
  const most = Math.max(0, ...votes.map((v) => v.n));
  if (!most) return null;
  return Math.min(...votes.filter((v) => v.n >= 0.85 * most).map((v) => v.w));
}

function measureSide(p: Padded, side: SideName): SideMeasure {
  const { img, pad, scale } = p;
  const at = locator(img, side);
  const length = lengthOf(p, side);
  const across = (upright(side) ? img.width : img.height) - 2 * pad;
  const depth = Math.min(pad + Math.floor(across / 2), Math.ceil(pad + (MAX_BORDER + 1.5) * scale));
  const usual = (outer: SideLines['outer']): SideLines => ({ outer, inner: [outer[0] + USUAL_BORDER * scale, outer[1] + USUAL_BORDER * scale] });
  const failed: SideMeasure = { lines: usual([pad, pad]), quality: null, edge: false, colours: null, softness: null };

  const bands = Array.from({ length: BANDS }, (_, k) => {
    const u0 = SPAN[0] + ((SPAN[1] - SPAN[0]) * k) / BANDS;
    const u1 = SPAN[0] + ((SPAN[1] - SPAN[0]) * (k + 1)) / BANDS;
    const s0 = pad + Math.round(u0 * length);
    const s1 = Math.max(s0 + 1, pad + Math.round(u1 * length));
    const prof = profile(img, at, s0, s1, depth);
    return { u: (u0 + u1) / 2, prof, steps: stepsNearEdge(prof, pad, scale) };
  });

  // The card's edge. First, in each place, the strong change of colour nearest where the card was
  // found (in from there counts against it: that's where the border's own inner edge is)…
  const first = bands.flatMap(({ steps }) => {
    const strongest = steps[0]?.strength ?? 0;
    const pick = steps
      .filter((s) => s.strength >= 0.35 * strongest)
      .map((s) => ({ s, score: s.strength / strongest - (Math.abs(s.t - pad) / scale) * (s.t > pad ? 0.6 : 0.3) }))
      .sort((a, b) => b.score - a.score)[0];
    return pick ? [pick.s] : [];
  });
  if (first.length < BANDS * 0.4) return failed;
  // …then, knowing the colours either side of the edge along this side, the change in each place
  // that goes from the one to the other (not a line in the background, or the border's inner edge).
  const background = medianColour(first.map((s) => s.outside));
  const borderGuess = medianColour(first.map((s) => s.inside));
  if (gap(background, borderGuess) < MIN_STEP) return failed;
  const edges = bands.map(({ u, prof, steps }) => {
    const pick = steps
      .map((s) => ({ s, misfit: gap(s.outside, background) + gap(s.inside, borderGuess) + (Math.abs(s.t - pad) / scale) * 4 }))
      .sort((a, b) => a.misfit - b.misfit)[0];
    if (!pick || pick.misfit > 0.8 * gap(background, borderGuess) + 30) return null;
    const { s } = pick;
    const h = Math.max(2, Math.round(0.2 * scale));
    const mid = crossing(prof, s.outside, s.inside, 0.5, s.t - 2 * h, s.t + 2 * h) ?? s.t;
    const q1 = crossing(prof, s.outside, s.inside, 0.25, s.t - 3 * h, s.t + 2 * h);
    const q3 = crossing(prof, s.outside, s.inside, 0.75, s.t - 2 * h, s.t + 3 * h);
    return { u, prof, at: mid, softness: q1 !== null && q3 !== null && q3 >= q1 ? q3 - q1 : null };
  });
  const found = edges.filter((e) => e !== null);
  const outerFit = fitLine(
    found.map((e) => e.u),
    found.map((e) => e.at),
    Math.max(1, 0.1 * scale),
  );
  if (!outerFit || outerFit.inliers < BANDS * 0.4) return failed;
  const outerAt = (u: number) => outerFit.a + outerFit.b * u;
  const outer: SideLines['outer'] = [outerAt(0), outerAt(1)];
  const onEdge = found.filter((e) => Math.abs(e.at - outerAt(e.u)) <= Math.max(1, 0.1 * scale, 3 * outerFit.rms));
  const soft = onEdge.flatMap((e) => (e.softness === null ? [] : [e.softness]));
  const softness = soft.length ? median(soft) / scale : null;

  // The border's colour, just in from the edge (past where it's blurred or worn), and how much it
  // varies across its width in each place (a silver border also shades along the side).
  const segment = (e: { at: number }) => [e.at + 0.3 * scale, e.at + 0.8 * scale] as const;
  const border = medianColour(onEdge.map((e) => mean(e.prof, ...segment(e))));
  const colours = { border, background };
  const noise = median(
    onEdge.map((e) => {
      const [a, b] = segment(e);
      const here = mean(e.prof, a, b);
      const d: number[] = [];
      for (let t = Math.ceil(a); t < b; t++) d.push(away(e.prof, t, here));
      return d.length ? median(d) : 0;
    }),
  );
  const threshold = Math.max(24, 3 * noise + 8);

  // The border's inner edge: in each place, the change of colour at about the width most places
  // agree on.
  const candidates = onEdge.map((e) => ({ u: e.u, mms: stepsInside(e.prof, e.at, scale, threshold).map((t) => (t - e.at) / scale) }));
  const agreed = agreedWidth(candidates.map((c) => c.mms));
  const widths = candidates.flatMap(({ u, mms }) => {
    if (agreed === null || !mms.length) return [];
    const mm = mms.reduce((a, b) => (Math.abs(b - agreed) < Math.abs(a - agreed) ? b : a));
    return Math.abs(mm - agreed) <= 0.8 ? [{ u, mm }] : [];
  });
  const widthFit = fitLine(
    widths.map((w) => w.u),
    widths.map((w) => w.mm),
    0.12,
  );
  const ok = (mm: number) => mm >= 0.2 && mm <= MAX_BORDER;
  if (!widthFit || widthFit.inliers < BANDS * 0.5 || !ok(widthFit.a) || !ok(widthFit.a + widthFit.b)) {
    return { lines: usual(outer), quality: null, edge: true, colours, softness };
  }
  return {
    lines: { outer, inner: [outer[0] + widthFit.a * scale, outer[1] + (widthFit.a + widthFit.b) * scale] },
    quality: { agreement: widthFit.inliers / BANDS, spread: widthFit.rms, places: widthFit.inliers },
    edge: true,
    colours,
    softness,
  };
}

/** A border's width at `u` along its side (0: its start, 1: its end), in pixels. */
export const widthAt = (l: SideLines, u: number) => (l.inner[0] - l.outer[0]) * (1 - u) + (l.inner[1] - l.outer[1]) * u;

/** Finds the card's edge and its border's inner edge all along each side of a straightened card. */
export function measureBorders(p: Padded): Measured {
  const sides = Object.fromEntries(SIDES.map((s) => [s, measureSide(p, s)])) as Record<SideName, SideMeasure>;
  // Opposite borders together are about as wide on any bordered card: a pair far outside that was
  // mismeasured (the inner edge of one was taken somewhere in the picture).
  for (const [a, b] of [
    ['left', 'right'],
    ['top', 'bottom'],
  ] as const) {
    if (!sides[a].quality || !sides[b].quality) continue;
    const together = ENDS.map((u) => (widthAt(sides[a].lines, u) + widthAt(sides[b].lines, u)) / p.scale);
    if (together.some((mm) => mm < PAIR_RANGE[0] || mm > PAIR_RANGE[1])) sides[a].quality = sides[b].quality = null;
  }
  const soft = SIDES.flatMap((s) => (sides[s].softness === null ? [] : [sides[s].softness!]));
  const together = (a: SideName, b: SideName) =>
    sides[a].quality && sides[b].quality ? (widthAt(sides[a].lines, 0.5) + widthAt(sides[b].lines, 0.5)) / p.scale : null;
  const across = together('left', 'right');
  const down = together('top', 'bottom');
  return {
    lines: Object.fromEntries(SIDES.map((s) => [s, sides[s].lines])) as Lines,
    quality: Object.fromEntries(SIDES.map((s) => [s, sides[s].quality])) as Record<SideName, SideQuality | null>,
    edges: Object.fromEntries(SIDES.map((s) => [s, sides[s].edge])) as Record<SideName, boolean>,
    colours: Object.fromEntries(SIDES.map((s) => [s, sides[s].colours])) as Measured['colours'],
    softness: soft.length ? Math.max(...soft) : null,
    uneven: across !== null && down !== null && Math.abs(across - down) > UNEVEN,
  };
}

/** One side's lines as two points each in the straightened picture: for drawing them. */
export function sideSegments(p: Padded, lines: SideLines, side: SideName): { outer: [Point, Point]; inner: [Point, Point] } {
  const length = lengthOf(p, side);
  const ends = (l: [number, number]): [Point, Point] => [pointOn(p.img, side, p.pad, l[0]), pointOn(p.img, side, p.pad + length, l[1])];
  return { outer: ends(lines.outer), inner: ends(lines.inner) };
}

// ---------- centering ----------

export type Axis = 'leftRight' | 'topBottom';
export const AXIS_SIDES: Record<Axis, readonly [SideName, SideName]> = { leftRight: ['left', 'right'], topBottom: ['top', 'bottom'] };

export interface Centering {
  /** The larger border's share of the pair, %, at the worse end (50: perfectly centred) */
  share: number;
  /** The side whose border is larger there */
  wider: SideName;
  /** Where along the sides that is: 0 at their start (top, or left), 1 at their end */
  at: number;
  /** How far out `share` could be either way, % */
  error: number;
  /** The two borders' widths there, mm */
  widths: [number, number];
}

/** How sure a border's width is, mm: from how well it was measured (a guessed or hand-placed line: to a pixel or so). */
const widthError = (q: SideQuality | null, scale: number) => (q ? Math.hypot(q.spread / Math.sqrt(Math.max(1, q.places)), 0.3 / scale) : 0.75 / scale);

/** How well centred the card is across one axis, at the worse end of its sides; null if a border has no width. */
export function centering(lines: Lines, quality: Record<SideName, SideQuality | null>, scale: number, axis: Axis): Centering | null {
  const [a, b] = AXIS_SIDES[axis];
  let worst: Centering | null = null;
  for (const u of ENDS) {
    const wa = widthAt(lines[a], u) / scale;
    const wb = widthAt(lines[b], u) / scale;
    if (!(wa > 0) || !(wb > 0)) return null;
    const share = (100 * Math.max(wa, wb)) / (wa + wb);
    // About 95% sure: twice the standard error, from each border's error.
    const se = (100 * Math.hypot(wb * widthError(quality[a], scale), wa * widthError(quality[b], scale))) / (wa + wb) ** 2;
    const error = Math.max(1, 2 * se);
    if (!worst || share > worst.share) worst = { share, wider: wa >= wb ? a : b, at: u, error, widths: [wa, wb] };
  }
  return worst;
}

/** "62/38": a share as graders write it. */
export const ratioText = (share: number) => `${Math.round(share)}/${100 - Math.round(share)}`;

// ---------- white wear on the back ----------

export interface Spots {
  /** Separate white spots */
  count: number;
  /** Their total area, mm² */
  area: number;
  /** Their middles in the straightened picture */
  at: Point[];
}

export interface Wear {
  /** White spots along the very edge of each side, and round each corner; null: couldn't tell (glare) */
  edges: Record<SideName, Spots | null>;
  corners: Record<CornerName, Spots | null>;
  /** Why the edges couldn't be judged at all */
  problem: 'background' | 'blurry' | 'edges' | null;
}

/** Whether a pixel is white card stock showing through a border of colour `border`. */
function whiteTest(border: Colour): (r: number, g: number, b: number) => boolean {
  const y = luma(border) + 0.45 * (255 - luma(border));
  const chroma = 0.6 * (Math.max(...border) - Math.min(...border)) + 25;
  return (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b > y && Math.max(r, g, b) - Math.min(r, g, b) < chroma;
}

/** The separate spots in a w×h mask (touching pixels, diagonally too) of at least `min` pixels: their sizes and middles. */
function spotsIn(mask: Uint8Array, w: number, h: number, min: number): { size: number; x: number; y: number }[] {
  const seen = new Uint8Array(w * h);
  const out: { size: number; x: number; y: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0;
    let sx = 0;
    let sy = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      size++;
      sx += x;
      sy += y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (mask[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
    if (size >= min) out.push({ size, x: sx / size, y: sy / size });
  }
  return out;
}

/** Light patches further in than wear reaches, in this share of the pixels or more: glare, so wear can't be told from it. */
const GLARE = 0.015;

/**
 * White wear on a card's back: specks of the white card stock showing through the blue along the
 * very edge of each side and round each corner. A speck is a pixel much lighter and greyer than
 * the side's own border colour; a side with light patches further in too (glare) isn't judged.
 * Needs a background darker than the border, so the card's edge isn't taken for wear.
 */
export function edgeWear(p: Padded, m: Measured): Wear {
  const { img, pad, scale } = p;
  const none: Wear = {
    edges: { left: null, right: null, top: null, bottom: null },
    corners: { topLeft: null, topRight: null, bottomRight: null, bottomLeft: null },
    problem: null,
  };
  if (SIDES.some((s) => !m.edges[s] || !m.colours[s])) return { ...none, problem: 'edges' };
  if (SIDES.some((s) => luma(m.colours[s]!.background) > luma(m.colours[s]!.border) - 25)) return { ...none, problem: 'background' };
  if (m.softness !== null && m.softness > SOFTEST) return { ...none, problem: 'blurry' };
  const d = img.data;
  const minSpot = Math.max(2, Math.round(0.01 * scale * scale));
  const result: Wear = { ...none, edges: { ...none.edges }, corners: { ...none.corners } };

  for (const side of SIDES) {
    const { border } = m.colours[side]!;
    const white = whiteTest(border);
    const at = locator(img, side);
    const length = lengthOf(p, side);
    const lines = m.lines[side];
    const skip = Math.round((CORNER_SIZE / (upright(side) ? CARD_MM.h : CARD_MM.w)) * length);
    const s0 = pad + skip;
    const s1 = pad + length - skip;
    const near = Math.round(WEAR_STRIP[0] * scale);
    const deep = Math.max(near + 1, Math.round(WEAR_STRIP[1] * scale));
    const mask = new Uint8Array((s1 - s0) * deep);
    let glare = 0;
    let looked = 0;
    for (let s = s0; s < s1; s++) {
      const u = (s + 0.5 - pad) / length;
      const outer = lines.outer[0] * (1 - u) + lines.outer[1] * u;
      const inner = lines.inner[0] * (1 - u) + lines.inner[1] * u;
      const t0 = Math.round(outer);
      for (let t = t0 + near; t < t0 + deep; t++) {
        const i = at(s, t);
        if (white(d[i], d[i + 1], d[i + 2])) mask[(s - s0) * deep + (t - t0)] = 1;
      }
      // Further in, but still in the border: light here is glare.
      const end = Math.min(t0 + Math.round(1.6 * scale), Math.round(inner - 0.3 * scale));
      for (let t = t0 + Math.round(1.0 * scale); t < end; t++) {
        const i = at(s, t);
        looked++;
        if (white(d[i], d[i + 1], d[i + 2])) glare++;
      }
    }
    if (looked && glare / looked > GLARE) continue;
    const spots = spotsIn(mask, deep, s1 - s0, minSpot);
    result.edges[side] = {
      count: spots.length,
      area: spots.reduce((sum, s) => sum + s.size, 0) / (scale * scale),
      at: spots.map((s) => pointOn(img, side, s0 + s.y + 0.5, Math.round((lines.outer[0] + lines.outer[1]) / 2) + s.x + 0.5)),
    };
  }

  // Round each corner: the outermost strip of the card, following its rounding.
  const W = img.width;
  const H = img.height;
  const size = Math.round(CORNER_SIZE * scale);
  for (const corner of CORNERS) {
    const left = corner === 'topLeft' || corner === 'bottomLeft';
    const top = corner === 'topLeft' || corner === 'topRight';
    const vertical = m.lines[left ? 'left' : 'right'];
    const horizontal = m.lines[top ? 'top' : 'bottom'];
    // The corner, where the two edges meet; x and y run in from it.
    const cx = left ? vertical.outer[0 + (top ? 0 : 1)] : W - vertical.outer[top ? 0 : 1];
    const cy = top ? horizontal.outer[left ? 0 : 1] : H - horizontal.outer[left ? 0 : 1];
    const dirX = left ? 1 : -1;
    const dirY = top ? 1 : -1;
    const a = m.colours[left ? 'left' : 'right']!.border;
    const b = m.colours[top ? 'top' : 'bottom']!.border;
    const white = whiteTest([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const mask = new Uint8Array(size * size);
    let glare = 0;
    let looked = 0;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = Math.floor(cx + dirX * (i + 0.5));
        const y = Math.floor(cy + dirY * (j + 0.5));
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = (i + 0.5) / scale;
        const dy = (j + 0.5) / scale;
        const inside = dx < CORNER_RADIUS && dy < CORNER_RADIUS ? CORNER_RADIUS - Math.hypot(CORNER_RADIUS - dx, CORNER_RADIUS - dy) : Math.min(dx, dy);
        const k = (y * W + x) * 4;
        if (inside >= WEAR_STRIP[0] && inside <= WEAR_STRIP[1]) {
          if (white(d[k], d[k + 1], d[k + 2])) mask[j * size + i] = 1;
        } else if (inside >= 1.0 && inside <= 1.6) {
          looked++;
          if (white(d[k], d[k + 1], d[k + 2])) glare++;
        }
      }
    }
    if (looked && glare / looked > GLARE) continue;
    const spots = spotsIn(mask, size, size, minSpot);
    result.corners[corner] = {
      count: spots.length,
      area: spots.reduce((sum, s) => sum + s.size, 0) / (scale * scale),
      at: spots.map((s) => ({ x: cx + dirX * (s.x + 0.5), y: cy + dirY * (s.y + 0.5) })),
    };
  }
  return result;
}

/** A rough reading of white spots, our own rule of thumb (not a grader's): none, a few small specks, or wear. */
export function wearLevel(s: Spots): 'clean' | 'specks' | 'worn' {
  if (!s.count) return 'clean';
  return s.count <= 3 && s.area < 0.3 ? 'specks' : 'worn';
}

