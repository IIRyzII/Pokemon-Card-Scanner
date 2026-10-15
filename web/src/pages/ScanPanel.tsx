// Camera scanner: line the card up in the frame and auto-scan finds it (or tap the shutter), then pick the match.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import { CardImage } from '../components/CardImage.tsx';
import { IconCamera, IconImage } from '../components/Icons.tsx';
import { identifyCard, matchConfidence, type Candidate, type Confidence, type ScanGuess } from '../lib/match.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { href, navigate } from '../lib/router.ts';
import { useCatalog } from '../lib/useCatalog.ts';
import { captureFrame, photoToCard, scanCard, warmUpOcr, type ScanResult } from '../scan/ocr.ts';
import { markFound, useAutoScan, type AutoFound, type AutoStatus } from '../scan/useAutoScan.ts';

type Phase = 'starting' | 'live' | 'nocamera' | 'reading' | 'results';

interface Results {
  preview: string | null;
  guess: ScanGuess | null;
  rawText: string;
  candidates: Candidate[];
  confidence: Confidence | null;
  /** Found by auto-scan rather than the shutter or a photo */
  auto: boolean;
  error: string | null;
}

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

function statusText(auto: boolean, status: AutoStatus | null): string {
  if (!auto) return 'Fill the frame with the card, keep it flat and avoid glare, then press the button.';
  switch (status?.state) {
    case 'loading':
      return 'Getting the card reader ready…';
    case 'moving':
      return 'Hold the card steady…';
    case 'seen':
      return `Reading ${status.text}…`;
    case 'repeat':
      return `Already found ${status.name}. Show the next card, or press the button to read this one again.`;
    case 'failed':
      return "Auto-scan couldn't load the card reader. Check your connection, or press the button.";
    default:
      return 'Looking for a card. Fill the frame, keep it flat and avoid glare.';
  }
}

export function ScanPanel() {
  const { catalog, error: catalogError } = useCatalog();
  const { ownedByCard } = useCollection();
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
      const caps = s.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorch(caps?.torch ? false : null);
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

  function show(r: Results) {
    if (!mounted.current) return; // the read finished after leaving the scanner
    stopCamera();
    lastResults = r;
    markHistory(true);
    if (r.confidence) markFound(r.candidates[0].card.id);
    setResults(r);
    setPhase('results');
  }

  const autoStatus = useAutoScan({
    active: auto && phase === 'live',
    catalog,
    video,
    frame,
    onFound: ({ card, result, candidates }: AutoFound) => {
      navigator.vibrate?.(40);
      show({ preview: card.toDataURL('image/jpeg', 0.85), guess: result.guess, rawText: rawTextOf(result), candidates, confidence: 'sure', auto: true, error: null });
    },
  });

  async function read(card: HTMLCanvasElement) {
    if (!catalog) return;
    const shot = card.toDataURL('image/jpeg', 0.85);
    setPhase('reading');
    setPreview(shot);
    stopCamera();
    try {
      const result = await scanCard(card, { onProgress: setProgress });
      const candidates = identifyCard(catalog, result.guess, 12);
      const confidence = matchConfidence(result.guess, candidates);
      show({ preview: shot, guess: result.guess, rawText: rawTextOf(result), candidates, confidence, auto: false, error: null });
    } catch (err) {
      show({ preview: shot, guess: null, rawText: '', candidates: [], confidence: null, auto: false, error: `Couldn't read the card: ${(err as Error).message}` });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    let card: HTMLCanvasElement;
    try {
      card = await photoToCard(file);
    } catch (err) {
      show({ preview: null, guess: null, rawText: '', candidates: [], confidence: null, auto: false, error: `Couldn't open that photo: ${(err as Error).message}` });
      return;
    }
    await read(card);
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

  function scanAgain() {
    lastResults = null;
    markHistory(false);
    setResults(null);
    setPreview(null);
    void startCamera();
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
  const searchText = guess ? [guess.names[0], guess.number && guess.total ? `${guess.number}/${guess.total}` : guess.number].filter(Boolean).join(' ') : '';
  const scanning = !!autoStatus && autoStatus.state !== 'repeat' && autoStatus.state !== 'failed';
  const best = results?.confidence ? results.candidates[0] : null;
  const others = results ? (best ? results.candidates.slice(1) : results.candidates) : [];
  const owned = (c: Candidate) => ownedCount(ownedByCard.get(c.card.id));

  return (
    <div className="scan">
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
          <div className="viewfinder">
            <video ref={video} playsInline muted autoPlay />
            <div className={`frame${scanning ? ' auto' : ''}${autoStatus?.state === 'seen' ? ' seen' : ''}`} ref={frame}>
              <span className="zone top">name</span>
              <span className="zone bottom">number</span>
            </div>
            {phase === 'starting' && <div className="vf-msg">Starting camera…</div>}
          </div>
          <div className="scan-status">
            <button type="button" className={`auto-toggle${auto ? ' on' : ''}`} aria-pressed={auto} onClick={toggleAuto}>
              Auto-scan
            </button>
            <p className="muted small" aria-live="polite">
              {statusText(auto, autoStatus)}
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
              onClick={() => video.current && frame.current && void read(captureFrame(video.current, frame.current))}
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
              <div className="muted small">We read</div>
              <div>{readText || <span className="faint">nothing clear — try again closer, with less glare</span>}</div>
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
          {best && <BestMatch candidate={best} auto={results.auto} owned={owned(best)} />}
          {others.length > 0 && (
            <>
              <h2>{best ? 'Not it? Other matches' : 'Which card is it?'}</h2>
              {!best && <p className="muted small">Tap the matching card to see its prices and add it — nothing is saved until you confirm.</p>}
              <div className="grid">
                {others.map((c) => (
                  <MatchTile key={c.card.id} candidate={c} owned={owned(c)} />
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

/** The card the scanner is confident about, shown big with a way straight to its prices. */
function BestMatch({ candidate, auto, owned }: { candidate: Candidate; auto: boolean; owned: number }) {
  const { card } = candidate;
  const button = useRef<HTMLButtonElement>(null);
  // Found without a tap: move focus here so screen readers announce the card.
  useEffect(() => {
    if (auto) button.current?.focus({ preventScroll: true });
  }, [auto]);
  return (
    <section className={`best-match${auto ? ' auto' : ''}`}>
      <h2>{auto ? '✓ Found it' : 'Best match'}</h2>
      <button ref={button} className="best-card" onClick={() => openCard(card.id)}>
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
          <span className="btn primary small">See prices &amp; add</span>
        </div>
      </button>
      <p className="faint small">Matched {candidate.why.join(' + ')}. Nothing is saved until you confirm.</p>
    </section>
  );
}

function MatchTile({ candidate, owned }: { candidate: Candidate; owned: number }) {
  const { card } = candidate;
  return (
    <button className="tile as-button" onClick={() => openCard(card.id)}>
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
