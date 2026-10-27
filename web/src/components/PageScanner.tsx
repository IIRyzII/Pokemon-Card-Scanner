// Scanning a whole page of cards at once: line the page up with the guide (its pockets drawn in)
// and take one photo. Two uses:
//  - PageReader (the scanner's "Binder page"): every pocket's card is recognised from its picture
//    and the ones found go into the scan list in one go, a page at a time.
//  - PageScanner (a binder's page): every pocket is checked against the card that goes there, and
//    the ones found go into the collection.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { allPrintingsOf, printingNote, type Pocket } from '../lib/binders.ts';
import type { CatalogCard } from '../lib/catalog.ts';
import { useCurrency } from '../lib/currency.tsx';
import type { PrintIndex } from '../lib/pictures.ts';
import { href } from '../lib/router.ts';
import { copiesIn, listCardOf, scanList, useScanList } from '../lib/scanList.ts';
import { loadPrintIndex } from '../lib/useCatalog.ts';
import { captureFrame, loadPhoto } from '../scan/ocr.ts';
import { checkPage, readPage, type PocketCheck, type PocketRead } from '../scan/pageScan.ts';
import { CardImage } from './CardImage.tsx';
import { useFeedback } from './feedback.tsx';
import { IconCamera, IconImage } from './Icons.tsx';
import { defaultFields } from './ItemForm.tsx';
import { Sheet } from './Sheet.tsx';

/** A pocket's size and the seams between them, in mm: a page's proportions. */
const POCKET = { w: 67, h: 92, seam: 4 };
export const pageAspect = (cols: number, rows: number) => (cols * POCKET.w + (cols + 1) * POCKET.seam) / (rows * POCKET.h + (rows + 1) * POCKET.seam);
/** The viewfinder's shape (width / height), as styled */
const VIEW_ASPECT = 3 / 4;

