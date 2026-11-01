// The grade check: photograph a card's front (and back), measure how well it's centred and look for
// white wear on its edges, answer what a photo can't show, and see the best PSA grade it could get
// and whether grading would pay. A guide, not a grade.

import { useEffect, useRef, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import type { CardDetailResponse } from '../../../shared/types.ts';
import { valueItem } from '../../../shared/values.ts';
import { api } from '../lib/api.ts';
import { allPrintingsOf } from '../lib/binders.ts';
import type { CatalogCard } from '../lib/catalog.ts';
import { useCurrency } from '../lib/currency.tsx';
import { money } from '../lib/format.ts';
import {
  centeringVerdict,
  estimateGrade,
  gradesToCompare,
  gradingOutcomes,
  psaText,
  PSA_STANDARDS_URL,
  QUESTIONS,
  type Answers,
  type Aspect,
  type CenteringVerdict,
  type FaceCentering,
} from '../lib/gradeCheck.ts';
import type { PictureLook, PrintIndex } from '../lib/pictures.ts';
import { href } from '../lib/router.ts';
import { loadPrintIndex } from '../lib/useCatalog.ts';
import { useBackCamera } from '../scan/camera.ts';
import {
  AXIS_SIDES,
  centering,
  CORNERS,
  edgeWear,
  measureBorders,
  ratioText,
  sideSegments,
  SIDES,
  wearLevel,
  type Axis,
  type Centering,
  type CornerName,
  type Lines,
  type Measured,
  type Padded,
  type SideName,
  type Spots,
  type Wear,
} from '../scan/condition.ts';
import type { Point } from '../scan/detect.ts';
import { findCard, smallCard, straightenForMeasuring, toCanvas } from '../scan/locate.ts';
import { frameCrop, loadPhoto, releaseCanvas } from '../scan/ocr.ts';
import { matchPicture } from '../scan/recognize.ts';
import { rotate180 } from '../scan/warp.ts';
import { variantLabel } from './CardTile.tsx';
import { IconCamera, IconImage } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';

type Face = 'front' | 'back';

interface Shot {
  face: Face;
  padded: Padded;
  /** The straightened picture, to show */
  image: string;
  measured: Measured;
  /** The lines as measured, or as moved by hand */
  lines: Lines;
  /** Sides whose lines were moved by hand */
  moved: Record<SideName, boolean>;
  wear: Wear | null;
}

const NOT_MOVED: Record<SideName, boolean> = { left: false, right: false, top: false, bottom: false };
const SIDE_NAMES: Record<SideName, string> = { left: 'left', right: 'right', top: 'top', bottom: 'bottom' };
const CORNER_NAMES: Record<CornerName, string> = { topLeft: 'Top left', topRight: 'Top right', bottomRight: 'Bottom right', bottomLeft: 'Bottom left' };
const AXIS_NAMES: Record<Axis, string> = { leftRight: 'Left to right', topBottom: 'Top to bottom' };

/** Lets "Measuring…" show before the work starts. */
const painted = () => new Promise((r) => setTimeout(r, 60));

/** The guide's part of the camera picture and this much more each side, so the card's edges and some background are in it. */
function captureAround(video: HTMLVideoElement, guide: HTMLElement, extra = 0.15): HTMLCanvasElement {
  const { sx, sy, sw, sh } = frameCrop(video, guide);
  const x0 = Math.max(0, sx - sw * extra);
  const y0 = Math.max(0, sy - sh * extra);
  const x1 = Math.min(video.videoWidth, sx + sw * (1 + extra));
  const y1 = Math.min(video.videoHeight, sy + sh * (1 + extra));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(x1 - x0);
  canvas.height = Math.round(y1 - y0);
  canvas.getContext('2d')!.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Finds the card in a photo, straightens it the right way up and measures it; or what went wrong. */
function measurePhoto(photo: HTMLCanvasElement, face: Face, index: PrintIndex | null): { shot: Shot; look: PictureLook | null } | string {
  const found = findCard(photo, { x: 0, y: 0, w: photo.width, h: photo.height });
  if (!found) return "Couldn't find the card's edges. Lay it on a plain, dark surface, fill the outline with it, and try again.";
  let padded = straightenForMeasuring(photo, photo.width, photo.height, found.corners);
  let look: PictureLook | null = null;
  if (face === 'front' && index) {
    look = matchPicture(index, smallCard(found));
    if (look.flipped) padded = { ...padded, img: rotate180(padded.img) }; // held upside down
  }
  const measured = measureBorders(padded);
  const canvas = toCanvas(padded.img);
  const image = canvas.toDataURL('image/jpeg', 0.9);
  releaseCanvas(canvas);
  return { shot: { face, padded, image, measured, lines: measured.lines, moved: NOT_MOVED, wear: face === 'back' ? edgeWear(padded, measured) : null }, look };
}

/** A side counts as measured if it was, or its lines were placed by hand. */
const usable = (shot: Shot, side: SideName) => shot.moved[side] || shot.measured.quality[side] !== null;

/** How well centred a shot is across each axis, and overall (the worse axis, once both are measured). */
function centringOf(shot: Shot): { axes: Record<Axis, Centering | null>; face: FaceCentering | null } {
  const quality = Object.fromEntries(SIDES.map((s) => [s, shot.moved[s] ? null : shot.measured.quality[s]])) as Measured['quality'];
  const axis = (a: Axis) => (AXIS_SIDES[a].every((s) => usable(shot, s)) ? centering(shot.lines, quality, shot.padded.scale, a) : null);
  const axes = { leftRight: axis('leftRight'), topBottom: axis('topBottom') };
  const worst = axes.leftRight && axes.topBottom ? (axes.leftRight.share >= axes.topBottom.share ? axes.leftRight : axes.topBottom) : null;
  return { axes, face: worst && { share: worst.share, error: worst.error } };
}

/** The edges answer a photo of the back suggests (never worse than wear seen only up close: the rest is the owner's call). */
function suggestEdges(wear: Wear | null): number | undefined {
  if (!wear || wear.problem) return undefined;
  const all = [...Object.values(wear.edges), ...Object.values(wear.corners)];
  if (all.some((s) => s === null)) return undefined;
  const marked = (all as Spots[]).filter((s) => s.count > 0);
  if (!marked.length) return 0;
  return marked.length <= 2 && marked.every((s) => wearLevel(s) === 'specks') ? 1 : 2;
}

// ---------- the camera ----------

function CardCamera({ face, onPhoto }: { face: Face; onPhoto: (photo: HTMLCanvasElement) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const guide = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const cameraError = useBackCamera(video, 2560, 1440) ?? photoError;
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
          if (file) loadPhoto(file, 3000).then(onPhoto, () => setPhotoError("That photo couldn't be opened."));
        }}
      />
      <p className="muted small center">
        <b>The {face}.</b> Out of its sleeve, on a plain dark surface, filling the outline. Hold the phone straight above it, away from glare.
      </p>
      <div className="viewfinder gc-viewfinder">
        <video ref={video} playsInline muted autoPlay />
        <div className="frame gc-frame" ref={guide} />
        {cameraError && <div className="vf-msg">{cameraError}</div>}
      </div>
      <div className="scan-controls">
        <button className="btn" onClick={() => fileInput.current?.click()}>
          <IconImage /> Photo
        </button>
        <button
          className="shutter"
          aria-label={`Take the photo of the ${face}`}
          disabled={!!cameraError}
          onClick={() => video.current?.videoWidth && guide.current && onPhoto(captureAround(video.current, guide.current))}
        >
          <IconCamera />
        </button>
        <span className="spacer" />
      </div>
    </>
  );
}

