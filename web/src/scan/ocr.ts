// On-device card reading with Tesseract (OCR runs in the browser; photos never leave the phone).
// We read two strips of the card — the name at the top and the number/set code at the bottom.

import { createWorker, OEM, PSM, type Page, type Worker } from 'tesseract.js';
import type { ScanGuess } from '../lib/match.ts';
import { buildGuess, parseHp } from './parse.ts';

export const CARD_RATIO = 63 / 88; // width / height of a standard card

let workerPromise: Promise<Worker> | null = null;
let progressListener: ((progress: number, status: string) => void) | null = null;

/** Starts loading the OCR engine (~a few MB, cached after the first time). */
export function warmUpOcr(): Promise<Worker> {
  workerPromise ??= createWorker('eng', OEM.LSTM_ONLY, {
    logger: (m) => progressListener?.(m.progress, m.status),
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
}

/** Copies part of the card (fractions of its size) into a new canvas, scaled and contrast-boosted. */
function strip(card: HTMLCanvasElement, x: number, y: number, w: number, h: number, targetWidth: number): HTMLCanvasElement {
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

// Every read changes the engine's settings, so reads take turns (auto-scan vs the shutter).
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

export function scanCard(card: HTMLCanvasElement, options: ScanOptions = {}): Promise<ScanResult> {
  return exclusive(async () => {
    options.signal?.throwIfAborted();
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

async function readCard(worker: Worker, card: HTMLCanvasElement, { onProgress, signal, quick }: ScanOptions): Promise<ScanResult> {
  const step = (label: string) => {
    signal?.throwIfAborted();
    onProgress?.(label);
  };
  step('Reading the name…');
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '' });
  const top = await worker.recognize(strip(card, 0.02, 0.01, 0.96, 0.12, 1000), {}, { text: true, blocks: !!quick });
  const topText = top.data.text;
  if (quick && !hasRealWord(top.data) && !parseHp(topText)) {
    // Only texture where the name should be: most likely no card in the frame yet.
    return { guess: buildGuess('', ''), topText, bottomText: '' };
  }
  step('Reading the card number…');
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const bottom = await worker.recognize(strip(card, 0, 0.84, 1, 0.16, 1600));
  let bottomText = bottom.data.text;
  let guess = buildGuess(topText, bottomText);

  if (!guess.number) {
    // The number is tiny: bottom-right on older cards ("4/102"), bottom-left on newer ones
    // ("MEW EN 025/165"). Zoom into each corner and read digits only.
    step('Looking closer at the number…');
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789/' });
    const corners: [number, number, number, number][] = [
      [0.55, 0.9, 0.45, 0.1],
      [0, 0.86, 0.55, 0.12],
    ];
    for (const [x, y, w, h] of corners) {
      signal?.throwIfAborted();
      const r = await worker.recognize(strip(card, x, y, w, h, 1400));
      bottomText += `\n${r.data.text}`;
      guess = buildGuess(topText, bottomText);
      if (guess.number || guess.alternatives?.length) break;
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' });
  }
  if (!guess.number && !guess.alternatives?.length) {
    // The card may sit a little high/low in the frame — try a taller strip.
    step('Looking harder…');
    const wide = await worker.recognize(strip(card, 0, 0.74, 1, 0.26, 1600));
    bottomText += `\n${wide.data.text}`;
    guess = buildGuess(topText, bottomText);
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

/** Loads a photo and center-crops it to card proportions (works best when the card fills the photo). */
export async function photoToCard(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  let { width: w, height: h } = bitmap;
  let sx = 0;
  let sy = 0;
  if (w / h > CARD_RATIO) {
    const nw = h * CARD_RATIO;
    sx = (w - nw) / 2;
    w = nw;
  } else {
    const nh = w / CARD_RATIO;
    sy = (h - nh) / 2;
    h = nh;
  }
  const scale = Math.min(1, 1800 / h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, w, h, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}
