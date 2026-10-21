// Camera scanner: show a card to the camera and auto-scan finds it (or tap the shutter), then pick the match.
// Scanning a stack, each card found goes in the scan list instead and the camera carries on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import { CardImage } from '../components/CardImage.tsx';
import { IconCamera, IconImage } from '../components/Icons.tsx';
import { defaultFields } from '../components/ItemForm.tsx';
import type { CatalogCard } from '../lib/catalog.ts';
import { useCurrency } from '../lib/currency.tsx';
import type { Candidate, Confidence, ScanGuess } from '../lib/match.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { href, navigate } from '../lib/router.ts';
import { copiesIn, listCardOf, scanList, setStackMode, stackMode, useLastAdded, useScanList } from '../lib/scanList.ts';
import { loadPrintIndex, useCatalog } from '../lib/useCatalog.ts';
import { findCard, locateCard, straightenCard, type Straightened } from '../scan/locate.ts';
import { captureFrame, centerCrop, loadPhoto, releaseCanvas, warmUpOcr, type ScanResult } from '../scan/ocr.ts';
import { readCard, type Reading } from '../scan/recognize.ts';
import { markFound, useAutoScan, type AutoStatus } from '../scan/useAutoScan.ts';

type Phase = 'starting' | 'live' | 'nocamera' | 'reading' | 'results';

interface Results {
  preview: string | null;
  guess: ScanGuess | null;
  rawText: string;
  candidates: Candidate[];
  confidence: Confidence | null;
  /** Found by auto-scan rather than the shutter or a photo */
  auto: boolean;
  /** The card's picture matched (the card was found in the photo and straightened) */
  byPicture: boolean;
  error: string | null;
}

const failed = (error: string): Results => ({ preview: null, guess: null, rawText: '', candidates: [], confidence: null, auto: false, byPicture: false, error });

// Kept so that going back from a card's page shows the same results instead of restarting the camera.
let lastResults: Results | null = null;
const resultsInHistory = () => (history.state as { scanResults?: boolean } | null)?.scanResults === true;
const markHistory = (scanResults: boolean) => history.replaceState({ ...(history.state as object | null), scanResults }, '');

const AUTO_KEY = 'pokevault.autoscan';

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

const rawTextOf = (r: ScanResult) => `${r.topText.trim()}
---
${r.bottomText.trim()}`;

const resultsOf = (reading: Reading, auto: boolean): Results => ({
  preview: reading.image.toDataURL('image/jpeg', 0.85),
  guess: reading.ocr?.guess ?? null,
  rawText: reading.ocr ? rawTextOf(reading.ocr) : '',
  candidates: reading.candidates,
  confidence: reading.confidence,
  auto,
  byPicture: !!reading.picture && !!reading.candidates[0]?.why.includes('picture'),
  error: null,
});

function statusText(auto: boolean, status: AutoStatus | null, stack: boolean): string {
  if (!auto) {
    return stack
      ? 'Show a card, keep it flat and avoid glare, then press the button to put it in the list.'
      : 'Show the card to the camera, keep it flat and avoid glare, then press the button.';
  }
  if (stack && status?.state === 'repeat') return `${status.name} is in the list. Show the next card.`;
  switch (status?.state) {
    case 'loading':
      return 'Getting the card reader ready…';
    case 'moving':
      return 'Hold the card steady…';
    case 'seen':
      return `Reading ${status.text}…`;
    case 'checking':
      return `Looks like ${status.name}. Hold it still a moment so the number can be read to tell which set it's from…`;
    case 'repeat':
      return `Already found ${status.name}. Show the next card, or press the button to read this one again.`;
    case 'failed':
      return "Auto-scan couldn't load the card reader. Check your connection, or press the button.";
    default:
      return stack
        ? 'Show the cards one at a time, flat and without glare.'
        : 'Looking for a card. Show it to the camera, keep it flat and avoid glare.';
  }
}

