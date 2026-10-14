// Camera scanner: line the card up in the frame, tap the shutter, pick the match.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import { CardImage } from '../components/CardImage.tsx';
import { IconCamera, IconImage } from '../components/Icons.tsx';
import { identifyCard, type Candidate, type ScanGuess } from '../lib/match.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { href, navigate } from '../lib/router.ts';
import { useCatalog } from '../lib/useCatalog.ts';
import { captureFrame, photoToCard, scanCard, warmUpOcr } from '../scan/ocr.ts';

type Phase = 'starting' | 'live' | 'nocamera' | 'reading' | 'results';

export function ScanPanel() {
  const { catalog, error: catalogError } = useCatalog();
  const { ownedByCard } = useCollection();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [guess, setGuess] = useState<ScanGuess | null>(null);
  const [rawText, setRawText] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void startCamera();
    warmUpOcr().catch(() => undefined); // start downloading the OCR engine right away
    return stopCamera;
  }, [startCamera, stopCamera]);

  async function read(card: HTMLCanvasElement) {
    if (!catalog) return;
    setPhase('reading');
    setError(null);
    setPreview(card.toDataURL('image/jpeg', 0.85));
    stopCamera();
    try {
      const result = await scanCard(card, setProgress);
      setGuess(result.guess);
      setRawText(`${result.topText.trim()}
---
${result.bottomText.trim()}`);
      setCandidates(identifyCard(catalog, result.guess, 12));
      setPhase('results');
    } catch (err) {
      setError(`Couldn't read the card: ${(err as Error).message}`);
      setPhase('results');
      setCandidates([]);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      await read(await photoToCard(file));
    } catch (err) {
      setError((err as Error).message);
    }
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

  function scanAgain() {
    setGuess(null);
    setCandidates([]);
    setPreview(null);
    setError(null);
    void startCamera();
  }

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
            <div className="frame" ref={frame}>
              <span className="zone top">name</span>
              <span className="zone bottom">number</span>
            </div>
            {phase === 'starting' && <div className="vf-msg">Starting camera…</div>}
          </div>
          <p className="muted small center">Fill the frame with the card, keep it flat, and avoid glare.</p>
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

      {phase === 'results' && (
        <div className="results">
          <div className="read-summary">
            {preview && <img src={preview} alt="Captured card" className="scan-preview small" />}
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
          {error && <p className="error">{error}</p>}
          {rawText && (
            <details className="raw-ocr">
              <summary className="faint small">What the scanner saw</summary>
              <pre>{rawText}</pre>
            </details>
          )}
          {candidates.length > 0 ? (
            <>
              <h2>Which card is it?</h2>
              <p className="muted small">Tap the matching card to see its prices and add it — nothing is saved until you confirm.</p>
              <div className="grid">
                {candidates.map((c) => {
                  const owned = ownedCount(ownedByCard.get(c.card.id));
                  return (
                    <button key={c.card.id} className="tile as-button" onClick={() => navigate(`/card/${encodeURIComponent(c.card.id)}`)}>
                      <div className="tile-img">
                        <CardImage
                          base={c.card.image}
                          name={c.card.name}
                          subtitle={c.card.set.name}
                          setId={c.card.set.id}
                          number={c.card.number}
                        />
                        {owned > 0 && <span className="badge owned-badge">Owned ×{owned}</span>}
                      </div>
                      <div className="tile-body">
                        <div className="tile-name">{c.card.name}</div>
                        <div className="tile-meta">
                          {c.card.set.name} · #{cardNumberText(c.card.number, c.card.set.official)}
                        </div>
                        <div className="tile-meta faint">matched {c.why.join(' + ')}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="muted center">
              No matching cards. <a href={href('add')}>Search by name</a> instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
