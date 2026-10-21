// On-device card reading with Tesseract (OCR runs in the browser; photos never leave the phone).
// Only two small parts of the card are read: the name line at the top and the corner with the
// card number at the bottom. The moves in between are never read.

import { createWorker, OEM, PSM, type OutputFormats, type Page, type Worker } from 'tesseract.js';
import type { ScanGuess } from '../lib/match.ts';
import { buildGuess, parseHp } from './parse.ts';

export const CARD_RATIO = 63 / 88; // width / height of a standard card

let workerPromise: Promise<Worker> | null = null;
let progressListener: ((progress: number, status: string) => void) | null = null;

/** Starts loading the OCR engine (~a few MB, cached after the first time). */
export function warmUpOcr(): Promise<Worker> {
  workerPromise ??= createWorker('eng', OEM.LSTM_ONLY, {
    logger: (m) => progressListener?.(m.progress, m.status),
    // Failures reach us through the rejected promises; without this Tesseract also throws each one
    // again as an uncaught error (e.g. when its download fails offline).
    errorHandler: () => undefined,
  }).catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

export interface ScanResult {
  guess: ScanGuess;
  topText: string;
  bottomText: string;
}

export interface ScanOptions {
  onProgress?: (label: string) => void;
  /** Stops between reading steps once aborted (the step already running finishes first). */
  signal?: AbortSignal;
  /** For auto-scan: stop after the name strip when it has no real words or HP (no card in view). */
  quick?: boolean;
  /**
   * The image is exactly the card, edge to edge (found in the picture and straightened), so the
   * name and number are right where they're printed. Otherwise (just the guide frame) the
   * number areas are taller, as the card may sit a little off.
   */
  fitted?: boolean;
  /**
   * Auto-scan read this card a moment ago without finding out which printing it is: if the
   * number doesn't read again, also try a second view of its corners.
   */
  retry?: boolean;
}

/** Part of the card: [left, top, width, height] as fractions of its size. */
type Box = readonly [number, number, number, number];

// Measured on cards from every era, Base Set to Mega Evolution:
/** The name line, with the HP at its right. */
const NAME: Box = [0.02, 0.012, 0.96, 0.11];
/** The card number and set code: bottom-left on cards since Sun & Moon (2017)… */
const NUMBER_LEFT: Box = [0, 0.9, 0.5, 0.095];
/** …and bottom-right before that. */
const NUMBER_RIGHT: Box = [0.5, 0.9, 0.5, 0.095];
/** The same corners, taller: the second view, which some small print only reads in. */
const NUMBER_LEFT_TALL: Box = [0, 0.84, 0.5, 0.16];
const NUMBER_RIGHT_TALL: Box = [0.5, 0.84, 0.5, 0.16];
/** Taller, for when the card might sit a little off (only the guide frame was cut out). */
const loose = ([x, y, w, h]: Box): Box => [x, Math.max(0, y - 0.08), w, Math.min(1, y + h) - Math.max(0, y - 0.08)];

/** Copies part of the card into a new canvas, scaled and contrast-boosted. */
function strip(card: HTMLCanvasElement, [x, y, w, h]: Box, targetWidth: number): HTMLCanvasElement {
  const sx = Math.round(card.width * x);
  const sy = Math.round(card.height * y);
  const sw = Math.max(1, Math.round(card.width * w));
  const sh = Math.max(1, Math.round(card.height * h));
  const scale = Math.min(3, targetWidth / sw);
  const out = document.createElement('canvas');
  out.width = Math.round(sw * scale);
  out.height = Math.round(sh * scale);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(card, sx, sy, sw, sh, 0, 0, out.width, out.height);
  enhance(ctx, out.width, out.height);
  return out;
}

/** Greyscale + contrast stretch between the 2nd and 98th brightness percentiles. */
function enhance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gray = new Uint8ClampedArray(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    gray[p] = g;
    hist[g]++;
  }
  const cut = gray.length * 0.02;
  let lo = 0;
  let hi = 255;
  for (let v = 0, acc = 0; v < 256; v++) if ((acc += hist[v]) >= cut) { lo = v; break; }
  for (let v = 255, acc = 0; v >= 0; v--) if ((acc += hist[v]) >= cut) { hi = v; break; }
  const range = Math.max(1, hi - lo);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = ((gray[p] - lo) * 255) / range;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Whether OCR found a real word (3+ letters, read with confidence) rather than guessing at
 * texture. In testing, card names read at 79–95 and a noisy tabletop at under 50.
 */
function hasRealWord(page: Page): boolean {
  return !!page.blocks?.some((b) =>
    b.paragraphs.some((p) => p.lines.some((l) => l.words.some((w) => w.confidence >= 60 && /[A-Za-zÀ-ÿ]{3}/.test(w.text)))),
  );
}

/** Frees a canvas's pixels now rather than at garbage collection (iPhone Safari caps the total). */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

// (Not signal.throwIfAborted(): that needs iOS 15.4.)
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
}

