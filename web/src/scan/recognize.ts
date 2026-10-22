// One look at a card: match its picture against every card in the catalog, and read its text
// when the picture alone can't settle it (reprints share artwork; only the number tells them apart).

import type { Catalog } from '../lib/catalog.ts';
import { identifyCard, matchConfidence, type Candidate, type Confidence, type ScanGuess } from '../lib/match.ts';
import { matchCardPicture, type PictureLook, type PictureMatch, type PictureVerdict, type PrintIndex } from '../lib/pictures.ts';
import type { Corners } from './detect.ts';
import type { Located, Straightened } from './locate.ts';
import { smallCard, toCanvas } from './locate.ts';
import { releaseCanvas, scanCard, type ScanOptions, type ScanResult } from './ocr.ts';
import { cropMargins, rotate180, type Rgba } from './warp.ts';

export interface Reading {
  /** The card as read: straightened when it was found in the picture, else the guide-frame crop */
  image: HTMLCanvasElement;
  /** Closest pictures, when the card was found and straightened and the catalog has pictures */
  pictures: PictureMatch[] | null;
  picture: PictureVerdict | null;
  /** What the text said, unless the picture settled it */
  ocr: ScanResult | null;
  candidates: Candidate[];
  confidence: Confidence | null;
}

const NOTHING_READ: ScanGuess = { names: [], number: null, total: null, setCode: null, artist: null };

const px = (img: Rgba) => ({ data: img.data, width: img.width, height: img.height, channels: 4 as const });

/**
 * What a straightened card's picture matches, trying it both ways up (and, for a card in a
 * sleeve, inside the margins sleeves leave). `upright`: the card as matched, the right way up and
 * cut out of its sleeve, for reading and showing.
 */
export function matchPicture(index: PrintIndex, card: Rgba, sleeves = true): PictureLook & { upright: Rgba } {
  const turned = rotate180(card);
  const look = matchCardPicture(index, px(card), px(turned), sleeves);
  return { ...look, upright: cropMargins(look.flipped ? turned : card, look.margins) };
}

/** Other outlines tried, edge to edge, when the picture in the first one isn't clear… */
const OTHER_OUTLINES = 6;
/** …and the closest few of those again, inside the margins sleeves leave. */
const SLEEVED_OUTLINES = 3;

const closest = (look: PictureLook) => look.matches[0]?.distance ?? Infinity;

/**
 * The card's picture in the outline found — and, when that isn't clear, in the other outlines
 * found, keeping whichever matches closest. A card in a binder page sits among other edges (its
 * pocket's seams, the cards next to it), and the most card-like outline is often its pocket, or
 * reaches across to a neighbour. (Tested on simulated binder pages: cards found went from 13% to
 * 58%; with sleeved and bare cards a little better too, and nothing picked from outlines found
 * in the wrong place.) `corners`: the outline it matched in, in the source's pixels.
 */
export function matchLocated(index: PrintIndex, found: Located): PictureLook & { upright: Rgba; corners: Corners } {
  let best = { ...matchPicture(index, smallCard(found)), corners: found.corners };
  if (best.picture?.clear) return best;
  const tried = found.others.slice(0, OTHER_OUTLINES).map((corners, i) => {
    const card = smallCard(found, found.smallOthers[i]);
    return { card, look: { ...matchPicture(index, card, false), corners } };
  });
  for (const { look } of tried) if (closest(look) < closest(best)) best = look;
  if (best.picture?.clear) return best;
  for (const { card, look } of tried.sort((a, b) => closest(a.look) - closest(b.look)).slice(0, SLEEVED_OUTLINES)) {
    const sleeved = { ...matchPicture(index, card), corners: look.corners };
    if (closest(sleeved) < closest(best)) best = sleeved;
  }
  return best;
}

/** The outline the card is in, of those found: the one its picture matches best (without pictures, the most card-like). */
export function cardOutline(index: PrintIndex | null, found: Located): Corners {
  return index ? matchLocated(index, found).corners : found.corners;
}

/**
 * A reading the picture settles on its own (one clear match, no reprints that look alike).
 * `image`: the straightened card, the right way up.
 */
export function readingFromPicture(catalog: Catalog, pictures: PictureMatch[], picture: PictureVerdict, image: HTMLCanvasElement): Reading {
  // Rank other printings of the same card next, in case it's one of those.
  const sameName = { ...NOTHING_READ, names: [picture.best.card.name] };
  const candidates = identifyCard(catalog, sameName, 12, pictures);
  const confidence = matchConfidence(sameName, candidates, picture);
  // Nothing was read, so say what really matched.
  const best = picture.best.card;
  for (const c of candidates) {
    c.why = c.card.id === best.id ? ['picture'] : c.why.map((w) => (w === 'name' ? (c.card.nameKey === best.nameKey ? 'same name' : 'similar name') : w));
  }
  return { image, pictures, picture, ocr: null, candidates, confidence };
}

export interface ReadOptions extends Pick<ScanOptions, 'signal' | 'onProgress' | 'retry'> {
  catalog: Catalog;
  index: PrintIndex | null;
  /** The straightened card, or (card not found) a canvas of the guide frame */
  card: Straightened | HTMLCanvasElement;
  /** Auto-scan: a quicker read that gives up early when there's no text */
  quick?: boolean;
}

export async function readCard({ catalog, index, card, quick, retry, signal, onProgress }: ReadOptions): Promise<Reading> {
  let image = card instanceof HTMLCanvasElement ? card : card.canvas;
  let pictures: PictureMatch[] | null = null;
  let picture: PictureVerdict | null = null;
  if (index && !(card instanceof HTMLCanvasElement)) {
    const match = matchPicture(index, card.rgba);
    pictures = match.matches;
    picture = match.picture;
    if (match.upright !== card.rgba) {
      // The card was upside down, or in a sleeve: read it the right way up, without the sleeve.
      releaseCanvas(image);
      image = toCanvas(match.upright);
    }
    if (picture?.clear && !picture.twins.length) return readingFromPicture(catalog, pictures, picture, image);
  }
  const ocr = await scanCard(image, { quick, retry, signal, onProgress, fitted: !(card instanceof HTMLCanvasElement) });
  const candidates = identifyCard(catalog, ocr.guess, 12, pictures);
  return { image, pictures, picture, ocr, candidates, confidence: matchConfidence(ocr.guess, candidates, picture) };
}
