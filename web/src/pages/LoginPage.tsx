import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../../shared/password.ts';
import { builtInApiUrl, getApiUrl, setApiUrl } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

export function LoginPage() {
  const { server, serverError, signIn, register, reloadServer, refreshUser } = useSession();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiInput, setApiInput] = useState(getApiUrl());
  const [editServer, setEditServer] = useState(!getApiUrl());

  const firstUser = server?.hasUsers === false;
  const registering = firstUser || mode === 'register';
  const closed = server?.registration === 'closed' && !firstUser;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (registering) {
      if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password`);
      if (password !== password2) return setError("The passwords don't match");
    }
    setBusy(true);
    try {
      if (registering) await register(email.trim(), name.trim(), password);
      else await signIn(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    setApiUrl(apiInput.trim() && apiInput.trim() !== builtInApiUrl() ? apiInput.trim() : null);
    setApiInput(getApiUrl());
    if (await reloadServer()) setEditServer(false);
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">
          <img src="./icons/icon.svg" alt="" width={56} height={56} />
          <div>
            <h1>PokéVault</h1>
            <p className="muted">Scan, price & track your Pokémon cards</p>
          </div>
        </div>

        {!editServer && !server ? (
          <div className="form">
            <h2>{serverError ? "Can't reach your server" : 'Connecting…'}</h2>
            {serverError && (
              <p className="muted small">
                {serverError} If you're offline, try again once you're back online.
              </p>
            )}
            <button
              className="btn primary block"
              type="button"
              onClick={async () => {
                if (await reloadServer()) await refreshUser(); // back online: resume a saved sign-in
              }}
            >
              Try again
            </button>
            <button className="btn ghost block" type="button" onClick={() => setEditServer(true)}>
              Change server address
            </button>
          </div>
        ) : editServer ? (
          <form className="form" onSubmit={connect}>
            <h2>Connect to your server</h2>
            <p className="muted small">
              Paste the address of your PokéVault API (your Cloudflare Worker), e.g.
              <code> https://pokevault-api.yourname.workers.dev</code>
            </p>
            <label>
              API address
              <input
                type="url"
                inputMode="url"
                required
                value={apiInput}
                onChange={(e) => setApiInput(e.target.value)}
                placeholder="https://…workers.dev"
              />
            </label>
            {serverError && <p className="error">{serverError}</p>}
            <button className="btn primary block" type="submit">
              Connect
            </button>
          </form>
        ) : (
          <>
            {firstUser ? (
              <div className="note">
                <strong>Welcome!</strong> You're the first one here, so this account will be the <b>admin</b>. You can
                invite others and choose what they can do later.
              </div>
            ) : (
              <div className="segmented full">
                <button className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')} type="button">
                  Sign in
                </button>
                <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')} type="button">
                  Create account
                </button>
              </div>
            )}
            {registering && closed ? (
              <p className="note">Sign-ups are closed. Ask the admin to create an account for you.</p>
            ) : (
              <form className="form" onSubmit={submit}>
                <label>
                  Email
                  <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                {registering && (
                  <label>
                    Your name
                    <input autoComplete="nickname" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                )}
                <label>
                  Password
                  <div className="pw">
                    <input
                      type={showPw ? 'text' : 'password'}
                      aria-label="Password"
                      autoComplete={registering ? 'new-password' : 'current-password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="link"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPw((s) => !s)}
                    >
                      {showPw ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>
                {registering && (
                  <label>
                    Confirm password
                    <input
                      type={showPw ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                    />
                  </label>
                )}
                {error && <p className="error">{error}</p>}
                <button className="btn primary block" type="submit" disabled={busy}>
                  {busy ? (registering ? 'Creating account…' : 'Signing in…') : registering ? 'Create account' : 'Sign in'}
                </button>
                {registering && !firstUser && (
                  <p className="faint small">New accounts need an admin's approval before they can see the collection.</p>
                )}
              </form>
            )}
            <p className="faint small center">
              Server: {getApiUrl().replace(/^https?:\/\//, '')} ·{' '}
              <button className="link" onClick={() => setEditServer(true)}>
                change
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
