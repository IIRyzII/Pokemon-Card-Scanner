// Scanning a whole binder page: line the page up with the guide (its pockets drawn in), take one
// photo, and every pocket is checked against the card that goes there (scan/pageScan.ts). The
// cards found, ticked, go into the collection in one go; any pocket can be ticked or unticked.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { printingNote, type Pocket } from '../lib/binders.ts';
import type { CatalogCard } from '../lib/catalog.ts';
import type { PrintIndex } from '../lib/pictures.ts';
import { loadPrintIndex } from '../lib/useCatalog.ts';
import { captureFrame, loadPhoto } from '../scan/ocr.ts';
import { checkPage, type PocketCheck } from '../scan/pageScan.ts';
import { IconCamera, IconImage } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';

/** A pocket's size and the seams between them, in mm: a page's proportions. */
const POCKET = { w: 67, h: 92, seam: 4 };
export const pageAspect = (cols: number, rows: number) => (cols * POCKET.w + (cols + 1) * POCKET.seam) / (rows * POCKET.h + (rows + 1) * POCKET.seam);
/** The viewfinder's shape (width / height), as styled */
const VIEW_ASPECT = 3 / 4;

interface Props {
  /** 1-based, for the title */
  pageNo: number;
  cols: number;
  rows: number;
  /** The page's pockets, in reading order */
  pockets: Pocket[];
  cardOf: (cardId: string) => CatalogCard | undefined;
  onAdd: (pockets: Pocket[]) => void;
  onClose: () => void;
}

type Phase = { name: 'camera' } | { name: 'checking' } | { name: 'results'; photo: string; checks: (PocketCheck | null)[] } | { name: 'error'; message: string };

