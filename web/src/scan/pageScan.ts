// A photo of a whole binder page, checked against the binder: each pocket's card is found in its
// part of the photo and its picture compared with the card that goes in that pocket. Knowing what
// should be there makes it much surer than recognising nine cards from scratch, and it says which
// printing it is (a reverse holo and a regular one look alike): the pocket's.

import { cardPrintInside, NO_MARGINS, PRINT_WORDS, hamming, type Margins } from '../../../shared/cardprint.ts';
import type { CatalogCard } from '../lib/catalog.ts';
import { CLEAR, SLEEVE_MARGINS, STEADY_CLOSE, TWIN, nearestEitherWay, pictureVerdict, type PictureMatch, type PrintIndex } from '../lib/pictures.ts';
import { CARD_ASPECT, detectCard, shrink, type Corners, type Image } from './detect.ts';
import { rotate180, warpCard, type Rgba } from './warp.ts';

export type PocketOutcome = 'match' | 'other' | 'unsure';

export interface PocketCheck {
  /** 'match': the card that goes there is in it; 'other': a different card is; 'unsure': can't tell (empty, glare, no picture to compare) */
  outcome: PocketOutcome;
  /** For 'other': the card it looks like */
  seen: CatalogCard | null;
  /** How far its picture is from the card that goes there (bits; Infinity when that card has no picture) */
  distance: number;
  /** Where its card was found, in the photo's pixels */
  corners: Corners;
}

/** Each pocket's part of the photo, and this much of its neighbours' each side (the page is rarely lined up exactly). */
const PAD = 0.2;
/** A pocket's part of the photo is looked at this many pixels tall. */
const SEARCH_HEIGHT = 360;
/** The card that goes there, this close… */
export const MATCH_CLOSE = STEADY_CLOSE;
/** …and this much closer than any other card: it's there. */
export const MATCH_GAP = Math.round(CLEAR / 2);
/** Edge to edge this close, it's plainly the card: sleeves aren't tried… */
const PLAINLY = Math.round(MATCH_CLOSE * 0.6);
/** …else they are, in the outlines that came closest. */
const SLEEVED_OUTLINES = 3;
/** A pocket without its card: the most card-like outlines looked at for which card it has */
const OTHER_LOOKS = 3;

const positions = new WeakMap<PrintIndex, Map<string, number>>();

/** Bits between a picture's fingerprint and a card's (Infinity: the catalog has no picture of it). */
export function distanceTo(index: PrintIndex, print: Uint32Array, card: CatalogCard): number {
  let at = positions.get(index);
  if (!at) {
    at = new Map(index.cards.map((c, i) => [c.id, i]));
    positions.set(index, at);
  }
  const i = at.get(card.id);
  if (i === undefined) return Infinity;
  const o = i * PRINT_WORDS;
  if (index.words[o] === 0 && index.words[o + 1] === 0 && index.words[o + 2] === 0) return Infinity;
  return hamming(print, index.words, o);
}

/** What a pocket's picture is, given the card that goes there and the cards it looks most like. */
export function pocketVerdict(expected: CatalogCard, distance: number, matches: PictureMatch[]): { outcome: PocketOutcome; seen: CatalogCard | null } {
  // Reprints with the same picture can't be told apart, and don't count against it
  const twin = (m: PictureMatch) => m.card.nameKey === expected.nameKey && Math.abs(m.distance - distance) <= TWIN;
  const rival = matches.find((m) => m.card.id !== expected.id && !twin(m));
  if (distance <= MATCH_CLOSE && (!rival || rival.distance - distance >= MATCH_GAP)) return { outcome: 'match', seen: null };
  const v = pictureVerdict(matches);
  if (v?.clear && v.best.card.id !== expected.id && !twin(v.best) && v.best.distance < distance) return { outcome: 'other', seen: v.best.card };
  return { outcome: 'unsure', seen: null };
}

/**
 * Checks a photo of a page of `cols`×`rows` pockets (lined up with the on-screen guide, roughly)
 * against the cards that go in them, in reading order (null: a pocket past the binder's end).
 */
export function checkPage(index: PrintIndex, photo: Image, cols: number, rows: number, expected: readonly (CatalogCard | null)[]): (PocketCheck | null)[] {
  const cw = photo.width / cols;
  const ch = photo.height / rows;
  return expected.map((card, i) => (card ? checkPocket(index, photo, cw, ch, i % cols, Math.floor(i / cols), card) : null));
}

