// Finds the card in a camera frame: the four corners of the most card-like rectangle, so the card
// can be straightened before it's read, wherever in the frame and however tilted it's held.
// Works on a small copy of the frame (a few hundred pixels across) in a few tens of milliseconds:
// edges → straight lines (a Hough transform, limited to near-upright lines) → the best
// combination of two side lines and a top and bottom line with a card's proportions.

/** RGBA pixels, like canvas ImageData. */
export interface Image {
  data: ArrayLike<number>;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
/** Top-left, top-right, bottom-right, bottom-left. */
export type Corners = [Point, Point, Point, Point];
export interface Detection {
  corners: Corners;
  /** 0–1: how much of the outline has a clear edge along it */
  score: number;
}

export const CARD_ASPECT = 63 / 88; // width / height
const MAX_TILT = (20 * Math.PI) / 180;
const STEP = Math.PI / 180; // 1° angle resolution
const SPREAD = 5; // each edge pixel votes for angles within ±5° of its gradient
const N_ANGLES = Math.round((2 * MAX_TILT) / STEP) + 1;
const EDGE_MIN = 30; // weakest edge (Sobel magnitude on 0–255 values) that counts at all
const STRONG_EDGE = 150; // edges this strong or stronger get a full vote
const AREA_WEIGHT = 0.6; // between nested outlines, how much the larger one is preferred

interface Line {
  /** 'v' lines: x·cos φ + y·sin φ = ρ; 'h' lines: −x·sin φ + y·cos φ = ρ */
  phi: number;
  rho: number;
  votes: number;
  /** prefix sums of edge hits along the line (by y for 'v' lines, by x for 'h' lines) */
  hits: Uint32Array;
}

/** 5-tap Gaussian blur, separable. */
function blur(src: ArrayLike<number>, w: number, h: number): Float32Array {
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) s += src[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + 2];
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + 2];
      out[y * w + x] = s;
    }
  }
  return out;
}