export function ScanPanel() {
  const { catalog, error: catalogError } = useCatalog();
  const { ownedByCard } = useCollection();
  const { currency } = useCurrency();
  const list = useScanList();
  const lastAdded = useLastAdded();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [restored] = useState(() => (resultsInHistory() ? lastResults : null));
  const [phase, setPhase] = useState<Phase>(restored ? 'results' : 'starting');
  const [results, setResults] = useState<Results | null>(restored);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [auto, setAuto] = useState(readAuto);
  const [stack, setStack] = useState(stackMode);

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setPhase('starting');
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(window.isSecureContext ? 'This browser has no camera access.' : 'The camera only works on an https:// page.');
      setPhase('nocamera');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      stream.current = s;
      const track = s.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }) | undefined;
      setTorch(caps?.torch ? false : null);
      // Keep refocusing as the card moves closer or further away (Android; iPhones do this anyway).
      if (caps?.focusMode?.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
      }
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setPhase('live');
    } catch (err) {
      const name = (err as DOMException).name;
      setCameraError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings, or upload a photo instead.'
          : 'No camera could be started. You can upload a photo instead.',
      );
      setPhase('nocamera');
    }
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (!restored) void startCamera();
    warmUpOcr().catch(() => undefined); // start downloading the OCR engine right away
    return () => {
      mounted.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera, restored]);

  /** Scanning a stack: puts the card in the list. (Nothing is saved until the list is added.) */
  function addToList(card: CatalogCard) {
    scanList.add(listCardOf(card), defaultFields([], currency));
    markFound(card.id);
    navigator.vibrate?.(40);
  }

  function show(r: Results) {
    if (!mounted.current) return; // the read finished after leaving the scanner
    if (stack && r.confidence === 'sure') {
      // Certain: straight into the list, and on to the next card.
      addToList(r.candidates[0].card);
      void startCamera();
      return;
    }
    stopCamera();
    lastResults = r;
    markHistory(true);
    if (r.confidence) markFound(r.candidates[0].card.id);
    setResults(r);
    setPhase('results');
  }

  const { status: autoStatus, outline } = useAutoScan({
    active: auto && phase === 'live',
    catalog,
    video,
    frame,
    onFound: (reading) => {
      if (stack) return addToList(reading.candidates[0].card); // the camera carries on
      navigator.vibrate?.(40);
      show(resultsOf(reading, true));
    },
    keepGoing: stack,
  });

  /** Reads a card (straightened, or a plain crop when it couldn't be found) and shows what it is. */
  async function readAndShow(card: Straightened | HTMLCanvasElement) {
    if (!catalog) return;
    const image = card instanceof HTMLCanvasElement ? card : card.canvas;
    setPreview(image.toDataURL('image/jpeg', 0.85));
    setProgress('');
    setPhase('reading');
    stopCamera();
    try {
      const reading = await readCard({ catalog, index: await loadPrintIndex(), card, onProgress: setProgress });
      show(resultsOf(reading, false));
      releaseCanvas(reading.image);
    } catch (err) {
      show(failed(`Couldn't read the card: ${(err as Error).message}`));
      releaseCanvas(image);
    }
  }

  /** The shutter: find the card in the current frame (or fall back to the guide frame) and read it. */
  function shutter() {
    const v = video.current;
    const f = frame.current;
    if (!v || !f) return;
    const found = locateCard(v);
    void readAndShow(found ? straightenCard(v, v.videoWidth, v.videoHeight, found.corners) : captureFrame(v, f));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    let card: Straightened | HTMLCanvasElement;
    try {
      const photo = await loadPhoto(file);
      const found = findCard(photo, { x: 0, y: 0, w: photo.width, h: photo.height });
      card = found ? straightenCard(photo, photo.width, photo.height, found.corners) : centerCrop(photo);
      releaseCanvas(photo);
    } catch (err) {
      show(failed(`Couldn't open that photo: ${(err as Error).message}`));
      return;
    }
    await readAndShow(card);
  }

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  }

  function toggleAuto() {
    const on = !auto;
    setAuto(on);
    try {
      localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
    } catch {
      // ignore
    }
  }

  function chooseStack(on: boolean) {
    setStack(on);
    setStackMode(on);
  }

  function scanAgain() {
    lastResults = null;
    markHistory(false);
    setResults(null);
    setPreview(null);
    void startCamera();
  }

  /** A match was tapped: its page (to see prices and add it), or when scanning a stack, into the list. */
  function pick(card: CatalogCard) {
    if (!stack) return openCard(card.id);
    addToList(card);
    scanAgain();
  }

  const guess = results?.guess;
  const readText = guess
    ? [
        guess.names[0],
        guess.hp && `${guess.hp} HP`,
        guess.number && (guess.total ? `${guess.number}/${guess.total}` : guess.number),
        guess.setCode,
        guess.artist,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const searchText = guess
    ? [guess.names[0], guess.number && guess.total ? `${guess.number}/${guess.total}` : guess.number].filter(Boolean).join(' ')
    : (results?.candidates[0]?.card.name ?? ''); // recognised by its picture: search that card's printings
  const scanning = !!autoStatus && autoStatus.state !== 'repeat' && autoStatus.state !== 'failed';
  const best = results?.confidence ? results.candidates[0] : null;
  const others = results ? (best ? results.candidates.slice(1) : results.candidates) : [];
  const owned = (c: Candidate) => ownedCount(ownedByCard.get(c.card.id));
  const inList = copiesIn(list);
  const lastEntry = lastAdded && list.find((e) => e.key === lastAdded.key);

  return (
    <div className={`scan${stack ? ' stacking' : ''}`}>
      {catalogError && <p className="error">{catalogError}</p>}
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

      {(phase === 'starting' || phase === 'live') && (
        <>
          <div className="segmented small scan-mode" role="group" aria-label="What to scan">
            <button type="button" className={!stack ? 'on' : ''} aria-pressed={!stack} onClick={() => chooseStack(false)}>
              One card
            </button>
            <button type="button" className={stack ? 'on' : ''} aria-pressed={stack} onClick={() => chooseStack(true)}>
              Stack of cards
            </button>
          </div>
          <div className={`viewfinder${outline ? ' has-card' : ''}`}>
            <video ref={video} playsInline muted autoPlay />
            <div className={`frame${scanning ? ' auto' : ''}${autoStatus?.state === 'seen' ? ' seen' : ''}`} ref={frame}>
              <span className="zone top">name</span>
              <span className="zone bottom">number</span>
            </div>
            {outline && (
              <svg className={`card-outline${outline.steady ? ' steady' : ''}`} aria-hidden="true">
                <polygon points={outline.points.map((p) => `${p.x},${p.y}`).join(' ')} />
              </svg>
            )}
            {phase === 'starting' && <div className="vf-msg">Starting camera…</div>}
          </div>
          {stack && (
            <div className="stack-bar">
              <div className="stack-last" aria-live="polite">
                {lastEntry ? (
                  <>
                    <span className="stack-name">
                      ✓ {lastAdded?.more ? 'Another' : 'Added'} <strong>{lastEntry.card.name}</strong>
                      <span className="faint">
                        {' '}
                        · {lastEntry.card.setName} #{cardNumberText(lastEntry.card.number, lastEntry.card.setTotal)}
                      </span>
                    </span>
                    <button type="button" className="link" onClick={() => scanList.undo()}>
                      Undo
                    </button>
                  </>
                ) : (
                  <span className="muted small">{inList ? 'Show the next card.' : 'Each card found goes in the list.'}</span>
                )}
              </div>
              {inList > 0 && (
                <a className="btn small primary" href={href('add', 'list')}>
                  List · {inList} →
                </a>
              )}
            </div>
          )}
          <div className="scan-status">
            <button type="button" className={`auto-toggle${auto ? ' on' : ''}`} aria-pressed={auto} onClick={toggleAuto}>
              Auto-scan
            </button>
            <p className="muted small" aria-live="polite">
              {statusText(auto, autoStatus, stack)}
            </p>
          </div>
          <div className="scan-controls">
            <button className="btn" onClick={() => fileInput.current?.click()}>
              <IconImage /> Photo
            </button>
            <button
              className="shutter"
              aria-label="Capture card"
              disabled={phase !== 'live' || !catalog}
              onClick={shutter}
            >
              <IconCamera />
            </button>
            {torch !== null ? (
              <button className={`btn ${torch ? 'on' : ''}`} onClick={toggleTorch}>
                💡 Light
              </button>
            ) : (
              <span className="spacer" />
            )}
          </div>
        </>
      )}

      {phase === 'nocamera' && (
        <div className="empty">
          <p>{cameraError}</p>
          <button className="btn primary" onClick={() => fileInput.current?.click()}>
            <IconImage /> Take or upload a photo
          </button>{' '}
          <button className="btn" onClick={() => void startCamera()}>
            Try the camera again
          </button>
        </div>
      )}

      {phase === 'reading' && (
        <div className="reading">
          {preview && <img src={preview} alt="Captured card" className="scan-preview" />}
          <div className="spinner" />
          <p className="muted">{progress || 'Reading the card…'}</p>
        </div>
      )}

      {phase === 'results' && results && (
        <div className="results">
          <div className="read-summary">
            {results.preview && <img src={results.preview} alt="Captured card" className="scan-preview small" />}
            <div>
              <div className="muted small">{results.byPicture && !readText ? 'Recognised' : 'We read'}</div>
              <div>
                {readText ||
                  (results.byPicture ? 'by its picture' : <span className="faint">nothing clear — try again closer, with less glare</span>)}
              </div>
              <div className="actions">
                <button className="btn primary small" onClick={scanAgain}>
                  Scan again
                </button>
                <a className="btn small" href={`#/add?q=${encodeURIComponent(searchText)}`}>
                  Search instead
                </a>
              </div>
            </div>
          </div>
          {results.error && <p className="error">{results.error}</p>}
          {results.rawText && (
            <details className="raw-ocr">
              <summary className="faint small">What the scanner saw</summary>
              <pre>{results.rawText}</pre>
            </details>
          )}
          {best && <BestMatch candidate={best} auto={results.auto} owned={owned(best)} stack={stack} onPick={pick} />}
          {others.length > 0 && (
            <>
              <h2>{best ? 'Not it? Other matches' : 'Which card is it?'}</h2>
              {!best && (
                <p className="muted small">
                  {stack
                    ? 'Tap the matching card to put it in the list.'
                    : 'Tap the matching card to see its prices and add it — nothing is saved until you confirm.'}
                </p>
              )}
              <div className="grid">
                {others.map((c) => (
                  <MatchTile key={c.card.id} candidate={c} owned={owned(c)} onPick={pick} />
                ))}
              </div>
            </>
          )}
          {!results.candidates.length && (
            <p className="muted center">
              No matching cards. <a href={href('add')}>Search by name</a> instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const openCard = (id: string) => navigate(`/card/${encodeURIComponent(id)}`);

interface PickProps {
  candidate: Candidate;
  owned: number;
  onPick: (card: CatalogCard) => void;
}

/** The card the scanner is confident about, shown big with a way straight to its prices (or into the list). */
function BestMatch({ candidate, auto, owned, stack, onPick }: PickProps & { auto: boolean; stack: boolean }) {
  const { card } = candidate;
  const button = useRef<HTMLButtonElement>(null);
  // Found without a tap: move focus here so screen readers announce the card.
  useEffect(() => {
    if (auto) button.current?.focus({ preventScroll: true });
  }, [auto]);
  return (
    <section className={`best-match${auto ? ' auto' : ''}`}>
      <h2>{auto ? '✓ Found it' : 'Best match'}</h2>
      <button ref={button} className="best-card" onClick={() => onPick(card)}>
        <div className="tile-img">
          <CardImage base={card.image} name={card.name} subtitle={card.set.name} setId={card.set.id} number={card.number} eager />
          {owned > 0 && <span className="badge owned-badge">Owned ×{owned}</span>}
        </div>
        <div className="best-info">
          <div className="best-name">{card.name}</div>
          <div>{card.set.name}</div>
          <div className="muted">
            #{cardNumberText(card.number, card.set.official)}
            {card.rarity && ` · ${card.rarity}`}
          </div>
          {card.artist && <div className="faint small">🖌 {card.artist}</div>}
          <span className="btn primary small">{stack ? 'Add to list' : 'See prices & add'}</span>
        </div>
      </button>
      <p className="faint small">
        Matched {candidate.why.join(' + ')}. Nothing is saved until you {stack ? 'add the list' : 'confirm'}.
      </p>
    </section>
  );
}

function MatchTile({ candidate, owned, onPick }: PickProps) {
  const { card } = candidate;
  return (
    <button className="tile as-button" onClick={() => onPick(card)}>
      <div className="tile-img">
        <CardImage base={card.image} name={card.name} subtitle={card.set.name} setId={card.set.id} number={card.number} />
        {owned > 0 && <span className="badge owned-badge">Owned ×{owned}</span>}
      </div>
      <div className="tile-body">
        <div className="tile-name">{card.name}</div>
        <div className="tile-meta">
          {card.set.name} · #{cardNumberText(card.number, card.set.official)}
        </div>
        <div className="tile-meta faint">matched {candidate.why.join(' + ')}</div>
      </div>
    </button>
  );
}
