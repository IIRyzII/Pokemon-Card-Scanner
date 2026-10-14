import { Hono } from 'hono';
import type { ApiStatus, AuthResponse } from '../../../shared/types.ts';
import {
  authenticate,
  clientIp,
  createSession,
  deleteSession,
  hashPasswordKey,
  newPasswordRecord,
  parseClientKey,
  randomBytes,
  rateLimit,
  verifyPasswordKey,
} from '../auth.ts';
import { auditStmt, toUser } from '../db.ts';
import { HttpError, nowIso, type AppEnv } from '../env.ts';
import { getRates, homeCurrency } from '../fx.ts';
import { email, readJson, requiredText } from '../validate.ts';

export const API_VERSION = '1.0.0';
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

const auth = new Hono<AppEnv>();

auth.get('/status', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return c.json<ApiStatus>({
    ok: true,
    version: API_VERSION,
    hasUsers: (row?.n ?? 0) > 0,
    registration: c.env.REGISTRATION === 'closed' ? 'closed' : 'open',
    providers: { tcgdex: true, pricecharting: !!c.env.PRICECHARTING_TOKEN },
    currency: homeCurrency(c.env),
    fx: await getRates(c.env),
  });
});

auth.post('/register', async (c) => {
  await rateLimit(c.env, `register:${clientIp(c.req.raw)}`, 5, 3600);
  const body = await readJson(c.req.raw);
  const userEmail = email(body.email);
  const displayName = requiredText(body.displayName, 'Name', { max: 40 });
  const key = parseClientKey(body.key);

  const count = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;
  if (count > 0 && c.env.REGISTRATION === 'closed') {
    throw new HttpError(403, 'Sign-ups are closed — ask the admin to create an account for you');
  }
  const { salt, hash } = await newPasswordRecord(key);
  const id = crypto.randomUUID();
  try {
    // The very first account becomes the admin; everyone after starts as Pending.
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, display_name, role, pw_salt, pw_hash, created_at)
       VALUES (?, ?, ?, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'admin' ELSE 'pending' END, ?, ?, ?)`,
    )
      .bind(id, userEmail, displayName, salt, hash, nowIso())
      .run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, 'An account with that email already exists');
    throw err;
  }
  const user = toUser((await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first())!);
  await auditStmt(c.env, { id, email: userEmail, displayName, role: user.role }, 'register', 'user', id, {
    role: user.role,
  }).run();
  const token = await createSession(c.env, id, c.req.header('User-Agent') ?? null);
  return c.json<AuthResponse>({ token, user }, 201);
});

auth.post('/login', async (c) => {
  await rateLimit(c.env, `login:${clientIp(c.req.raw)}`, 30, 900);
  const body = await readJson(c.req.raw);
  const userEmail = email(body.email);
  const key = parseClientKey(body.key);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(userEmail).first<Record<string, unknown>>();
  if (!row) {
    await hashPasswordKey(key, randomBytes(16)); // same work either way
    throw new HttpError(401, 'Wrong email or password');
  }
  const lockedUntil = row.locked_until ? String(row.locked_until) : null;
  if (lockedUntil && lockedUntil > nowIso()) {
    const minutes = Math.ceil((Date.parse(lockedUntil) - Date.now()) / 60_000);
    throw new HttpError(429, `Too many failed sign-ins — try again in ${minutes} minute${minutes === 1 ? '' : 's'}`);
  }
  if (!(await verifyPasswordKey(key, String(row.pw_salt), String(row.pw_hash)))) {
    const failed = Number(row.failed_logins) + 1;
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    await c.env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(lock ? 0 : failed, lock, row.id)
      .run();
    throw new HttpError(401, 'Wrong email or password');
  }
  if (row.disabled) throw new HttpError(403, 'This account has been disabled');
  const now = nowIso();
  await c.env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
    .bind(now, row.id)
    .run();
  const token = await createSession(c.env, String(row.id), c.req.header('User-Agent') ?? null);
  return c.json<AuthResponse>({ token, user: toUser({ ...row, last_login_at: now }) });
});

auth.get('/me', authenticate, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('user').id).first();
  if (!row) throw new HttpError(401, 'Please sign in');
  return c.json({ user: toUser(row) });
});

auth.patch('/me', authenticate, async (c) => {
  const body = await readJson(c.req.raw);
  const displayName = requiredText(body.displayName, 'Name', { max: 40 });
  const user = c.get('user');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(displayName, user.id),
    auditStmt(c.env, user, 'rename', 'user', user.id, { displayName }),
  ]);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return c.json({ user: toUser(row!) });
});

auth.post('/logout', authenticate, async (c) => {
  await deleteSession(c.env, c.get('tokenHash'));
  return c.json({ ok: true });
});

auth.post('/password', authenticate, async (c) => {
  const user = c.get('user');
  await rateLimit(c.env, `password:${user.id}`, 10, 900);
  const body = await readJson(c.req.raw);
  const currentKey = parseClientKey(body.currentKey, 'Current password');
  const newKey = parseClientKey(body.newKey, 'New password');
  const row = await c.env.DB.prepare('SELECT pw_salt, pw_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ pw_salt: string; pw_hash: string }>();
  if (!row || !(await verifyPasswordKey(currentKey, row.pw_salt, row.pw_hash))) {
    throw new HttpError(400, 'Your current password is wrong');
  }
  const { salt, hash } = await newPasswordRecord(newKey);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?').bind(salt, hash, user.id),
    // Sign out every other device.
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(user.id, c.get('tokenHash')),
    auditStmt(c.env, user, 'change-password', 'user', user.id),
  ]);
  return c.json({ ok: true });
});

export default auth;