function checkPocket(index: PrintIndex, photo: Image, cw: number, ch: number, col: number, row: number, expected: CatalogCard): PocketCheck {
  // The pocket and a little round it, small
  const x0 = Math.max(0, Math.floor((col - PAD) * cw));
  const y0 = Math.max(0, Math.floor((row - PAD) * ch));
  const x1 = Math.min(photo.width, Math.ceil((col + 1 + PAD) * cw));
  const y1 = Math.min(photo.height, Math.ceil((row + 1 + PAD) * ch));
  const scale = Math.min(1, SEARCH_HEIGHT / (y1 - y0));
  const small = shrink(crop(photo, x0, y0, x1 - x0, y1 - y0), scale) as Rgba;
  const cell = { x: (col * cw - x0) * scale, y: (row * ch - y0) * scale, w: cw * scale, h: ch * scale };

  // Outlines its card could be in: those found inside the pocket, and the pocket itself (for a
  // card whose edges don't show against the page), card-shaped.
  const found = detectCard(small, 8);
  const inPocket = (c: Corners) => {
    const m = centreOf(c);
    const h = heightOf(c);
    return m.x >= cell.x && m.x <= cell.x + cell.w && m.y >= cell.y && m.y <= cell.y + cell.h && h >= 0.55 * cell.h && h <= 1.2 * cell.h;
  };
  const outlines = (found ? [found.corners, ...found.others] : []).filter(inPocket);
  const fit = Math.min(cell.h * 0.96, (cell.w * 0.96) / CARD_ASPECT);
  outlines.push(box(cell.x + (cell.w - fit * CARD_ASPECT) / 2, cell.y + (cell.h - fit) / 2, fit * CARD_ASPECT, fit));

  // The outline, margins (a card edge to edge in its pocket, or in a sleeve inside it) and way up
  // that look most like the card that goes there: edge to edge first, then (unless that's
  // plainly it) inside a sleeve, in the closest few outlines.
  let best = { distance: Infinity, upright: null as Uint32Array | null, turned: null as Uint32Array | null, corners: outlines[0] };
  const tried: { corners: Corners; card: Rgba; turned: Rgba; distance: number }[] = [];
  const look = (corners: Corners, card: Rgba, turned: Rgba, margins: Margins) => {
    const prints = [cardPrintInside(px(card), margins), cardPrintInside(px(turned), margins)];
    let closest = Infinity;
    for (const [k, print] of prints.entries()) {
      const distance = distanceTo(index, print, expected);
      closest = Math.min(closest, distance);
      if (distance < best.distance || !best.upright) best = { distance, upright: print, turned: prints[1 - k], corners };
    }
    return closest;
  };
  for (const corners of outlines) {
    const h = Math.max(48, Math.round(heightOf(corners)));
    const card = warpCard(small, corners, Math.round(h * CARD_ASPECT), h);
    const turned = rotate180(card);
    tried.push({ corners, card, turned, distance: look(corners, card, turned, NO_MARGINS) });
  }
  if (best.distance > PLAINLY) {
    for (const t of [...tried].sort((a, b) => a.distance - b.distance).slice(0, SLEEVED_OUTLINES)) {
      for (const margins of SLEEVE_MARGINS) look(t.corners, t.card, t.turned, margins);
    }
  }
  const toPhoto = (c: Corners) => c.map((p) => ({ x: x0 + p.x / scale, y: y0 + p.y / scale })) as Corners;
  const { matches } = nearestEitherWay(index, best.upright!, best.turned!, 12);
  const verdict = pocketVerdict(expected, best.distance, matches);
  if (verdict.outcome === 'match') return { ...verdict, distance: best.distance, corners: toPhoto(best.corners) };
  // Not the card that goes there: what is it? Its picture as found (the outline and margins that
  // best fit the card that should be there twist a different one), in the most card-like outlines.
  let seen = matches;
  let at = best.corners;
  for (const t of tried.slice(0, OTHER_LOOKS)) {
    const look = nearestEitherWay(index, cardPrintInside(px(t.card), NO_MARGINS), cardPrintInside(px(t.turned), NO_MARGINS), 12).matches;
    if ((look[0]?.distance ?? Infinity) < (seen[0]?.distance ?? Infinity)) {
      seen = look;
      at = t.corners;
    }
  }
  const other = pocketVerdict(expected, best.distance, seen);
  return { ...(other.outcome === 'other' ? other : verdict), distance: best.distance, corners: toPhoto(other.outcome === 'other' ? at : best.corners) };
}

function crop(img: Image, x: number, y: number, w: number, h: number): Image {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * img.width + x) * 4;
    for (let i = 0; i < w * 4; i++) data[row * w * 4 + i] = img.data[from + i];
  }
  return { data, width: w, height: h };
}

const px = (img: Rgba) => ({ data: img.data, width: img.width, height: img.height, channels: 4 as const });
const heightOf = (c: Corners) => (Math.hypot(c[0].x - c[3].x, c[0].y - c[3].y) + Math.hypot(c[1].x - c[2].x, c[1].y - c[2].y)) / 2;
const centreOf = (c: Corners) => ({ x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4, y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4 });
const box = (x: number, y: number, w: number, h: number): Corners => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
