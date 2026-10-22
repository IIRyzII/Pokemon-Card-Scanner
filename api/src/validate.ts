import { isPrintingKey } from '../../shared/printings.ts';
import { HttpError } from './env.ts';

type Opts = { optional?: boolean };

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Request body must be a JSON object');
}

export function text(v: unknown, field: string, opts: Opts & { max?: number; min?: number } = {}): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (opts.optional) return null;
    throw new HttpError(400, `${field} is required`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
  const s = v.trim();
  if (opts.min && s.length < opts.min) throw new HttpError(400, `${field} must be at least ${opts.min} characters`);
  if (s.length > (opts.max ?? 500)) throw new HttpError(400, `${field} is too long (max ${opts.max ?? 500})`);
  return s;
}

export function requiredText(v: unknown, field: string, opts: { max?: number; min?: number } = {}): string {
  return text(v, field, opts) as string;
}

export function number(
  v: unknown,
  field: string,
  opts: Opts & { min?: number; max?: number; integer?: boolean } = {},
): number | null {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return null;
    throw new HttpError(400, `${field} is required`);
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  if (opts.integer && !Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number`);
  if (opts.min !== undefined && n < opts.min) throw new HttpError(400, `${field} must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new HttpError(400, `${field} must be at most ${opts.max}`);
  return n;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, opts: Opts = {}): T | null {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return null;
    throw new HttpError(400, `${field} is required`);
  }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

/** A printing: one of the five plain ones, or a special one built on one ("holo~cosmos", "reverse+gamestop"). */
export function printing(v: unknown, field: string, opts: Opts = {}): string | null {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return null;
    throw new HttpError(400, `${field} is required`);
  }
  if (!isPrintingKey(v)) throw new HttpError(400, `${field} isn't a printing this app knows`);
  return v;
}

export function isoDate(v: unknown, field: string, opts: Opts = {}): string | null {
  const s = text(v, field, { ...opts, max: 10 });
  if (s === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new HttpError(400, `${field} must be a date like 2026-01-31`);
  }
  return s;
}

export function httpUrl(v: unknown, field: string): string | null {
  const s = text(v, field, { optional: true, max: 2000 });
  if (s === null) return null;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch {
    // fall through
  }
  throw new HttpError(400, `${field} must be a web link (https://…)`);
}

export function email(v: unknown): string {
  const s = requiredText(v, 'Email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'Enter a valid email address');
  return s;
}

/** Card ids come from the catalog, e.g. "base1-4", "sv03.5-025", "swsh12.5gg-GG01", "exu-!". */
export function cardId(v: unknown): string {
  const s = requiredText(v, 'cardId', { max: 60 });
  if (!/^[A-Za-z0-9.!%_-]+$/.test(s)) throw new HttpError(400, 'Invalid card id');
  return s;
}