// ---------- a measured photo ----------

/** The lines over a straightened picture (and white spots found, circled). */
function LinesOver({ shot, only, spots }: { shot: Shot; only?: SideName; spots?: Point[] }) {
  const r = 0.7 * shot.padded.scale;
  return (
    <>
      {SIDES.filter((s) => !only || s === only).map((side) => {
        const seg = sideSegments(shot.padded, shot.lines[side], side);
        const unsure = !usable(shot, side) || (shot.measured.uneven && !shot.moved[side]);
        return (
          <g key={side} className={unsure ? 'unsure' : ''}>
            <line className="gc-outer" x1={seg.outer[0].x} y1={seg.outer[0].y} x2={seg.outer[1].x} y2={seg.outer[1].y} />
            <line className="gc-inner" x1={seg.inner[0].x} y1={seg.inner[0].y} x2={seg.inner[1].x} y2={seg.inner[1].y} />
          </g>
        );
      })}
      {spots?.map((p, i) => <circle key={i} className="gc-spot" cx={p.x} cy={p.y} r={r} />)}
    </>
  );
}

const spotsOf = (wear: Wear | null): Point[] =>
  wear ? [...Object.values(wear.edges), ...Object.values(wear.corners)].flatMap((s) => s?.at ?? []) : [];

/** Part of the straightened picture, magnified, with the lines over it. */
function Zoom({ shot, region, only, label, spots }: { shot: Shot; region: { x: number; y: number; w: number; h: number }; only?: SideName; label: string; spots?: Point[] }) {
  const { width, height } = shot.padded.img;
  return (
    <svg className="gc-zoom" viewBox={`${region.x} ${region.y} ${region.w} ${region.h}`} role="img" aria-label={label} style={{ aspectRatio: `${region.w} / ${region.h}` }}>
      <image href={shot.image} x={0} y={0} width={width} height={height} preserveAspectRatio="none" />
      <LinesOver shot={shot} only={only} spots={spots} />
    </svg>
  );
}

