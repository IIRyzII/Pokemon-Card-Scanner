// Auto-scan: while the camera is live, keep finding the card (and outline it on screen); once it's
// held steady, recognise it — by its picture, and by its text when the picture can't settle it —
// and pick it as soon as that's certain, without waiting for the shutter button.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Catalog } from '../lib/catalog.ts';
import { nameMatch, type ScanGuess } from '../lib/match.ts';
import { loadPrintIndex } from '../lib/useCatalog.ts';
import type { Corners, Point } from './detect.ts';
import { cornerShift, locateCard, straightenCard, toElement } from './locate.ts';
import { frameChange, snapshot } from './motion.ts';
import { captureFrame, frameCrop, releaseCanvas, warmUpOcr } from './ocr.ts';
import { readCard, type Reading } from './recognize.ts';

export type AutoStatus =
  | { state: 'loading' }
  | { state: 'looking' }
  | { state: 'moving' }
  /** Read part of the card (a name or a number), not sure which card yet */
  | { state: 'seen'; text: string }
  /** The picture says which card; reading the number to tell its printings (reprints) apart */
  | { state: 'checking'; name: string }
  | { state: 'repeat'; name: string }
  | { state: 'failed' };

/** The card's outline in CSS pixels of the <video> element; `steady` once it stops moving. */
export interface Outline {
  points: Point[];
  steady: boolean;
}

const TICK_MS = 150; // pause between looks (finding the card takes a few tens of ms more)
const STEADY = 0.02; // corners moving less than this share of the card's height = held steady
const MOVED = 0.08; // …and more than this = the card was moved (or swapped)
const STEADY_LOOKS = 2; // steady looks in a row before reading
const SETTLE_MS = 1500; // focus and exposure shift while the camera starts; that isn't the card moving
const MOVING_SNAPSHOT = 12; // without an outline: frame change above this = moving

let lastFound: string | null = null;

/** Remembers the card just shown, so "Scan again" with it still in view doesn't pick it straight back up. */
export function markFound(cardId: string) {
  lastFound = cardId;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a read has got so far, for the status line: a real card name, else the number ("4/102"). */
function describe(reading: Reading): string {
  const top = reading.candidates[0];
  const g: ScanGuess | undefined = reading.ocr?.guess;
  if (!top || !g) return '';
  if (nameMatch(g, top.card) >= 0.7) return top.card.name; // the catalog's spelling, not raw OCR
  if (g.number) return g.total ? `${g.number}/${g.total}` : g.number;
  return '';
}

interface Options {
  /** The camera is live and auto-scan is switched on */
  active: boolean;
  catalog: Catalog | null;
  video: RefObject<HTMLVideoElement | null>;
  frame: RefObject<HTMLElement | null>;
  /** Called with a reading that's certain. Its image is released after this returns. */
  onFound: (reading: Reading) => void;
}

export function useAutoScan({ active, catalog, video, frame, onFound }: Options): { status: AutoStatus | null; outline: Outline | null } {
  const [status, setStatus] = useState<AutoStatus | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  // Keep the latest onFound without restarting the loop.
  const found = useRef(onFound);
  useLayoutEffect(() => {
    found.current = onFound;
  });

  useEffect(() => {
    if (!active || !catalog) return;
    const abort = new AbortController();
    const { signal } = abort;
    let shown = '';
    const show = (s: AutoStatus) => {
      const key = JSON.stringify(s);
      if (signal.aborted || key === shown) return;
      shown = key;
      setStatus(s);
    };

    void (async () => {
      show({ state: 'loading' });
      const ocrReady = warmUpOcr().then(
        () => true,
        () => false,
      );
      const index = await loadPrintIndex();
      if (!index && !(await ocrReady)) return show({ state: 'failed' });
      show({ state: 'looking' });

      const started = performance.now();
      let corners: Corners | null = null;
      let snap: Uint8ClampedArray | null = null; // for when no outline can be found
      let steady = 0;
      let moved = false; // since the camera started (lets the last card be found again)
      let paused = false; // re-found the last card: wait for it to move before reading again
      let restUntil = 0;
      let misses = 0; // reads in a row that found nothing, to slow down when there's no card

      while (!signal.aborted) {
        await wait(TICK_MS);
        const v = video.current;
        const f = frame.current;
        if (signal.aborted || !v || !f || !v.videoWidth || document.hidden) continue;

        const detection = locateCard(v);
        let card: Parameters<typeof readCard>[0]['card'];
        if (detection) {
          const shift = corners ? cornerShift(corners, detection.corners) : 1;
          corners = detection.corners;
          snap = null;
          const isSteady = shift < STEADY;
          setOutline({ points: detection.corners.map((p) => toElement(v, p)), steady: isSteady });
          if (!isSteady) {
            steady = 0;
            restUntil = 0;
            if (shift > MOVED) {
              paused = false;
              misses = 0;
              if (performance.now() - started > SETTLE_MS) moved = true;
            }
            show({ state: 'moving' });
            continue;
          }
          if (++steady < STEADY_LOOKS || paused || performance.now() < restUntil) continue;
          card = straightenCard(v, v.videoWidth, v.videoHeight, detection.corners);
        } else {
          // No outline (e.g. a white card on a white table): read the guide frame once the view is steady.
          corners = null;
          setOutline(null);
          const now = snapshot(v, frameCrop(v, f));
          const change = snap ? frameChange(snap, now) : 0;
          snap = now;
          if (change > MOVING_SNAPSHOT) {
            steady = 0;
            restUntil = 0;
            paused = false;
            if (performance.now() - started > SETTLE_MS) moved = true;
            show({ state: 'moving' });
            continue;
          }
          if (++steady < STEADY_LOOKS + 1 || paused || performance.now() < restUntil) continue;
          card = captureFrame(v, f);
        }

        let reading: Reading;
        try {
          reading = await readCard({ catalog, index, card, quick: true, signal });
        } catch {
          releaseCanvas(card instanceof HTMLCanvasElement ? card : card.canvas);
          if (signal.aborted) return;
          restUntil = performance.now() + 1000;
          continue;
        }
        if (signal.aborted) return releaseCanvas(reading.image);
        const top = reading.candidates[0];
        if (reading.confidence === 'sure') {
          if (top.card.id === lastFound && !moved) {
            releaseCanvas(reading.image);
            paused = true;
            show({ state: 'repeat', name: top.card.name });
            continue;
          }
          found.current(reading);
          releaseCanvas(reading.image);
          return;
        }
        releaseCanvas(reading.image);
        if (reading.picture?.clear) {
          // The picture knows the card; the text has to say which printing. Keep reading.
          misses = 0;
          restUntil = performance.now() + 250;
          show({ state: 'checking', name: reading.picture.best.card.name });
          continue;
        }
        const seen = describe(reading);
        misses = seen ? 0 : misses + 1;
        restUntil = performance.now() + (seen ? 250 : Math.min(800 * misses, 3000));
        show(seen ? { state: 'seen', text: seen } : { state: 'looking' });
      }
    })();
    return () => {
      abort.abort();
      setStatus(null);
      setOutline(null);
    };
  }, [active, catalog, video, frame]);

  return { status: active ? status : null, outline: active ? outline : null };
}
