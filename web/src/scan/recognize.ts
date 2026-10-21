// One look at a card: match its picture against every card in the catalog, and read its text
// when the picture alone can't settle it (reprints share artwork; only the number tells them apart).

import type { Catalog } from '../lib/catalog.ts';
import { identifyCard, matchConfidence, type Candidate, type Confidence, type ScanGuess } from '../lib/match.ts';
import { matchCardPicture, type PictureLook, type PictureMatch, type PictureVerdict, type PrintIndex } from '../lib/pictures.ts';
import type { Straightened } from './locate.ts';
import { toCanvas } from './locate.ts';
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
export function matchPicture(index: PrintIndex, card: Rgba): PictureLook & { upright: Rgba } {
  const turned = rotate180(card);
  const look = matchCardPicture(index, px(card), px(turned));
  return { ...look, upright: cropMargins(look.flipped ? turned : card, look.margins) };
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
