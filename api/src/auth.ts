// Login sessions, password checks, role checks and rate limiting.
//
// Passwords: the browser runs PBKDF2-SHA256 (600,000 rounds, salted with the
// email) and sends us only the resulting 32-byte key. We store
// SHA-256(random salt || key). Cracking a leaked hash therefore still costs a
// full PBKDF2 run per guess, while each login costs us microseconds — which
// keeps us well inside the free Workers CPU budget.

import type { MiddlewareHandler } from 'hono';
import { hasRole, type Role } from '../../shared/types.ts';
import { HttpError, nowIso, type AppEnv, type Env, type SessionUser } from './env.ts';

const SESSION_DAYS = 30;

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64url = (bytes: Uint8Array) => b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function sha256Text(s: string): Promise<string> {
  return b64encode(await sha256(new TextEncoder().encode(s)));
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** The client-derived password key: base64 of exactly 32 bytes. */
export function parseClientKey(v: unknown, field = 'Password key'): Uint8Array {
  if (typeof v !== 'string' || v.length > 64) throw new HttpError(400, `${field} is missing or malformed`);
  let bytes: Uint8Array;
  try {
    bytes = b64decode(v);
  } catch {
    throw new HttpError(400, `${field} is malformed`);
  }
  if (bytes.length !== 32) throw new HttpError(400, `${field} is malformed`);
  return bytes;
}

export async function hashPasswordKey(key: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const data = new Uint8Array(salt.length + key.length);
  data.set(salt);
  data.set(key, salt.length);
  return sha256(data);
}

export async function newPasswordRecord(key: Uint8Array): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16);
  return { salt: b64encode(salt), hash: b64encode(await hashPasswordKey(key, salt)) };
}

export async function verifyPasswordKey(key: Uint8Array, salt: string, hash: string): Promise<boolean> {
  return constantTimeEqual(await hashPasswordKey(key, b64decode(salt)), b64decode(hash));
}

export async function createSession(env: Env, userId: string, userAgent: string | null): Promise<string> {
  const token = b64url(randomBytes(32));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256Text(token), userId, now.toISOString(), expires.toISOString(), userAgent?.slice(0, 200) ?? null)
    .run();
  return token;
}

export async function deleteSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

interface SessionRow {
  token_hash: string;
  expires_at: string;
  id: string;
  email: string;
  display_name: string;
  role: Role;
  disabled: number;
}

/** Requires a valid `Authorization: Bearer <token>`; puts the user on the context. */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 100) throw new HttpError(401, 'Please sign in');
  const tokenHash = await sha256Text(token);
  const row = await c.env.DB.prepare(
    `SELECT s.token_hash, s.expires_at, u.id, u.email, u.display_name, u.role, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<SessionRow>();
  const now = new Date();
  if (!row || row.expires_at <= now.toISOString()) throw new HttpError(401, 'Your session has expired — please sign in again');
  if (row.disabled) throw new HttpError(403, 'This account has been disabled');

  // Sliding expiry: extend at most once a day.
  const remainingDays = (Date.parse(row.expires_at) - now.getTime()) / 86_400_000;
  if (remainingDays < SESSION_DAYS - 1) {
    const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(expires, tokenHash).run(),
    );
  }
  const user: SessionUser = { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
  c.set('user', user);
  c.set('tokenHash', tokenHash);
  await next();
};

/** Role gate. Must run after `authenticate`. */
export const requireRole =
  (min: Role): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const user = c.get('user');
    if (!hasRole(user?.role, min)) {
      throw new HttpError(
        403,
        user?.role === 'pending'
          ? 'Your account is waiting for an admin to approve it'
          : `This needs ${min} access (you are ${user?.role ?? 'signed out'})`,
      );
    }
    await next();
  };

/** Fixed-window rate limit stored in D1. Throws 429 when exceeded. */
export async function rateLimit(env: Env, key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = nowIso();
  const reset = new Date(Date.now() + windowSeconds * 1000).toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
     RETURNING count, reset_at`,
  )
    .bind(key, reset, now)
    .first<{ count: number; reset_at: string }>();
  if (row && row.count > limit) {
    const minutes = Math.max(1, Math.ceil((Date.parse(row.reset_at) - Date.now()) / 60_000));
    throw new HttpError(429, `Too many attempts — try again in ${minutes} minute${minutes === 1 ? '' : 's'}`);
  }
}

export const clientIp = (req: Request) => req.headers.get('CF-Connecting-IP') ?? 'local';
