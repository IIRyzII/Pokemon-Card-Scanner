// Card fingerprints ("perceptual hashes"): a few hundred bits summarising what a card looks like.
// The catalog builder fingerprints every card's picture; the scanner fingerprints the card it
// sees and finds the closest ones in a few milliseconds, so it works even when no text is readable.
// Both sides must compute them identically, which is why this lives in shared/.

export interface Pixels {
  /** RGB or RGBA bytes, row by row */
  data: ArrayLike<number>;
  width: number;
  height: number;
  channels: 3 | 4;
}

/** A rectangle as fractions of the card: [left, top, right, bottom]. */
export type Box = readonly [number, number, number, number];

export function grayscale(px: Pixels): Float32Array {
  const out = new Float32Array(px.width * px.height);
  const d = px.data;
  for (let i = 0, p = 0; p < out.length; i += px.channels, p++) out[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return out;
}

/** Weights for an area-averaging resample of `from` source cells (starting at `start`) into `to` cells. */
function areaWeights(start: number, from: number, to: number, limit: number) {
  const cells: { first: number; weights: number[] }[] = [];
  const step = from / to;
  for (let i = 0; i < to; i++) {
    const a = start + i * step;
    const b = a + step;
    const first = Math.max(0, Math.floor(a));
    const last = Math.min(limit - 1, Math.ceil(b) - 1);
    const weights: number[] = [];
    for (let s = first; s <= last; s++) weights.push(Math.max(0, Math.min(b, s + 1) - Math.max(a, s)) / step);
    cells.push({ first, weights });
  }
  return cells;
}

/** Area-averaged resample of a box of a greyscale image to cols×rows. */
export function resample(gray: Float32Array, width: number, height: number, box: Box, cols: number, rows: number): Float32Array {
  const [l, t, r, b] = box;
  const xs = areaWeights(l * width, (r - l) * width, cols, width);
  const ys = areaWeights(t * height, (b - t) * height, rows, height);
  // Columns first (each source row → cols values), then rows.
  const tmp = new Float32Array(height * cols);
  const y0 = ys[0].first;
  const y1 = ys[rows - 1].first + ys[rows - 1].weights.length;
  for (let y = y0; y < y1; y++) {
    for (let i = 0; i < cols; i++) {
      const { first, weights } = xs[i];
      let sum = 0;
      for (let k = 0; k < weights.length; k++) sum += gray[y * width + first + k] * weights[k];
      tmp[y * cols + i] = sum;
    }
  }
  const out = new Float32Array(rows * cols);
  for (let j = 0; j < rows; j++) {
    const { first, weights } = ys[j];
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      for (let k = 0; k < weights.length; k++) sum += tmp[(first + k) * cols + i] * weights[k];
      out[j * cols + i] = sum;
    }
  }
  return out;
}

const cosTables = new Map<string, Float64Array>();
function cosTable(n: number, k: number): Float64Array {
  const key = `${n}:${k}`;
  let t = cosTables.get(key);
  if (!t) {
    t = new Float64Array(k * n);
    for (let u = 0; u < k; u++) for (let x = 0; x < n; x++) t[u * n + x] = Math.cos((Math.PI * (2 * x + 1) * u) / (2 * n));
    cosTables.set(key, t);
  }
  return t;
}

/** The top-left k×k coefficients of the 2D DCT-II of an n×n block. */
export function dctLow(block: Float32Array, n: number, k: number): Float64Array {
  const t = cosTable(n, k);
  const rowsDone = new Float64Array(n * k); // [y][u]
  for (let y = 0; y < n; y++) {
    for (let u = 0; u < k; u++) {
      let sum = 0;
      for (let x = 0; x < n; x++) sum += block[y * n + x] * t[u * n + x];
      rowsDone[y * k + u] = sum;
    }
  }
  const out = new Float64Array(k * k); // [v][u]
  for (let v = 0; v < k; v++) {
    for (let u = 0; u < k; u++) {
      let sum = 0;
      for (let y = 0; y < n; y++) sum += rowsDone[y * k + u] * t[v * n + y];
      out[v * k + u] = sum;
    }
  }
  return out;
}

/** pHash: the k×k lowest DCT frequencies of a box (DC skipped), each set to 1 if above their median. */
export function phashBits(gray: Float32Array, width: number, height: number, box: Box, n: number, k: number): Uint8Array {
  const coef = dctLow(resample(gray, width, height, box, n, n), n, k);
  const ac = Array.from(coef.subarray(1));
  const sorted = [...ac].sort((a, b) => a - b);
  const median = (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
  return Uint8Array.from(ac, (c) => (c > median ? 1 : 0));
}

/**
 * What the catalog stores for every card. Changing it changes every print, so bump `version`
 * (the catalog builder then recomputes them all instead of reusing the published ones).
 */
export const PRINT_SPEC = {
  version: 1,
  // The whole card, plus the artwork area on its own (where cards differ most). Chosen by testing
  // 400 simulated phone photos against all ~20k cards: the right card came first 97% of the time.
  parts: [
    { box: [0, 0, 1, 1] as Box, n: 48, k: 12 },
    { box: [0.1, 0.11, 0.9, 0.5] as Box, n: 48, k: 12 },
  ],
} as const;
export const PRINT_BITS = PRINT_SPEC.parts.reduce((sum, p) => sum + p.k * p.k - 1, 0);
export const PRINT_WORDS = Math.ceil(PRINT_BITS / 32);

/** The fingerprint of a card picture: the whole card, upright, edge to edge. */
export function cardPrint(px: Pixels): Uint32Array {
  const gray = grayscale(px);
  const bits: number[] = [];
  for (const p of PRINT_SPEC.parts) bits.push(...phashBits(gray, px.width, px.height, p.box, p.n, p.k));
  return packBits(bits);
}

/** Packs bits into 32-bit words (the last word zero-padded). */
export function packBits(bits: ArrayLike<number>): Uint32Array {
  const words = new Uint32Array(Math.ceil(bits.length / 32));
  for (let i = 0; i < bits.length; i++) if (bits[i]) words[i >> 5] |= 1 << (i & 31);
  return words;
}

export function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Number of differing bits between print `a` and the print at `index` of a packed index. */
export function hamming(a: Uint32Array, index: Uint32Array, offset: number): number {
  let d = 0;
  for (let w = 0; w < a.length; w++) d += popcount(a[w] ^ index[offset + w]);
  return d;
}
