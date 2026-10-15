// Auto-scan: while the camera is live, read the card each time it's held steady and pick it
// as soon as the read points at one card, without waiting for the shutter button.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Catalog } from '../lib/catalog.ts';
import { identifyCard, matchConfidence, nameMatch, type Candidate, type ScanGuess } from '../lib/match.ts';
import { frameChange, snapshot } from './motion.ts';
import { captureFrame, frameCrop, scanCard, warmUpOcr, type ScanResult } from './ocr.ts';

export type AutoStatus =
  | { state: 'loading' }
  | { state: 'looking' }
  | { state: 'moving' }
  | { state: 'seen'; text: string }
  | { state: 'repeat'; name: string }
  | { state: 'failed' };

/** A card auto-scan is sure about (matchConfidence 'sure'), with the frame it was read from. */
export interface AutoFound {
  card: HTMLCanvasElement;
  result: ScanResult;
  candidates: Candidate[];
}

const TICK_MS = 200; // how often we check whether the camera is steady
const MOVING = 12; // frameChange above this means the card or the camera is moving
const STEADY_TICKS = 2; // steady checks in a row before reading a frame
const SETTLE_MS = 1500; // focus and exposure shift while the camera starts; that isn't the card moving

let lastFound: string | null = null;

/** Remembers the card just shown, so "Scan again" with it still in view doesn't pick it straight back up. */
export function markFound(cardId: string) {
  lastFound = cardId;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a read has got so far, for the status line: a real card name, else the number ("4/102"). */
function describe(g: ScanGuess, candidates: Candidate[]): string {
  const top = candidates[0];
  if (!top) return '';
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
  onFound: (found: AutoFound) => void;
}

export function useAutoScan({ active, catalog, video, frame, onFound }: Options): AutoStatus | null {
  const [status, setStatus] = useState<AutoStatus | null>(null);
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
      try {
        await warmUpOcr();
      } catch {
        show({ state: 'failed' });
        return;
      }
      show({ state: 'looking' });

      const started = performance.now();
      let prev: Uint8ClampedArray | null = null;
      let steady = 0;
      let moved = false; // since the camera started (lets the last card be found again)
      let paused = false; // re-found the last card: wait for movement before reading again
      let restUntil = 0;
      let misses = 0; // reads in a row that found nothing, to slow down when there's no card

      while (!signal.aborted) {
        await wait(TICK_MS);
        const v = video.current;
        const f = frame.current;
        if (signal.aborted || !v || !f || !v.videoWidth || document.hidden) continue;
        const snap = snapshot(v, frameCrop(v, f));
        const change = prev ? frameChange(prev, snap) : 0;
        prev = snap;
        if (change > MOVING) {
          steady = 0;
          misses = 0;
          restUntil = 0;
          paused = false;
          if (performance.now() - started > SETTLE_MS) moved = true;
          show({ state: 'moving' });
          continue;
        }
        if (++steady < STEADY_TICKS || paused || performance.now() < restUntil) continue;

        const card = captureFrame(v, f);
        let result: ScanResult;
        try {
          result = await scanCard(card, { signal, quick: true });
        } catch {
          if (signal.aborted) return;
          restUntil = performance.now() + 1000;
          continue;
        }
        if (signal.aborted) return;
        const candidates = identifyCard(catalog, result.guess, 12);
        const top = candidates[0];
        // Only a sure read is picked by itself; anything less waits for a clearer frame or the shutter.
        // (Two "likely" reads agreeing proves little: a still camera repeats the same misread.)
        if (matchConfidence(result.guess, candidates) === 'sure') {
          if (top.card.id === lastFound && !moved) {
            paused = true;
            show({ state: 'repeat', name: top.card.name });
            continue;
          }
          found.current({ card, result, candidates });
          return;
        }
        const seen = describe(result.guess, candidates);
        misses = seen ? 0 : misses + 1;
        restUntil = performance.now() + (seen ? 250 : Math.min(800 * misses, 3000));
        show(seen ? { state: 'seen', text: seen } : { state: 'looking' });
      }
    })();
    return () => {
      abort.abort();
      setStatus(null);
    };
  }, [active, catalog, video, frame]);

  return active ? status : null;
}
