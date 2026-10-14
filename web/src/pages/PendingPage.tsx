import { useState } from 'react';
import { useSession } from '../lib/session.tsx';

export function PendingPage() {
  const { user, refreshUser, signOut } = useSession();
  const [checking, setChecking] = useState(false);
  return (
    <div className="auth">
      <div className="auth-card center">
        <img src="./icons/icon.svg" alt="" width={64} height={64} />
        <h1>Almost there, {user?.displayName}</h1>
        <p className="muted">
          Your account was created. An admin needs to approve it before you can see the collection — ask them to open{' '}
          <b>Admin → Users</b> and give you a role.
        </p>
        <button
          className="btn primary block"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await refreshUser();
            setChecking(false);
          }}
        >
          {checking ? 'Checking…' : 'Check again'}
        </button>
        <button className="btn ghost block" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