/** OCRs one strip of the card, then frees it. */
async function readStrip(worker: Worker, image: HTMLCanvasElement, output?: Partial<OutputFormats>) {
  try {
    return await worker.recognize(image, {}, output);
  } finally {
    releaseCanvas(image);
  }
}

// Every read changes the engine's settings, so reads take turns (auto-scan vs the shutter).
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

export function scanCard(card: HTMLCanvasElement, options: ScanOptions = {}): Promise<ScanResult> {
  return exclusive(async () => {
    checkAbort(options.signal);
    progressListener = (p, status) => {
      if (status.startsWith('loading') || status.startsWith('initializ')) options.onProgress?.(`Loading reader… ${Math.round(p * 100)}%`);
    };
    try {
      return await readCard(await warmUpOcr(), card, options);
    } finally {
      progressListener = null;
    }
  });
}

async function readCard(worker: Worker, card: HTMLCanvasElement, { onProgress, signal, quick, fitted, retry }: ScanOptions): Promise<ScanResult> {
  const step = (label: string) => {
    checkAbort(signal);
    onProgress?.(label);
  };
  step('Reading the name…');
  // A local black/white threshold (Sauvola): the default one cuts the whole strip at a single
  // brightness, which turns a name banner or the number's coloured border black along with its
  // text whenever bright artwork shares the strip. This reads the number on twice as many cards.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, thresholding_method: '2' });
  const top = await readStrip(worker, strip(card, NAME, 1500), { text: true, blocks: !!quick });
  const topText = top.data.text;
  if (quick && !hasRealWord(top.data) && !parseHp(topText)) {
    // Only texture where the name should be: most likely no card in the frame yet.
    return { guess: buildGuess('', ''), topText, bottomText: '' };
  }

  step('Reading the card number…');
  let bottomText = '';
  let guess = buildGuess(topText, '');
  const read = async (box: Box) => {
    checkAbort(signal);
    const r = await readStrip(worker, strip(card, box, 1100));
    bottomText += `${r.data.text}\n`;
    guess = buildGuess(topText, bottomText);
  };
  // Newer cards first (bottom-left); the bottom-right corner only if the number wasn't there.
  // (Read as one block: sparse-text mode skips the number when it sits between the set symbol
  // and the boxed regulation mark.) Very small print, from a card far from the camera, can come
  // out better with the single threshold, so the corners get a second go with that.
  for (const threshold of ['2', '0']) {
    await worker.setParameters({ thresholding_method: threshold });
    for (const box of [NUMBER_LEFT, NUMBER_RIGHT]) {
      await read(fitted ? box : loose(box));
      if (guess.number) break;
    }
    if (guess.number || guess.alternatives?.length) break;
  }
  if (retry && fitted && !guess.number && !guess.alternatives?.length) {
    // No luck a moment ago either: this time also try the corners taller, as sparse text.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, thresholding_method: '0' });
    for (const box of [NUMBER_LEFT_TALL, NUMBER_RIGHT_TALL]) {
      await read(box);
      if (guess.number || guess.alternatives?.length) break;
    }
  }
  return { guess, topText, bottomText };
}

export interface Crop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Where the on-screen guide frame sits in the camera's own pixels. */
export function frameCrop(video: HTMLVideoElement, frame: HTMLElement): Crop {
  const vr = video.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(vr.width / vw, vr.height / vh); // object-fit: cover
  const offX = (vr.width - vw * scale) / 2;
  const offY = (vr.height - vh * scale) / 2;
  const sx = Math.max(0, (fr.left - vr.left - offX) / scale);
  const sy = Math.max(0, (fr.top - vr.top - offY) / scale);
  return { sx, sy, sw: Math.min(vw - sx, fr.width / scale), sh: Math.min(vh - sy, fr.height / scale) };
}

/** Crops the on-screen guide frame out of the live camera video. */
export function captureFrame(video: HTMLVideoElement, frame: HTMLElement): HTMLCanvasElement {
  const { sx, sy, sw, sh } = frameCrop(video, frame);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  canvas.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Loads a photo into a canvas, no more than 2000px on its longer side. */
export async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** The middle of a photo, cut to card proportions: for when the card itself can't be found in it. */
export function centerCrop(photo: HTMLCanvasElement): HTMLCanvasElement {
  let w = photo.width;
  let h = photo.height;
  let sx = 0;
  let sy = 0;
  if (w / h > CARD_RATIO) {
    sx = (w - h * CARD_RATIO) / 2;
    w = h * CARD_RATIO;
  } else {
    sy = (h - w / CARD_RATIO) / 2;
    h = w / CARD_RATIO;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  canvas.getContext('2d')!.drawImage(photo, sx, sy, w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}