export function PageScanner({ pageNo, cols, rows, pockets, cardOf, onAdd, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const guide = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [index] = useState<Promise<PrintIndex | null>>(loadPrintIndex);
  const [phase, setPhase] = useState<Phase>({ name: 'camera' });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const aspect = pageAspect(cols, rows);
  const expected = Array.from({ length: cols * rows }, (_, i) => (pockets[i] ? (cardOf(pockets[i].cardId) ?? null) : null));

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(window.isSecureContext ? 'This browser has no camera access: use a photo instead.' : 'The camera only works on an https:// page.');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
    } catch (err) {
      setCameraError(
        (err as DOMException).name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings, or use a photo instead.'
          : 'No camera could be started. You can use a photo instead.',
      );
    }
  }, []);

  useEffect(() => {
    if (phase.name !== 'camera') return;
    void startCamera();
    return stopCamera;
  }, [phase.name, startCamera, stopCamera]);

  async function check(photo: HTMLCanvasElement) {
    stopCamera();
    setPhase({ name: 'checking' });
    const prints = await index;
    if (!prints) {
      setPhase({ name: 'error', message: "Card pictures aren't available yet, so the page can't be checked. Try again in a moment." });
      return;
    }
    // Let "Checking…" show before the work starts (it takes a second or two on a phone)
    await new Promise((r) => setTimeout(r, 60));
    const ctx = photo.getContext('2d', { willReadFrequently: true })!;
    const pixels = ctx.getImageData(0, 0, photo.width, photo.height);
    const checks = checkPage(prints, pixels, cols, rows, expected);
    setPicked(new Set(checks.flatMap((c, i) => (c?.outcome === 'match' && !pockets[i].filled ? [i] : []))));
    setPhase({ name: 'results', photo: photo.toDataURL('image/jpeg', 0.8), checks });
    photo.width = photo.height = 0;
  }

  function shutter() {
    if (!video.current?.videoWidth || !guide.current) return;
    void check(captureFrame(video.current, guide.current));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      void check(await loadPhoto(file));
    } catch {
      setPhase({ name: 'error', message: "That photo couldn't be opened." });
    }
  }

  const toggle = (i: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  const guideSize: CSSProperties = aspect < VIEW_ASPECT ? { height: '92%' } : { width: '92%' };
  const grid: CSSProperties = { gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` };
  const results = phase.name === 'results' ? phase : null;
  const count = (outcome: PocketCheck['outcome']) => results?.checks.filter((c, i) => c?.outcome === outcome && !pockets[i]?.filled).length ?? 0;

  return (
    <Sheet
      title={`Scan page ${pageNo}`}
      onClose={onClose}
      wide
      footer={
        results ? (
          <>
            <button className="btn" onClick={() => setPhase({ name: 'camera' })}>
              Scan again
            </button>
            <button
              className="btn primary"
              disabled={!picked.size}
              onClick={() => {
                onAdd([...picked].sort((a, b) => a - b).map((i) => pockets[i]));
                onClose();
              }}
            >
              Add {picked.size} card{picked.size === 1 ? '' : 's'}
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {phase.name === 'camera' && (
        <>
          <p className="muted small center">Line the page's pockets up with the grid, then take the photo. Less glare is better: tilt the page away from lights.</p>
          <div className="viewfinder page-viewfinder">
            <video ref={video} playsInline muted autoPlay />
            <div className="page-guide" ref={guide} style={{ ...guideSize, aspectRatio: String(aspect), ...grid }}>
              {expected.map((card, i) => (
                <span key={i} className={pockets[i] ? '' : 'spare'}>
                  {card ? `#${card.number}` : ''}
                </span>
              ))}
            </div>
            {cameraError && <div className="vf-msg">{cameraError}</div>}
          </div>
          <div className="scan-controls">
            <button className="btn" onClick={() => fileInput.current?.click()}>
              <IconImage /> Photo
            </button>
            <button className="shutter" aria-label="Take the photo" disabled={!!cameraError} onClick={shutter}>
              <IconCamera />
            </button>
            <span className="spacer" />
          </div>
        </>
      )}

      {phase.name === 'checking' && (
        <div className="reading">
          <div className="spinner" />
          <p className="muted">Checking every pocket…</p>
        </div>
      )}

      {phase.name === 'error' && (
        <div className="empty">
          <p>{phase.message}</p>
          <button className="btn primary" onClick={() => setPhase({ name: 'camera' })}>
            Try again
          </button>
        </div>
      )}

      {results && (
        <>
          <p className="small center" aria-live="polite">
            {count('match') ? <b>Found {count('match')} card{count('match') === 1 ? '' : 's'} to add.</b> : <b>No new cards found.</b>}{' '}
            <span className="muted">Tap a pocket to tick or untick it.</span>
          </p>
          <div className="page-result" style={{ aspectRatio: String(aspect) }}>
            <img src={results.photo} alt={`Your photo of page ${pageNo}`} />
            <div className="page-result-grid" style={grid}>
              {results.checks.map((c, i) => {
                const pocket = pockets[i];
                const card = expected[i];
                if (!pocket || !c || !card) return <span key={i} className="pocket-check spare" />;
                const on = picked.has(i);
                const state = pocket.filled ? 'have' : c.outcome;
                const what = pocket.filled
                  ? 'already in the collection'
                  : c.outcome === 'match'
                    ? 'found'
                    : c.outcome === 'other'
                      ? `looks like ${c.seen?.name ?? 'another card'}`
                      : 'not sure: empty, or hard to see';
                return (
                  <button
                    key={i}
                    type="button"
                    className={`pocket-check ${state}${on ? ' on' : ''}`}
                    aria-pressed={on}
                    disabled={pocket.filled}
                    title={`#${card.number} ${card.name} (${printingNote(pocket.variant)}): ${what}`}
                    aria-label={`#${card.number} ${card.name}, ${printingNote(pocket.variant)}: ${what}${on ? ', will be added' : ''}`}
                    onClick={() => toggle(i)}
                  >
                    <span className="badge">{pocket.filled ? 'In' : on ? '✓' : c.outcome === 'other' ? '≠' : c.outcome === 'unsure' ? '?' : '○'}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <ul className="page-check-notes small">
            {results.checks.map((c, i) => {
              const card = expected[i];
              if (!c || !card || pockets[i].filled || c.outcome === 'match') return null;
              return (
                <li key={i}>
                  <b>
                    #{card.number} {card.name}
                  </b>{' '}
                  <span className="muted">
                    {c.outcome === 'other' ? `looks like ${c.seen?.name} (${c.seen?.set.name} #${c.seen?.number}): wrong pocket?` : 'not sure: empty, or hard to see. Tick it if it’s there.'}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