/** The middle of one side, across its border: where its lines are adjusted. */
function sideRegion(p: Padded, side: SideName) {
  const { width: W, height: H } = p.img;
  const across = p.pad + 7 * p.scale;
  if (side === 'left' || side === 'right') {
    const along = 8 * p.scale;
    return { x: side === 'left' ? 0 : W - across, y: H / 2 - along / 2, w: across, h: along };
  }
  const along = 14 * p.scale;
  return { x: W / 2 - along / 2, y: side === 'top' ? 0 : H - across, w: along, h: across };
}

/** A corner of the card, 6 mm square. */
function cornerRegion(shot: Shot, corner: CornerName) {
  const { scale } = shot.padded;
  const { width: W, height: H } = shot.padded.img;
  const left = corner === 'topLeft' || corner === 'bottomLeft';
  const top = corner === 'topLeft' || corner === 'topRight';
  const size = 6 * scale;
  const v = shot.lines[left ? 'left' : 'right'].outer[top ? 0 : 1];
  const h = shot.lines[top ? 'top' : 'bottom'].outer[left ? 0 : 1];
  const x = left ? v - scale : W - v - size + scale;
  const y = top ? h - scale : H - h - size + scale;
  return { x, y, w: size, h: size };
}

function AxisLine({ axis, c }: { axis: Axis; c: Centering | null }) {
  if (!c) return <li>{AXIS_NAMES[axis]}: not measured. Adjust the lines to measure it.</li>;
  const even = c.share < 50.5;
  return (
    <li>
      {AXIS_NAMES[axis]}: <b>{ratioText(c.share)}</b> <span className="faint">±{Math.ceil(c.error)}</span>
      {!even && <span className="muted">, wider at the {SIDE_NAMES[c.wider]}</span>}
      <span className="faint small">
        {' '}
        ({c.widths[0].toFixed(1)} and {c.widths[1].toFixed(1)} mm at its most off-centre)
      </span>
    </li>
  );
}

