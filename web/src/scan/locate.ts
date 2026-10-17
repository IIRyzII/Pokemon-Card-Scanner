// Camera glue for the card finder: looks for the card in the live video (or a photo), and cuts a
// straightened, full-resolution copy of it out of the picture for reading.

import { CARD_ASPECT, detectCard, type Corners, type Detection, type Point } from './detect.ts';
import { warpCard, type Rgba } from './warp.ts';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A straightened card: as pixels (for its fingerprint) and as a canvas (for reading its text). */
export interface Straightened {
  rgba: Rgba;
  canvas: HTMLCanvasElement;
}

/** The part of the camera frame the <video> element actually shows (object-fit: cover), in video pixels. */
export function visibleRegion(video: HTMLVideoElement): Region {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ew = video.clientWidth || vw;
  const eh = video.clientHeight || vh;
  const scale = Math.max(ew / vw, eh / vh);
  const w = Math.min(vw, ew / scale);
  const h = Math.min(vh, eh / scale);
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/** Video-pixel point → CSS pixels inside the <video> element. */
export function toElement(video: HTMLVideoElement, p: Point): Point {
  const r = visibleRegion(video);
  return { x: ((p.x - r.x) * video.clientWidth) / r.w, y: ((p.y - r.y) * video.clientHeight) / r.h };
}

const SEARCH_HEIGHT = 400; // the finder works on a copy this many pixels tall
let small: HTMLCanvasElement | null = null;

/** Looks for a card in `region` of an image or video frame. Corners are in the source's pixels. */
export function findCard(source: CanvasImageSource, region: Region): Detection | null {
  const scale = SEARCH_HEIGHT / region.h;
  const w = Math.max(1, Math.round(region.w * scale));
  small ??= document.createElement('canvas');
  if (small.width !== w || small.height !== SEARCH_HEIGHT) {
    small.width = w;
    small.height = SEARCH_HEIGHT;
  }
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, w, SEARCH_HEIGHT);
  const found = detectCard(ctx.getImageData(0, 0, w, SEARCH_HEIGHT));
  if (!found) return null;
  const corners = found.corners.map((p) => ({ x: region.x + p.x / scale, y: region.y + p.y / scale })) as Corners;
  return { corners, score: found.score };
}

/** Looks for the card in what the camera shows right now. Corners are in video pixels. */
export function locateCard(video: HTMLVideoElement): Detection | null {
  return video.videoWidth ? findCard(video, visibleRegion(video)) : null;
}

/** Average distance the corners moved between two detections, as a share of the card's height. */
export function cornerShift(a: Corners, b: Corners): number {
  const height = Math.hypot(a[0].x - a[3].x, a[0].y - a[3].y) || 1;
  return a.reduce((sum, p, i) => sum + Math.hypot(p.x - b[i].x, p.y - b[i].y), 0) / 4 / height;
}

/**
 * A straightened copy of the card at about the resolution it was seen, so small print (the card
 * number) stays as sharp as possible. `width`/`height`: the source's size in pixels.
 */
export function straightenCard(source: CanvasImageSource, width: number, height: number, corners: Corners): Straightened {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const bx = Math.max(0, Math.floor(Math.min(...xs)) - 2);
  const by = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const bw = Math.max(1, Math.min(width, Math.ceil(Math.max(...xs)) + 2) - bx);
  const bh = Math.max(1, Math.min(height, Math.ceil(Math.max(...ys)) + 2) - by);
  const grab = document.createElement('canvas');
  grab.width = bw;
  grab.height = bh;
  const gctx = grab.getContext('2d', { willReadFrequently: true })!;
  gctx.drawImage(source, bx, by, bw, bh, 0, 0, bw, bh);
  const src = gctx.getImageData(0, 0, bw, bh);
  grab.width = grab.height = 0; // free it now (iPhone Safari caps total canvas memory)

  const local = corners.map((p) => ({ x: p.x - bx, y: p.y - by })) as Corners;
  const seenHeight = (Math.hypot(local[0].x - local[3].x, local[0].y - local[3].y) + Math.hypot(local[1].x - local[2].x, local[1].y - local[2].y)) / 2;
  const outH = Math.round(Math.min(1200, Math.max(700, seenHeight)));
  const outW = Math.round(outH * CARD_ASPECT);
  const rgba = warpCard({ data: src.data, width: bw, height: bh }, local, outW, outH);
  return { rgba, canvas: toCanvas(rgba) };
}

export function toCanvas(img: Rgba): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  out.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return out;
}