const gridOf = (cols: number, rows: number): CSSProperties => ({ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` });

/** The photo as pixels, and as a picture to show (the canvas is freed). */
function pixelsOf(photo: HTMLCanvasElement): { pixels: ImageData; shown: string } {
  const pixels = photo.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, photo.width, photo.height);
  const shown = photo.toDataURL('image/jpeg', 0.8);
  photo.width = photo.height = 0;
  return { pixels, shown };
}

/** The camera with the page's pockets drawn over it, a shutter, and "use a photo". */
function PageCamera({ cols, rows, labels, onPhoto }: { cols: number; rows: number; labels: string[]; onPhoto: (photo: HTMLCanvasElement) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const guide = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const aspect = pageAspect(cols, rows);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let gone = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(window.isSecureContext ? 'This browser has no camera access: use a photo instead.' : 'The camera only works on an https:// page.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (gone) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
        }
      } catch (err) {
        setCameraError(
          (err as DOMException).name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser settings, or use a photo instead.'
            : 'No camera could be started. You can use a photo instead.',
        );
      }
    })();
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) loadPhoto(file).then(onPhoto, () => setCameraError("That photo couldn't be opened."));
        }}
      />
      <p className="muted small center">Line the page's pockets up with the grid, then take the photo. Less glare is better: tilt the page away from lights.</p>
      <div className="viewfinder page-viewfinder">
        <video ref={video} playsInline muted autoPlay />
        <div className="page-guide" ref={guide} style={{ ...(aspect < VIEW_ASPECT ? { height: '92%' } : { width: '92%' }), aspectRatio: String(aspect), ...gridOf(cols, rows) }}>
          {labels.map((label, i) => (
            <span key={i} className={label === '' ? 'spare' : ''}>
              {label}
            </span>
          ))}
        </div>
        {cameraError && <div className="vf-msg">{cameraError}</div>}
      </div>
      <div className="scan-controls">
        <button className="btn" onClick={() => fileInput.current?.click()}>
          <IconImage /> Photo
        </button>
        <button
          className="shutter"
          aria-label="Take the photo"
          disabled={!!cameraError}
          onClick={() => video.current?.videoWidth && guide.current && onPhoto(captureFrame(video.current, guide.current))}
        >
          <IconCamera />
        </button>
        <span className="spacer" />
      </div>
    </>
  );
}

function Checking({ what }: { what: string }) {
  return (
    <div className="reading">
      <div className="spinner" />
      <p className="muted">{what}</p>
    </div>
  );
}

/** Lets "Checking…" show before the work starts (it takes a second or two on a phone). */
const painted = () => new Promise((r) => setTimeout(r, 60));
const NO_PICTURES = "Card pictures aren't available yet, so the page can't be checked. Try again in a moment.";

// ---------- the scanner's "Binder page": any cards, into the scan list ----------

const LAYOUTS = [
  { pockets: 9, cols: 3, rows: 3 },
  { pockets: 12, cols: 4, rows: 3 },
  { pockets: 4, cols: 2, rows: 2 },
] as const;
const LAYOUT_KEY = 'pokevault.pageLayout';
const savedLayout = () => {
  try {
    return LAYOUTS.find((l) => String(l.pockets) === localStorage.getItem(LAYOUT_KEY)) ?? LAYOUTS[0];
  } catch {
    return LAYOUTS[0];
  }
};

type ReadPhase = { name: 'camera' } | { name: 'checking' } | { name: 'results'; photo: string; reads: PocketRead[] } | { name: 'error'; message: string };

export function PageReader({ onClose }: { onClose: () => void }) {
  const { currency } = useCurrency();
  const { toast } = useFeedback();
  const list = useScanList();
  const [index] = useState<Promise<PrintIndex | null>>(loadPrintIndex);
  const [layout, setLayout] = useState(savedLayout);
  const [phase, setPhase] = useState<ReadPhase>({ name: 'camera' });
  /** Pocket → the card chosen for it (of its choices), when ticked */
  const [picked, setPicked] = useState<Map<number, CatalogCard>>(new Map());

  function chooseLayout(l: (typeof LAYOUTS)[number]) {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, String(l.pockets));
    } catch {
      // remembered for this visit only
    }
  }

  async function read(photo: HTMLCanvasElement) {
    setPhase({ name: 'checking' });
    const prints = await index;
    if (!prints) return setPhase({ name: 'error', message: NO_PICTURES });
    await painted();
    const { pixels, shown } = pixelsOf(photo);
    const reads = readPage(prints, pixels, layout.cols, layout.rows);
    setPicked(new Map(reads.flatMap((r, i) => (r.outcome === 'clear' && r.card ? [[i, r.card] as const] : []))));
    setPhase({ name: 'results', photo: shown, reads });
  }

  function toggle(i: number, r: PocketRead) {
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(i)) next.delete(i);
      else if (r.card) next.set(i, r.card);
      return next;
    });
  }

  function addToList() {
    const cards = [...picked.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
    for (const card of cards) scanList.add(listCardOf(card), defaultFields(allPrintingsOf(card), currency));
    navigator.vibrate?.(40);
    toast(`${cards.length} card${cards.length === 1 ? '' : 's'} added to the list. Next page!`);
    setPhase({ name: 'camera' });
  }

  const results = phase.name === 'results' ? phase : null;
  const inList = copiesIn(list);
  return (
    <Sheet
      title="Scan a binder page"
      onClose={onClose}
      wide
      footer={
        results ? (
          <>
            <button className="btn" onClick={() => setPhase({ name: 'camera' })}>
              Retake
            </button>
            <button className="btn primary" disabled={!picked.size} onClick={addToList}>
              Add {picked.size} to the list
            </button>
          </>
        ) : inList > 0 ? (
          <a className="btn primary" href={href('add', 'list')}>
            Review the list · {inList} →
          </a>
        ) : undefined
      }
    >
      {phase.name === 'camera' && (
        <>
          <div className="segmented small page-layouts" role="group" aria-label="Pockets a page">
            {LAYOUTS.map((l) => (
              <button key={l.pockets} type="button" className={l === layout ? 'on' : ''} aria-pressed={l === layout} onClick={() => chooseLayout(l)}>
                {l.pockets} pockets
              </button>
            ))}
          </div>
          <PageCamera cols={layout.cols} rows={layout.rows} labels={Array.from({ length: layout.pockets }, (_, i) => String(i + 1))} onPhoto={(p) => void read(p)} />
        </>
      )}
      {phase.name === 'checking' && <Checking what="Recognising every card…" />}
      {phase.name === 'error' && <PageError message={phase.message} onRetry={() => setPhase({ name: 'camera' })} />}
      {results && (
        <>
          <p className="small center" aria-live="polite">
            <b>
              Found {results.reads.filter((r) => r.outcome === 'clear').length} of {results.reads.filter((r) => r.outcome !== 'none').length || results.reads.length} cards.
            </b>{' '}
            <span className="muted">Tap a pocket to tick or untick it.</span>
          </p>
          <div className="page-result" style={{ aspectRatio: String(pageAspect(layout.cols, layout.rows)) }}>
            <img src={results.photo} alt="Your photo of the page" />
            <div className="page-result-grid" style={gridOf(layout.cols, layout.rows)}>
              {results.reads.map((r, i) => {
                const on = picked.has(i);
                const card = picked.get(i) ?? r.card;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`pocket-check ${r.outcome === 'clear' ? 'match' : r.outcome === 'guess' ? 'unsure' : 'none'}${on ? ' on' : ''}`}
                    aria-pressed={on}
                    disabled={!r.card}
                    aria-label={`Pocket ${i + 1}: ${card ? `${card.name}, ${card.set.name} #${card.number}${r.outcome === 'guess' ? ' (probably)' : ''}` : 'not recognised'}${on ? ', will be added' : ''}`}
                    onClick={() => toggle(i, r)}
                  >
                    <span className="badge">{on ? '✓' : r.outcome === 'none' ? '?' : '○'}</span>
                    {card && <span className="pocket-name">{card.name}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <ul className="page-reads">
            {results.reads.map((r, i) => {
              if (!r.card) return null;
              const chosen = picked.get(i) ?? r.card;
              return (
                <li key={i} className={picked.has(i) ? 'on' : ''}>
                  <label className="page-read-tick">
                    <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i, r)} aria-label={`Add ${chosen.name}`} />
                  </label>
                  <CardImage base={chosen.image} name={chosen.name} setId={chosen.set.id} number={chosen.number} />
                  <div className="page-read-info">
                    <b>{chosen.name}</b>
                    {r.outcome === 'guess' && <span className="faint small"> probably</span>}
                    {r.choices.length > 1 ? (
                      <select
                        aria-label={`Which ${chosen.name}`}
                        value={chosen.id}
                        onChange={(e) => {
                          const c = r.choices.find((x) => x.id === e.target.value)!;
                          setPicked((m) => new Map(m).set(i, c));
                        }}
                      >
                        {r.choices.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name === chosen.name ? '' : `${c.name} · `}
                            {c.set.name} · #{c.number}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="muted small">
                        {chosen.set.name} · #{chosen.number}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {results.reads.some((r) => !r.card) && (
            <p className="faint small center">Pockets marked ? weren't recognised (empty, or glare): scan those cards on their own.</p>
          )}
        </>
      )}
    </Sheet>
  );
}

function PageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty">
      <p>{message}</p>
      <button className="btn primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

// ---------- a binder's page: checked against the cards that go in it, into the collection ----------

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

type CheckPhase = { name: 'camera' } | { name: 'checking' } | { name: 'results'; photo: string; checks: (PocketCheck | null)[] } | { name: 'error'; message: string };

export function PageScanner({ pageNo, cols, rows, pockets, cardOf, onAdd, onClose }: Props) {
  const [index] = useState<Promise<PrintIndex | null>>(loadPrintIndex);
  const [phase, setPhase] = useState<CheckPhase>({ name: 'camera' });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const aspect = pageAspect(cols, rows);
  const expected = Array.from({ length: cols * rows }, (_, i) => (pockets[i] ? (cardOf(pockets[i].cardId) ?? null) : null));

  async function check(photo: HTMLCanvasElement) {
    setPhase({ name: 'checking' });
    const prints = await index;
    if (!prints) return setPhase({ name: 'error', message: NO_PICTURES });
    await painted();
    const { pixels, shown } = pixelsOf(photo);
    const checks = checkPage(prints, pixels, cols, rows, expected);
    setPicked(new Set(checks.flatMap((c, i) => (c?.outcome === 'match' && !pockets[i].filled ? [i] : []))));
    setPhase({ name: 'results', photo: shown, checks });
  }

  const toggle = (i: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  const results = phase.name === 'results' ? phase : null;
  const found = results?.checks.filter((c, i) => c?.outcome === 'match' && !pockets[i]?.filled).length ?? 0;

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
      {phase.name === 'camera' && <PageCamera cols={cols} rows={rows} labels={expected.map((c) => (c ? `#${c.number}` : ''))} onPhoto={(p) => void check(p)} />}
      {phase.name === 'checking' && <Checking what="Checking every pocket…" />}
      {phase.name === 'error' && <PageError message={phase.message} onRetry={() => setPhase({ name: 'camera' })} />}
      {results && (
        <>
          <p className="small center" aria-live="polite">
            {found ? <b>Found {found} card{found === 1 ? '' : 's'} to add.</b> : <b>No new cards found.</b>}{' '}
            <span className="muted">Tap a pocket to tick or untick it.</span>
          </p>
          <div className="page-result" style={{ aspectRatio: String(aspect) }}>
            <img src={results.photo} alt={`Your photo of page ${pageNo}`} />
            <div className="page-result-grid" style={gridOf(cols, rows)}>
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
