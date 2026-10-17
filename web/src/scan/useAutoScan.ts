// Auto-scan: while the camera is live, keep finding the card (and outline it on screen) and
// recognise it by its picture on every look — a little movement or blur doesn't matter for that —
// reading its text when the picture can't settle it, and pick it as soon as that's certain,
// without waiting for the shutter button.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Catalog } from '../lib/catalog.ts';
import { nameMatch, type ScanGuess } from '../lib/match.ts';
import { CERTAIN } from '../lib/pictures.ts';
import { loadPrintIndex } from '../lib/useCatalog.ts';
import type { Corners, Point } from './detect.ts';
import { cornerShift, locateCard, smallCard, straightenCard, toCanvas, toElement } from './locate.ts';
import { frameChange, snapshot } from './motion.ts';
import { captureFrame, frameCrop, releaseCanvas, warmUpOcr } from './ocr.ts';
import { matchPicture, readCard, readingFromPicture, type Reading } from './recognize.ts';
import { rotate180 } from './warp.ts';

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

const TICK_MS = 80; // pause between looks (finding and matching the card takes a few tens of ms more)
const STILL_ENOUGH = 0.05; // corners moving less than this share of the card's height: sharp enough to read text
const MOVED = 0.08; // …and more than this = the card was moved (or swapped)
const STEADY_LOOKS = 2; // without an outline: steady looks in a row before reading the guide frame
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
      let streakId: string | null = null; // the card the last look's picture clearly matched…
      let streak = 0; // …and how many looks in a row it has

      while (!signal.aborted) {
        await wait(TICK_MS);
        const v = video.current;
        const f = frame.current;
        if (signal.aborted || !v || !f || !v.videoWidth || document.hidden) continue;

        const detection = locateCard(v);
        let card: Parameters<typeof readCard>[0]['card'] | null = null;
        let reading: Reading | null = null;
        if (detection) {
          snap = null;
          const shift = corners ? cornerShift(corners, detection.corners) : 1;
          corners = detection.corners;
          const still = shift < STILL_ENOUGH;
          setOutline({ points: detection.corners.map((p) => toElement(v, p)), steady: still });
          if (shift > MOVED) {
            paused = false;
            misses = 0;
            if (performance.now() - started > SETTLE_MS) moved = true;
          }
          if (paused) continue;
          // The text needs a sharp frame; the picture doesn't (it only uses the card's broad shapes).
          let readNow = still && performance.now() >= restUntil;
          if (index) {
            const small = smallCard(detection);
            const { matches, flipped, picture } = matchPicture(index, small);
            if (picture?.clear && !picture.twins.length) {
              // One card: certain at once if the match is very close, else once it comes up twice running.
              streak = picture.best.card.id === streakId ? streak + 1 : 1;
              streakId = picture.best.card.id;
              if ((picture.best.distance > CERTAIN && streak < 2) || performance.now() < restUntil) {
                show({ state: 'seen', text: picture.best.card.name });
                continue;
              }
              // Settled by the picture we just matched. (Grabbing a fresh frame now could catch the card
              // somewhere else if it's moving.)
              reading = readingFromPicture(catalog, matches, picture, toCanvas(flipped ? rotate180(small) : small));
            } else {
              streak = 0;
              streakId = null;
              if (picture?.clear) show({ state: 'checking', name: picture.best.card.name }); // a reprint: the number decides
              else if (!still) show({ state: 'moving' });
            }
          } else if (!still) {
            show({ state: 'moving' });
          }
          if (!reading) {
            if (!readNow) continue;
            card = straightenCard(v, v.videoWidth, v.videoHeight, detection.corners);
          }
        } else {
          // No outline (e.g. a white card on a white table): read the guide frame once the view is steady.
          corners = null;
          streak = 0;
          streakId = null;
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

        if (!reading && card) {
          try {
            reading = await readCard({ catalog, index, card, quick: true, signal });
          } catch {
            releaseCanvas(card instanceof HTMLCanvasElement ? card : card.canvas);
            if (signal.aborted) return;
            restUntil = performance.now() + 1000;
            continue;
          }
        }
        if (!reading) continue;
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