export function detectCard(img: Image): Detection | null {
  const W = img.width;
  const H = img.height;
  // Edges in colour, not just brightness: a yellow border on white paper is nearly as bright as
  // the paper but very different in blue. Per pixel, the channel with the strongest edge wins.
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);
  const mag = new Float32Array(W * H);
  const channel = new Float32Array(W * H);
  for (let ch = 0; ch < 3; ch++) {
    for (let p = 0; p < W * H; p++) channel[p] = img.data[p * 4 + ch];
    const g = blur(channel, W, H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const a = g[i - W - 1], b = g[i - W], c = g[i - W + 1], d = g[i - 1], f = g[i + 1], p = g[i + W - 1], q = g[i + W], r = g[i + W + 1];
        const ex = c + 2 * f + r - a - 2 * d - p;
        const ey = p + 2 * q + r - a - 2 * b - c;
        const m = Math.hypot(ex, ey);
        if (m > mag[i]) {
          gx[i] = ex;
          gy[i] = ey;
          mag[i] = m;
        }
      }
    }
  }

  // Thin edges: keep pixels that are the strongest along their gradient direction.
  const thin: number[] = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      const m = mag[i];
      if (m < EDGE_MIN) continue;
      const deg = ((Math.atan2(gy[i], gx[i]) * 180) / Math.PI + 180) % 180;
      const o = deg < 22.5 || deg >= 157.5 ? 1 : deg < 67.5 ? W + 1 : deg < 112.5 ? W : W - 1;
      if (m >= mag[i - o] && m >= mag[i + o]) thin.push(i);
    }
  }
  if (thin.length < 50) return null;

  const offV = Math.ceil(H * Math.sin(MAX_TILT)) + 2;
  const offH = Math.ceil(W * Math.sin(MAX_TILT)) + 2;
  const sizeV = W + 2 * offV;
  const sizeH = H + 2 * offH;
  const accV = new Float32Array(N_ANGLES * sizeV);
  const accH = new Float32Array(N_ANGLES * sizeH);
  const edgeV = new Uint8Array(W * H); // edges running up/down, widened by a pixel each side
  const edgeH = new Uint8Array(W * H); // edges running across
  const cos = Float64Array.from({ length: N_ANGLES }, (_, a) => Math.cos(-MAX_TILT + a * STEP));
  const sin = Float64Array.from({ length: N_ANGLES }, (_, a) => Math.sin(-MAX_TILT + a * STEP));

  for (const i of thin) {
    // Faint edges still vote (a card border can be faint), strong ones count for more.
    const weight = Math.min(1, mag[i] / STRONG_EDGE);
    const x = i % W;
    const y = (i - x) / W;
    const vertical = Math.abs(gx[i]) >= Math.abs(gy[i]);
    // Angle of the line's normal, folded into (−90°, 90°].
    const phi = vertical ? Math.atan(gy[i] / gx[i]) : Math.atan(-gx[i] / gy[i]);
    const centre = Math.round((phi + MAX_TILT) / STEP);
    if (centre < -SPREAD || centre >= N_ANGLES + SPREAD) continue;
    if (vertical) {
      edgeV[i] = edgeV[i - 1] = edgeV[i + 1] = 1;
      for (let a = Math.max(0, centre - SPREAD); a <= Math.min(N_ANGLES - 1, centre + SPREAD); a++) {
        accV[a * sizeV + Math.round(x * cos[a] + y * sin[a]) + offV] += weight;
      }
    } else {
      edgeH[i] = edgeH[i - W] = edgeH[i + W] = 1;
      for (let a = Math.max(0, centre - SPREAD); a <= Math.min(N_ANGLES - 1, centre + SPREAD); a++) {
        accH[a * sizeH + Math.round(-x * sin[a] + y * cos[a]) + offH] += weight;
      }
    }
  }

  const minVotes = Math.max(20, Math.round(0.12 * Math.min(W, H)));
  const peaks = (acc: Float32Array, size: number, off: number): { phi: number; rho: number; votes: number }[] => {
    const found: { phi: number; rho: number; votes: number }[] = [];
    for (let a = 0; a < N_ANGLES; a++) {
      for (let r = 0; r < size; r++) {
        const v = acc[a * size + r];
        if (v < minVotes) continue;
        let best = true;
        for (let da = -2; da <= 2 && best; da++) {
          const aa = a + da;
          if (aa < 0 || aa >= N_ANGLES) continue;
          for (let dr = -4; dr <= 4; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= size || (da === 0 && dr === 0)) continue;
            const u = acc[aa * size + rr];
            // Ties go to the first cell, so a flat-topped peak yields one line.
            if (u > v || (u === v && (da < 0 || (da === 0 && dr < 0)))) {
              best = false;
              break;
            }
          }
        }
        if (best) found.push({ phi: -MAX_TILT + a * STEP, rho: r - off, votes: v });
      }
    }
    return found.sort((p, q) => q.votes - p.votes).slice(0, 16);
  };

  const along = (phi: number, rho: number, vertical: boolean): Uint32Array => {
    const n = vertical ? H : W;
    const hits = new Uint32Array(n + 1);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (let t = 0; t < n; t++) {
      let hit = 0;
      if (vertical) {
        const x = Math.round((rho - t * s) / c);
        hit = x >= 0 && x < W ? edgeV[t * W + x] : 0;
      } else {
        const y = Math.round((rho + t * s) / c);
        hit = y >= 0 && y < H ? edgeH[y * W + t] : 0;
      }
      hits[t + 1] = hits[t] + hit;
    }
    return hits;
  };

  const xc = W / 2;
  const yc = H / 2;
  const vLines: Line[] = peaks(accV, sizeV, offV)
    .map((p) => ({ ...p, hits: along(p.phi, p.rho, true) }))
    .sort((p, q) => (p.rho - yc * Math.sin(p.phi)) / Math.cos(p.phi) - (q.rho - yc * Math.sin(q.phi)) / Math.cos(q.phi));
  const hLines: Line[] = peaks(accH, sizeH, offH)
    .map((p) => ({ ...p, hits: along(p.phi, p.rho, false) }))
    .sort((p, q) => (p.rho + xc * Math.sin(p.phi)) / Math.cos(p.phi) - (q.rho + xc * Math.sin(q.phi)) / Math.cos(q.phi));
  if (vLines.length < 2 || hLines.length < 2) return null;

  const meet = (v: Line, h: Line): Point => {
    const det = Math.cos(v.phi - h.phi);
    return {
      x: (v.rho * Math.cos(h.phi) - Math.sin(v.phi) * h.rho) / det,
      y: (Math.cos(v.phi) * h.rho + Math.sin(h.phi) * v.rho) / det,
    };
  };
  const support = (line: Line, from: number, to: number): number => {
    const a = Math.max(0, Math.min(line.hits.length - 1, Math.round(Math.min(from, to))));
    const b = Math.max(0, Math.min(line.hits.length - 1, Math.round(Math.max(from, to))));
    return b - a < 8 ? 0 : (line.hits[b] - line.hits[a]) / (b - a);
  };
  const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const margin = 0.03 * Math.max(W, H);
  const inside = (p: Point) => p.x >= -margin && p.y >= -margin && p.x <= W + margin && p.y <= H + margin;

  let pick: { left: Line; right: Line; top: Line; bottom: Line; mean: number } | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < vLines.length; i++) {
    for (let j = i + 1; j < vLines.length; j++) {
      const left = vLines[i];
      const right = vLines[j];
      for (let k = 0; k < hLines.length; k++) {
        for (let l = k + 1; l < hLines.length; l++) {
          const top = hLines[k];
          const bottom = hLines[l];
          const tl = meet(left, top);
          const tr = meet(right, top);
          const br = meet(right, bottom);
          const bl = meet(left, bottom);
          if (!inside(tl) || !inside(tr) || !inside(br) || !inside(bl)) continue;
          const wTop = dist(tl, tr);
          const wBottom = dist(bl, br);
          const hLeft = dist(tl, bl);
          const hRight = dist(tr, br);
          const w = (wTop + wBottom) / 2;
          const h = (hLeft + hRight) / 2;
          const aspect = w / h;
          if (h < 0.28 * H || aspect < 0.58 || aspect > 0.86) continue;
          if (wTop / wBottom > 1.4 || wBottom / wTop > 1.4 || hLeft / hRight > 1.4 || hRight / hLeft > 1.4) continue;
          const sides = [support(left, tl.y, bl.y), support(right, tr.y, br.y), support(top, tl.x, tr.x), support(bottom, bl.x, br.x)];
          const weakest = Math.min(...sides);
          if (weakest < 0.2) continue;
          const mean = (sides[0] + sides[1] + sides[2] + sides[3]) / 4;
          // Prefer well-outlined, card-shaped and (between nested outlines, e.g. the card's own
          // inner border) the larger rectangle.
          const score = mean + 0.25 * weakest + AREA_WEIGHT * ((w * h) / (W * H)) - 0.8 * Math.abs(aspect - CARD_ASPECT);
          if (score > bestScore) {
            bestScore = score;
            pick = { left, right, top, bottom, mean };
          }
        }
      }
    }
  }
  if (!pick || pick.mean < 0.35) return null;

  // The card's printed border makes a second outline just inside its real edge, and a side can
  // lock onto that instead. Push each side out to the outermost nearly-parallel edge close by.
  const position = (line: Line, vertical: boolean, t: number) =>
    vertical ? (line.rho - t * Math.sin(line.phi)) / Math.cos(line.phi) : (line.rho + t * Math.sin(line.phi)) / Math.cos(line.phi);
  for (let pass = 0; pass < 2; pass++) {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const vertical = side === 'left' || side === 'right';
      const outward = side === 'left' || side === 'top' ? -1 : 1;
      const current = pick[side];
      const tl = meet(pick.left, pick.top);
      const br = meet(pick.right, pick.bottom);
      const cardHeight = br.y - tl.y;
      const middle = vertical ? (tl.y + br.y) / 2 : (tl.x + br.x) / 2;
      let outer: Line | null = null;
      let outerGap = 0;
      for (const line of vertical ? vLines : hLines) {
        if (line === current || Math.abs(line.phi - current.phi) > 3 * STEP) continue;
        const gap = (position(line, vertical, middle) - position(current, vertical, middle)) * outward;
        if (gap < 0.008 * cardHeight || gap > 0.08 * cardHeight || gap <= outerGap) continue;
        const span = vertical ? [meet(line, pick.top).y, meet(line, pick.bottom).y] : [meet(pick.left, line).x, meet(pick.right, line).x];
        if (support(line, span[0], span[1]) >= 0.45) {
          outer = line;
          outerGap = gap;
        }
      }
      if (outer) pick[side] = outer;
    }
  }
  const corners: Corners = [meet(pick.left, pick.top), meet(pick.right, pick.top), meet(pick.right, pick.bottom), meet(pick.left, pick.bottom)];
  if (!corners.every(inside)) return null;
  return { corners, score: pick.mean };
}

/** Area-averaged copy of RGBA pixels, `scale` times the size (e.g. 0.25). */
export function shrink(img: Image, scale: number): Image {
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const sums = new Float32Array(w * h * 4);
  const counts = new Float32Array(w * h);
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    const oy = Math.min(h - 1, Math.floor(y * scale)) * w;
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const o = oy + Math.min(w - 1, Math.floor(x * scale));
      sums[o * 4] += d[i];
      sums[o * 4 + 1] += d[i + 1];
      sums[o * 4 + 2] += d[i + 2];
      counts[o]++;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let o = 0; o < w * h; o++) {
    const n = counts[o] || 1;
    out[o * 4] = sums[o * 4] / n;
    out[o * 4 + 1] = sums[o * 4 + 1] / n;
    out[o * 4 + 2] = sums[o * 4 + 2] / n;
    out[o * 4 + 3] = 255;
  }
  return { data: out, width: w, height: h };
}
