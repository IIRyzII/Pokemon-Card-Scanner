// "Is the camera steady?" Compares tiny greyscale snapshots of the guide frame, so auto-scan
// only spends time reading frames that aren't smeared by movement.

import type { Crop } from './ocr.ts';

const W = 24;
const H = 34;
let canvas: HTMLCanvasElement | null = null;

/** A 24×34 greyscale snapshot of part of the video. */
export function snapshot(video: HTMLVideoElement, crop: Crop): Uint8ClampedArray {
  canvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const grey = new Uint8ClampedArray(W * H);
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) grey[p] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return grey;
}

/**
 * Average change per pixel between two snapshots (0–255). An overall brightness shift
 * is ignored, so the camera adjusting its exposure doesn't count as movement.
 */
export function frameChange(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let shift = 0;
  for (let i = 0; i < n; i++) shift += b[i] - a[i];
  shift /= n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(b[i] - a[i] - shift);
  return sum / n;
}
