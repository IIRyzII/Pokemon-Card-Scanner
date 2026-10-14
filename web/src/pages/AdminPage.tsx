import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../../shared/password.ts';
import { ROLES, ROLE_INFO, type AuditEntry, type Role, type User } from '../../../shared/types.ts';
import { useFeedback } from '../components/feedback.tsx';
import { api, getApiUrl } from '../lib/api.ts';
import { useCollection } from '../lib/collection.tsx';
import { downloadFile, relativeTime, todayIso } from '../lib/format.ts';
import { derivePasswordKey } from '../lib/password.ts';
import { useSession } from '../lib/session.tsx';

function describe(e: AuditEntry): string {
  let d: Record<string, unknown> = {};
  try {
    d = e.details ? (JSON.parse(e.details) as Record<string, unknown>) : {};
  } catch {
    // plain text details
  }
  const card = typeof d.card === 'string' ? d.card : null;
  switch (e.action) {
    case 'add':
      return `added ${card ?? 'a card'}`;
    case 'edit':
      return `edited ${card ?? 'a card'} (${Object.keys(d).filter((k) => k !== 'card').join(', ') || 'no changes'})`;
    case 'remove':
      return `removed ${card ?? 'a card'}`;
    case 'restore':
      return `restored ${card ?? 'a card'}`;
    case 'purge':
      return `permanently deleted ${card ?? 'a card'}`;
    case 'log-sale':
      return `logged a ${d.grader === 'RAW' ? 'raw' : `${d.grader} ${d.grade}`} sale of $${d.price} for ${e.entityId}`;
    case 'delete-sale':
      return `deleted a sale for ${e.entityId}`;
    case 'register':
      return `signed up (${d.role})`;
    case 'update':
      return `updated ${d.email ?? 'a user'}: ${Object.entries(d)
        .filter(([k]) => k !== 'email')
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`;
    case 'reset-password':
      return `reset the password of ${d.email}`;
    case 'create-user':
      return `created an account for ${d.email} (${d.role})`;
    case 'delete':
      return `deleted user ${d.email}`;
    default:
      return `${e.action} ${e.entity} ${e.entityId ?? ''}`;
  }
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function AdminPage() {
  const { user: me, server } = useSession();
  const { data } = useCollection();
  const { toast, confirm } = useFeedback();
  const [users, setUsers] = useState<User[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditMore, setAuditMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setUsers((await api.users()).users);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  const loadAudit = useCallback(async (before?: number) => {
    try {
      const { entries } = await api.audit(before);
      setAudit((a) => (before ? [...a, ...entries] : entries));
      setAuditMore(entries.length === 100);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void loadUsers();
    void loadAudit();
  }, [loadUsers, loadAudit]);

  async function update(u: User, patch: Partial<Pick<User, 'role' | 'disabled'>>) {
    if (patch.role === 'admin' && !(await confirm({ title: `Make ${u.displayName} an admin?`, body: 'Admins can manage every user, including you.', confirmText: 'Make admin' }))) {
      return;
    }
    try {
      const { user } = await api.updateUser(u.id, patch);
      setUsers((list) => list?.map((x) => (x.id === user.id ? user : x)) ?? null);
      toast(`${user.displayName}: ${ROLE_INFO[user.role].label}${user.disabled ? ' (disabled)' : ''}`);
      void loadAudit();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function resetPassword(u: User) {
    const pw = window.prompt(`New temporary password for ${u.displayName} (at least ${MIN_PASSWORD_LENGTH} characters):`);
    if (!pw) return;
    if (pw.length < MIN_PASSWORD_LENGTH) return toast(`Use at least ${MIN_PASSWORD_LENGTH} characters`, 'error');
    try {
      await api.resetPassword(u.id, await derivePasswordKey(u.email, pw));
      toast(`Password reset — give ${u.displayName} the temporary password and ask them to change it.`);
      void loadAudit();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function remove(u: User) {
    const ok = await confirm({
      title: `Delete ${u.displayName}?`,
      body: `${u.email} will be signed out and can no longer log in. Cards they added stay in the collection.`,
      confirmText: 'Delete user',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteUser(u.id);
      setUsers((list) => list?.filter((x) => x.id !== u.id) ?? null);
      void loadAudit();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function exportJson() {
    try {
      downloadFile(`pokevault-backup-${todayIso()}.json`, JSON.stringify(await api.exportAll(), null, 2), 'application/json');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  function exportCsv() {
    const cols = ['name', 'setName', 'number', 'setTotal', 'variant', 'grader', 'grade', 'gradeLabel', 'condition', 'quantity', 'value', 'valueCurrency', 'valueSource', 'purchasePrice', 'purchaseCurrency', 'purchaseDate', 'certNumber', 'artist', 'rarity', 'notes', 'cardId', 'createdAt'] as const;
    const rows = (data?.items ?? []).map((i) => cols.map((c) => csvCell(i[c])).join(','));
    downloadFile(`pokevault-collection-${todayIso()}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv');
  }

  const pending = users?.filter((u) => u.role === 'pending') ?? [];

  return (
    <div className="page">
      <h1>Admin</h1>
      {error && <p className="error">{error}</p>}

      {pending.length > 0 && (
        <section className="card-section highlight">
          <h2>Waiting for approval</h2>
          {pending.map((u) => (
            <div className="user-row" key={u.id}>
              <div>
                <strong>{u.displayName}</strong>
                <div className="faint small">
                  {u.email} · signed up {relativeTime(u.createdAt)}
                </div>
              </div>
              <div className="actions">
                <button className="btn small" onClick={() => update(u, { role: 'viewer' })}>
                  Approve as viewer
                </button>
                <button className="btn small primary" onClick={() => update(u, { role: 'editor' })}>
                  Approve as editor
                </button>
                <button className="btn small danger-outline" onClick={() => remove(u)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card-section">
        <h2>Users & roles</h2>
        <ul className="role-help">
          {ROLES.map((r) => (
            <li key={r}>
              <b>{ROLE_INFO[r].label}</b> — {ROLE_INFO[r].description}
            </li>
          ))}
        </ul>
        <AddUserForm onCreated={(u) => setUsers((list) => [...(list ?? []), u])} />
        {!users && <div className="spinner" />}
        {users?.map((u) => (
          <div className={`user-row ${u.disabled ? 'disabled' : ''}`} key={u.id}>
            <div>
              <strong>
                {u.displayName} {u.id === me?.id && <span className="badge">you</span>}
                {u.disabled && <span className="badge">disabled</span>}
              </strong>
              <div className="faint small">
                {u.email} · last sign-in {relativeTime(u.lastLoginAt)}
              </div>
            </div>
            <div className="actions">
              <select value={u.role} onChange={(e) => update(u, { role: e.target.value as Role })} aria-label={`Role for ${u.displayName}`}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_INFO[r].label}
                  </option>
                ))}
              </select>
              {u.id !== me?.id && (
                <>
                  <button className="btn small" onClick={() => update(u, { disabled: !u.disabled })}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </button>
                  <button className="btn small" onClick={() => resetPassword(u)}>
                    Reset password
                  </button>
                  <button className="btn small danger-outline" onClick={() => remove(u)}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card-section">
        <h2>Backups</h2>
        <p className="muted small">
          Everything is stored in your Cloudflare D1 database, which can also be rolled back to any point in the last 7 days
          (free plan, "Time Travel"). Download a copy any time:
        </p>
        <div className="actions">
          <button className="btn" onClick={exportJson}>
            Download full backup (JSON)
          </button>
          <button className="btn" onClick={exportCsv} disabled={!data}>
            Download collection (CSV)
          </button>
        </div>
      </section>

      <section className="card-section">
        <h2>Server</h2>
        <dl className="facts">
          <div>
            <dt>API</dt>
            <dd>{getApiUrl()}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{server?.version ?? '—'}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>
              {server?.currency ?? '—'} (set CURRENCY in api/wrangler.jsonc){server?.fx ? ` · ECB rates of ${server.fx.date}` : ''}
            </dd>
          </div>
          <div>
            <dt>Sign-ups</dt>
            <dd>{server?.registration === 'closed' ? 'Closed' : 'Open (new accounts start as Pending)'}</dd>
          </div>
          <div>
            <dt>Prices</dt>
            <dd>
              TCGplayer + Cardmarket (via TCGdex) ✓ · logged sales ✓ · PriceCharting{' '}
              {server?.providers.pricecharting ? '✓' : '— not configured'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card-section">
        <h2>Activity log</h2>
        <ul className="audit">
          {audit.map((e) => (
            <li key={e.id}>
              <span className="faint small">{relativeTime(e.createdAt)}</span> <b>{e.userEmail ?? 'system'}</b> {describe(e)}
            </li>
          ))}
        </ul>
        {auditMore && audit.length > 0 && (
          <button className="btn small" onClick={() => loadAudit(audit[audit.length - 1].id)}>
            Load more
          </button>
        )}
      </section>
    </div>
  );
}

function AddUserForm({ onCreated }: { onCreated: (u: User) => void }) {
  const { toast } = useFeedback();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return toast(`Use at least ${MIN_PASSWORD_LENGTH} characters`, 'error');
    setBusy(true);
    try {
      const { user } = await api.createUser({
        email: email.trim(),
        displayName: name.trim(),
        role,
        key: await derivePasswordKey(email.trim(), password),
      });
      onCreated(user);
      toast(`Account created — give ${user.displayName} their temporary password.`);
      setEmail('');
      setName('');
      setPassword('');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="add-user">
      <summary className="btn small">+ Add a user</summary>
      <form className="form" onSubmit={submit}>
        <div className="row2">
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Name
            <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="row2">
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.filter((r) => r !== 'pending').map((r) => (
                <option key={r} value={r}>
                  {ROLE_INFO[r].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Temporary password
            <input type="text" required autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </details>
  );
}