function ShotPanel({ shot, onChange, onRetake }: { shot: Shot; onChange: (s: Shot) => void; onRetake: () => void }) {
  const [adjusting, setAdjusting] = useState(false);
  const [side, setSide] = useState<SideName>('left');
  const { axes, face } = centringOf(shot);
  const verdict = face && (shot.face === 'front' ? centeringVerdict(face, null) : centeringVerdict(null, face));
  const missing = SIDES.filter((s) => !usable(shot, s));
  const { width, height } = shot.padded.img;
  const step = Math.max(1, Math.round(shot.padded.scale / 10)); // a tenth of a millimetre

  function setLines(lines: Lines, moved: Record<SideName, boolean>) {
    const measured = { ...shot.measured, lines };
    onChange({ ...shot, lines, moved, wear: shot.face === 'back' ? edgeWear(shot.padded, measured) : null });
  }
  function nudge(which: 'outer' | 'inner', by: number) {
    const l = shot.lines[side];
    setLines({ ...shot.lines, [side]: { ...l, [which]: [l[which][0] + by, l[which][1] + by] } }, { ...shot.moved, [side]: true });
  }
  const moved = SIDES.some((s) => shot.moved[s]);

  return (
    <section className="gc-shot">
      <div className="section-head">
        <h3>{shot.face === 'front' ? 'Front' : 'Back'}</h3>
        <button className="btn small" onClick={onRetake}>
          Retake
        </button>
      </div>
      <div className="gc-shot-body">
        <div className="gc-photo" style={{ aspectRatio: `${width} / ${height}` }}>
          <img src={shot.image} alt={`Your photo of the ${shot.face}, straightened`} />
          <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            <LinesOver shot={shot} spots={spotsOf(shot.wear)} />
          </svg>
        </div>
        <div className="gc-shot-info">
          <ul className="gc-axes">
            <AxisLine axis="leftRight" c={axes.leftRight} />
            <AxisLine axis="topBottom" c={axes.topBottom} />
          </ul>
          {verdict && (
            <p className="small">
              Centering allows up to <b>{psaText(verdict.grade)}</b>
              {verdict.leeway ? `, or ${psaText(verdict.leeway)} within PSA's leeway` : ''}.
            </p>
          )}
          {missing.length > 0 && (
            <p className="note small">
              Couldn't find the inner edge of the {missing.map((s) => SIDE_NAMES[s]).join(', ')} border{missing.length > 1 ? 's' : ''}. Move the dashed lines onto it.
            </p>
          )}
          {shot.measured.uneven && !missing.length && !moved && (
            <p className="note small">The borders across and down don't add up alike, so a line may be in the wrong place. Check the pink lines sit where each border ends.</p>
          )}
          <p className="faint small">White lines: the card's edges. Pink: where each border ends.</p>
          <button className={`btn small${adjusting ? ' on' : ''}`} aria-pressed={adjusting} onClick={() => setAdjusting(!adjusting)}>
            {adjusting ? 'Done adjusting' : 'Adjust the lines'}
          </button>
        </div>
      </div>
      {adjusting && (
        <div className="gc-adjust">
          <div className="segmented small" role="group" aria-label="Side to adjust">
            {SIDES.map((s) => (
              <button key={s} type="button" className={s === side ? 'on' : ''} aria-pressed={s === side} onClick={() => setSide(s)}>
                {SIDE_NAMES[s][0].toUpperCase() + SIDE_NAMES[s].slice(1)}
              </button>
            ))}
          </div>
          <Zoom shot={shot} region={sideRegion(shot.padded, side)} only={side} label={`The ${side} border, magnified`} />
          {(['outer', 'inner'] as const).map((which) => (
            <div key={which} className="gc-nudge">
              <span>{which === 'outer' ? 'Card edge' : 'Border ends'}</span>
              <button className="btn small" aria-label={`Move the ${side} ${which === 'outer' ? 'card edge' : 'border end'} line outwards`} onClick={() => nudge(which, -step)}>
                ‹ Out
              </button>
              <button className="btn small" aria-label={`Move the ${side} ${which === 'outer' ? 'card edge' : 'border end'} line inwards`} onClick={() => nudge(which, step)}>
                In ›
              </button>
            </div>
          ))}
          {moved && (
            <button className="link small" onClick={() => setLines(shot.measured.lines, NOT_MOVED)}>
              Put the lines back as measured
            </button>
          )}
        </div>
      )}
      {shot.wear && <WearPanel shot={shot} wear={shot.wear} />}
    </section>
  );
}

