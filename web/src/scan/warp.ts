// Straightens a card photographed at an angle: maps the four detected corners onto an upright
// rectangle (a perspective transform) and samples the original frame for every output pixel.

import type { Corners, Point } from './detect.ts';

export interface Rgba {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** The 3×3 perspective transform H (row-major, H[8] = 1) with H·[u, v, 1] ∝ [x, y, 1] for each pair from → to. */
export function homography(from: readonly Point[], to: readonly Point[]): Float64Array {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i];
    const { x, y } = to[i];
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k];
    }
  }
  const h = new Float64Array(9);
  for (let i = 0; i < 8; i++) h[i] = a[i][8] / a[i][i];
  h[8] = 1;
  return h;
}

/** Copies the quadrilateral `corners` of `src` into an upright outW×outH image (bilinear sampling). */
export function warpCard(src: Rgba, corners: Corners, outW: number, outH: number): Rgba {
  const h = homography(
    [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ],
    corners,
  );
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  for (let v = 0; v < outH; v++) {
    const vc = v + 0.5;
    for (let u = 0; u < outW; u++) {
      const uc = u + 0.5;
      const den = h[6] * uc + h[7] * vc + 1;
      const x = Math.min(sw - 1, Math.max(0, (h[0] * uc + h[1] * vc + h[2]) / den - 0.5));
      const y = Math.min(sh - 1, Math.max(0, (h[3] * uc + h[4] * vc + h[5]) / den - 0.5));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (v * outW + u) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * fx;
        const bottom = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * fx;
        out[o + c] = top + (bottom - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

/** Turns an image upside down (for a card held the wrong way up). */
export function rotate180(img: Rgba): Rgba {
  const d = img.data;
  const out = new Uint8ClampedArray(d.length);
  for (let p = 0, q = d.length - 4; q >= 0; p += 4, q -= 4) {
    out[q] = d[p];
    out[q + 1] = d[p + 1];
    out[q + 2] = d[p + 2];
    out[q + 3] = d[p + 3];
  }
  return { data: out, width: img.width, height: img.height };
}

/** The part of an image inside margins (shares of it: [left, top, right, bottom]), e.g. a card inside its sleeve. */
export function cropMargins(img: Rgba, [l, t, r, b]: readonly [number, number, number, number]): Rgba {
  if (!l && !t && !r && !b) return img;
  const x0 = Math.round(l * img.width);
  const y0 = Math.round(t * img.height);
  const w = Math.max(1, Math.min(img.width - x0, Math.round((1 - l - r) * img.width)));
  const h = Math.max(1, Math.min(img.height - y0, Math.round((1 - t - b) * img.height)));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * img.width + x0) * 4;
    out.set(img.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}
