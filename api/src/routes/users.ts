// Admin-only user management (RBAC roles, disable, password reset, delete).

import { Hono } from 'hono';
import { ROLES } from '../../../shared/types.ts';
import { authenticate, newPasswordRecord, parseClientKey, requireRole } from '../auth.ts';
import { auditStmt, toUser } from '../db.ts';
import { HttpError, nowIso, type AppEnv, type Env } from '../env.ts';
import { email, oneOf, readJson, requiredText, text } from '../validate.ts';

const users = new Hono<AppEnv>();
users.use('*', authenticate, requireRole('admin'));

async function loadUser(env: Env, id: string) {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'User not found');
  return toUser(row);
}

async function activeAdmins(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").first<{
    n: number;
  }>();
  return row?.n ?? 0;
}

users.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at').all();
  return c.json({ users: results.map(toUser) });
});

/** Admin creates an account with a temporary password (works even when sign-ups are closed). */
users.post('/', async (c) => {
  const body = await readJson(c.req.raw);
  const userEmail = email(body.email);
  const displayName = requiredText(body.displayName, 'Name', { max: 40 });
  const role = oneOf(body.role ?? 'viewer', ROLES, 'Role')!;
  const { salt, hash } = await newPasswordRecord(parseClientKey(body.key));
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO users (id, email, display_name, role, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, userEmail, displayName, role, salt, hash, nowIso()),
      auditStmt(c.env, c.get('user'), 'create-user', 'user', id, { email: userEmail, role }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, 'An account with that email already exists');
    throw err;
  }
  return c.json({ user: await loadUser(c.env, id) }, 201);
});

users.patch('/:id', async (c) => {
  const me = c.get('user');
  const target = await loadUser(c.env, c.req.param('id'));
  const body = await readJson(c.req.raw);
  const role = 'role' in body ? oneOf(body.role, ROLES, 'Role')! : target.role;
  const disabled = 'disabled' in body ? body.disabled === true : target.disabled;
  const displayName = 'displayName' in body ? text(body.displayName, 'Name', { max: 40 })! : target.displayName;

  if (target.id === me.id && disabled) throw new HttpError(409, "You can't disable your own account");
  const losesAdmin = target.role === 'admin' && !target.disabled && (role !== 'admin' || disabled);
  if (losesAdmin && (await activeAdmins(c.env)) <= 1) {
    throw new HttpError(409, 'There must always be at least one active admin — promote someone else first');
  }

  const stmts = [
    c.env.DB.prepare('UPDATE users SET role = ?, disabled = ?, display_name = ? WHERE id = ?').bind(
      role,
      disabled ? 1 : 0,
      displayName,
      target.id,
    ),
    auditStmt(c.env, me, 'update', 'user', target.id, {
      email: target.email,
      ...(role !== target.role && { role: `${target.role} → ${role}` }),
      ...(disabled !== target.disabled && { disabled }),
      ...(displayName !== target.displayName && { displayName }),
    }),
  ];
  if (disabled) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id));
  await c.env.DB.batch(stmts);
  return c.json({ user: await loadUser(c.env, target.id) });
});

/** Admin sets a temporary password (the admin's browser derives the key, as at sign-up). */
users.post('/:id/reset-password', async (c) => {
  const me = c.get('user');
  const target = await loadUser(c.env, c.req.param('id'));
  const body = await readJson(c.req.raw);
  const { salt, hash } = await newPasswordRecord(parseClientKey(body.key));
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE users SET pw_salt = ?, pw_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',
    ).bind(salt, hash, target.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
    auditStmt(c.env, me, 'reset-password', 'user', target.id, { email: target.email }),
  ]);
  return c.json({ ok: true });
});

users.delete('/:id', async (c) => {
  const me = c.get('user');
  const target = await loadUser(c.env, c.req.param('id'));
  if (target.id === me.id) throw new HttpError(409, "You can't delete your own account");
  if (target.role === 'admin' && !target.disabled && (await activeAdmins(c.env)) <= 1) {
    throw new HttpError(409, 'There must always be at least one active admin');
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id),
    auditStmt(c.env, me, 'delete', 'user', target.id, { email: target.email, role: target.role }),
  ]);
  return c.json({ ok: true });
});

export default users;