const WEAR_PROBLEMS: Record<NonNullable<Wear['problem']>, string> = {
  background: "Edges not checked: the surface round the card is too light. Put it on something dark to check for white wear.",
  blurry: 'Edges not checked: the photo is a little blurred. Retake it, holding the phone still.',
  edges: "Edges not checked: the card's edges couldn't all be found.",
};

function spotText(s: Spots | null): string {
  if (!s) return 'not checked (glare)';
  const level = wearLevel(s);
  return level === 'clean' ? 'clean' : `${s.count} white ${s.count === 1 ? 'spot' : 'spots'}${level === 'worn' ? ' (wear)' : ''}`;
}

function WearPanel({ shot, wear }: { shot: Shot; wear: Wear }) {
  const spots = spotsOf(wear);
  return (
    <div className="gc-wear">
      <h4>White wear</h4>
      {wear.problem ? (
        <p className="note small">{WEAR_PROBLEMS[wear.problem]}</p>
      ) : (
        <>
          <ul className="gc-wear-list small">
            {SIDES.map((s) => (
              <li key={s} className={wear.edges[s]?.count ? 'marked' : ''}>
                {SIDE_NAMES[s][0].toUpperCase() + SIDE_NAMES[s].slice(1)} edge: {spotText(wear.edges[s])}
              </li>
            ))}
            {CORNERS.map((c) => (
              <li key={c} className={wear.corners[c]?.count ? 'marked' : ''}>
                {CORNER_NAMES[c]} corner: {spotText(wear.corners[c])}
              </li>
            ))}
          </ul>
          <p className="faint small">A rough check of the very edge of the card, circled in red. Look at each corner closely yourself too.</p>
        </>
      )}
      <div className="gc-corners">
        {CORNERS.map((c) => (
          <figure key={c}>
            <Zoom shot={shot} region={cornerRegion(shot, c)} label={`${CORNER_NAMES[c]} corner, magnified`} spots={spots} />
            <figcaption className="faint small">{CORNER_NAMES[c]}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

// ---------- what a photo can't judge ----------

function Questions({ answers, suggested, onAnswer }: { answers: Answers; suggested: Answers; onAnswer: (aspect: Aspect, choice: number) => void }) {
  return (
    <section className="gc-questions">
      <h3>What a photo can't judge</h3>
      {QUESTIONS.map((q) => {
        const picked = answers[q.aspect];
        return (
          <fieldset key={q.aspect} className="gc-question">
            <legend>{q.title}</legend>
            <p className="faint small">{q.how}</p>
            {q.choices.map((c, i) => (
              <label key={i} className={picked === i ? 'on' : ''}>
                <input type="radio" name={`gc-${q.aspect}`} checked={picked === i} onChange={() => onAnswer(q.aspect, i)} />
                <span>
                  {c.label}
                  {suggested[q.aspect] === i && <span className="faint"> · what the photo of the back suggests</span>}
                </span>
              </label>
            ))}
            {picked !== undefined && <p className="faint small">{q.choices[picked].basis}</p>}
          </fieldset>
        );
      })}
    </section>
  );
}

const listText = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function EstimatePanel({ verdict, answers, measured }: { verdict: CenteringVerdict | null; answers: Answers; measured: { front: boolean; back: boolean } }) {
  const estimate = estimateGrade(verdict, answers);
  const notYet = [...(!measured.front ? ['the front'] : []), ...(!measured.back ? ['the back'] : []), ...estimate.unanswered.map((a) => QUESTIONS.find((q) => q.aspect === a)!.title.toLowerCase())];
  return (
    <section className="gc-estimate" aria-live="polite">
      <h3>Best grade it could get</h3>
      <div className="gc-grade">{psaText(estimate.best)}</div>
      {estimate.limits.length > 0 && <p className="small">Held there by its {listText(estimate.limits)}.</p>}
      {verdict?.leeway && estimate.limits.length === 1 && estimate.limits[0] === 'centering' && (
        <p className="small">PSA allows 5% more on the front for grades of 7 and up, at the grader's discretion for a card that looks good: that could make it {psaText(verdict.leeway)}.</p>
      )}
      {verdict?.close && <p className="small">Its centering is close to a limit, so a grader's measurement could put it a grade either side.</p>}
      {notYet.length > 0 && <p className="faint small">Not checked yet: {listText(notYet)}. This assumes nothing wrong there.</p>}
      <p className="faint small">A guide, not a grade: PSA judges the whole card by eye, and may see what a photo can't.</p>
    </section>
  );
}

// ---------- is it worth grading? ----------

const COST_KEY = 'pokevault.gradingCost';

function readCost(): { amount: number; currency: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(COST_KEY) ?? 'null') as { amount?: unknown; currency?: unknown } | null;
    return v && typeof v.amount === 'number' && typeof v.currency === 'string' ? { amount: v.amount, currency: v.currency } : null;
  } catch {
    return null;
  }
}

const signed = (amount: number, currency: string) => `${amount < 0 ? '−' : '+'}${money(Math.abs(amount), currency)}`;

/** `leeway`: a better grade than the estimate that PSA's front leeway could give, compared too. */
function WorthGrading({ card, grades, leeway }: { card: CatalogCard; grades: number[]; leeway: number | null }) {
  const { ctx, currency, convert } = useCurrency();
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const printings = allPrintingsOf(card);
  const [variant, setVariant] = useState(printings.find((v) => v !== 'reverse') ?? printings[0] ?? 'normal');
  const [saved, setSaved] = useState(readCost);
  const cost = saved ? convert(saved.amount, saved.currency) : null;

  useEffect(() => {
    let gone = false;
    setDetail(null);
    setFailed(false);
    api.card(card.id).then(
      (d) => !gone && setDetail(d),
      () => !gone && setFailed(true),
    );
    return () => {
      gone = true;
    };
  }, [card.id]);

  function saveCost(text: string) {
    const amount = Number(text);
    const next = text.trim() !== '' && Number.isFinite(amount) && amount >= 0 ? { amount, currency } : null;
    setSaved(next);
    try {
      if (next) localStorage.setItem(COST_KEY, JSON.stringify(next));
      else localStorage.removeItem(COST_KEY);
    } catch {
      // remembered for this visit only
    }
  }

  const raw = detail ? valueItem({ variant, grader: 'RAW', grade: null, gradeLabel: null }, detail.prices, detail.sales, ctx) : null;
  const outcomes = detail
    ? gradingOutcomes(grades, raw?.unit ?? null, (g) => valueItem({ variant, grader: 'PSA', grade: g, gradeLabel: null }, detail.prices, detail.sales, ctx).unit, cost)
    : [];
  return (
    <section className="gc-worth">
      <h3>Is it worth grading?</h3>
      {printings.length > 1 && (
        <label className="gc-field">
          Printing{' '}
          <select value={variant} onChange={(e) => setVariant(e.target.value)}>
            {printings.map((v) => (
              <option key={v} value={v}>
                {variantLabel(v)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="gc-field">
        Cost to grade it, {currency}{' '}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.5"
          defaultValue={cost === null ? '' : String(Math.round(cost * 100) / 100)}
          onChange={(e) => saveCost(e.target.value)}
        />
      </label>
      <p className="faint small">The grader's fee for your service level, plus postage and insurance both ways.</p>
      {failed && <p className="faint small">Prices couldn't be loaded.</p>}
      {!detail && !failed && <div className="spinner" aria-label="Loading prices" />}
      {detail && (
        <>
          <p className="small">
            Raw: <b>{raw?.unit === null || !raw ? 'no price yet' : money(raw.unit, ctx.currency)}</b> {raw?.unit !== null && raw && <span className="faint">· {raw.detail}</span>}
          </p>
          {outcomes.some((o) => o.value !== null) ? (
            <div className="table-wrap">
              <table className="price-table">
                <thead>
                  <tr>
                    <th>If it gets</th>
                    <th>Worth</th>
                    <th>{cost === null ? 'Over raw' : 'Over raw, less the cost'}</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.map((o) => (
                    <tr key={o.grade}>
                      <td>
                        {psaText(o.grade)}
                        {o.grade === leeway && <div className="faint small">within PSA's leeway</div>}
                      </td>
                      <td>{o.value === null ? '—' : money(o.value, ctx.currency)}</td>
                      <td className={o.gain === null ? '' : o.gain >= 0 ? 'gc-gain' : 'gc-loss'}>{o.gain === null ? '—' : signed(o.gain, ctx.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="faint small">
              No graded prices for this card yet. Log a few sold slabs on <a href={href('card', card.id)}>its page</a> to compare.
            </p>
          )}
          <p className="faint small">Graded values are your logged sales or PriceCharting's (its 9 and below are any grader's).</p>
        </>
      )}
    </section>
  );
}

function GradingTips() {
  return (
    <details className="gc-tips">
      <summary>Tips before you send a card</summary>
      <ul className="small">
        <li>
          Check both sides. PSA compares opposite borders where the card is most off-centre: 55/45 or better on the front and 75/25 on the back
          for a 10, and 60/40 and 90/10 for a 9. It allows 5% more on the front for grades of 7 and up, at the grader's discretion.
        </li>
        <li>PSA gives an off-centre card either the grade its centering allows, or a higher grade with the OC (off-centre) qualifier.</li>
        <li>Look at the back's edges and corners under a bright light: white specks are wear, and a 10 is a virtually perfect card.</li>
        <li>Tilt the card under a light, front and back, to see scratches, dents and print lines. Holo foil shows them most.</li>
        <li>Compare the graded and raw prices with the whole cost (fees, postage and insurance both ways) before you send a card.</li>
        <li>Pack cards the way the grader's own submission guide asks.</li>
      </ul>
    </details>
  );
}

// ---------- the sheet ----------

function CardLine({ card, fixed, choices, onPick }: { card: CatalogCard | null; fixed: boolean; choices: CatalogCard[]; onPick: (c: CatalogCard | null) => void }) {
  const text = (c: CatalogCard) => `${c.name} · ${c.set.name} #${cardNumberText(c.number, c.set.official)}`;
  if (fixed && card) return <p className="gc-card">{text(card)}</p>;
  if (!choices.length) return null;
  return (
    <label className="gc-field gc-card">
      {card ? 'Card' : "Couldn't tell which card this is. To compare prices, pick it"}{' '}
      <select value={card?.id ?? ''} onChange={(e) => onPick(choices.find((c) => c.id === e.target.value) ?? null)}>
        {!card && <option value="">Choose…</option>}
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {text(c)}
          </option>
        ))}
        {card && <option value="">None of these</option>}
      </select>
    </label>
  );
}

export function GradeCheck({ card, onClose }: { card?: CatalogCard | null; onClose: () => void }) {
  const [index] = useState<Promise<PrintIndex | null>>(loadPrintIndex);
  const [camera, setCamera] = useState<Face | null>('front');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Partial<Record<Face, Shot>>>({});
  const [picked, setPicked] = useState<CatalogCard | null>(null);
  const [choices, setChoices] = useState<CatalogCard[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [suggested, setSuggested] = useState<Answers>({});
  const known = card ?? picked;

  async function onPhoto(face: Face, photo: HTMLCanvasElement) {
    setCamera(null);
    setWorking(true);
    setError(null);
    await painted();
    const result = measurePhoto(photo, face, face === 'front' ? await index : null);
    releaseCanvas(photo);
    setWorking(false);
    if (typeof result === 'string') {
      setError(result);
      setCamera(face);
      return;
    }
    setShots((s) => ({ ...s, [face]: result.shot }));
    const v = result.look?.picture;
    if (face === 'front' && !card && result.look) {
      setPicked(v?.clear ? v.best.card : null);
      setChoices(v?.clear ? [v.best.card, ...v.twins.map((t) => t.card)] : result.look.matches.slice(0, 5).map((m) => m.card));
    }
    if (face === 'back') {
      const edges = suggestEdges(result.shot.wear);
      setSuggested({ edges });
      if (edges !== undefined) setAnswers((a) => (a.edges === undefined ? { ...a, edges } : a));
    }
  }

  const front = shots.front ? centringOf(shots.front).face : null;
  const back = shots.back ? centringOf(shots.back).face : null;
  const verdict = centeringVerdict(front, back);
  const estimate = estimateGrade(verdict, answers);
  // Only centering holds it below a grade PSA's leeway could give: compare that grade too.
  const leeway = verdict?.leeway && estimate.limits.length === 1 && estimate.limits[0] === 'centering' ? verdict.leeway : null;

  return (
    <Sheet title="Grade check" onClose={onClose} wide>
      {camera ? (
        <>
          {error && <p className="error small">{error}</p>}
          <CardCamera key={camera} face={camera} onPhoto={(p) => void onPhoto(camera, p)} />
          {(shots.front || shots.back) && (
            <p className="center">
              <button className="btn small" onClick={() => setCamera(null)}>
                Back to the results
              </button>
            </p>
          )}
        </>
      ) : working ? (
        <div className="reading">
          <div className="spinner" />
          <p className="muted">Measuring the borders…</p>
        </div>
      ) : (
        <div className="gc-results">
          <CardLine card={known} fixed={!!card} choices={choices} onPick={setPicked} />
          {shots.front ? (
            <ShotPanel shot={shots.front} onChange={(s) => setShots((x) => ({ ...x, front: s }))} onRetake={() => setCamera('front')} />
          ) : (
            <button className="btn primary" onClick={() => setCamera('front')}>
              Photograph the front
            </button>
          )}
          {shots.back ? (
            <ShotPanel shot={shots.back} onChange={(s) => setShots((x) => ({ ...x, back: s }))} onRetake={() => setCamera('back')} />
          ) : (
            <div className="gc-add-back">
              <button className="btn primary" onClick={() => setCamera('back')}>
                Now the back
              </button>
              <p className="faint small">Its centering counts too (75/25 or better for a 10), and it shows white wear on the edges best.</p>
            </div>
          )}
          <Questions answers={answers} suggested={suggested} onAnswer={(aspect, choice) => setAnswers((a) => ({ ...a, [aspect]: choice }))} />
          <EstimatePanel verdict={verdict} answers={answers} measured={{ front: !!front, back: !!back }} />
          {known && <WorthGrading key={known.id} card={known} grades={[...(leeway ? [leeway] : []), ...gradesToCompare(estimate.best)]} leeway={leeway} />}
          <GradingTips />
          <p className="faint small">
            Centering limits and grade descriptions from{' '}
            <a href={PSA_STANDARDS_URL} target="_blank" rel="noreferrer">
              PSA's grading standards
            </a>
            . Other graders have their own.
          </p>
        </div>
      )}
    </Sheet>
  );
}
