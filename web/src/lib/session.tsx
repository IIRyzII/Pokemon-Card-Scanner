import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ApiStatus, User } from '../../../shared/types.ts';
import { ApiError, api, getApiUrl, getToken, onUnauthorized, setToken } from './api.ts';
import { derivePasswordKey } from './password.ts';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  user: User | null;
  server: ApiStatus | null;
  serverError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, displayName: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the signed-in user (e.g. after an admin approves them). */
  refreshUser: () => Promise<void>;
  /** Re-checks the server (after changing the API address); true when it answered. */
  reloadServer: () => Promise<boolean>;
  setUser: (user: User) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<User | null>(null);
  const [server, setServer] = useState<ApiStatus | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const reloadServer = useCallback(async () => {
    if (!getApiUrl()) {
      setServer(null);
      setServerError(null);
      return false;
    }
    try {
      setServer(await api.status());
      setServerError(null);
      return true;
    } catch (err) {
      setServer(null);
      setServerError((err as Error).message);
      return false;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (!getToken() || !getApiUrl()) {
      setStatus('signedOut');
      return;
    }
    try {
      const { user } = await api.me();
      setUserState(user);
      setStatus('signedIn');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setToken(null);
      setUserState(null);
      setStatus('signedOut');
    }
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setToken(null);
      setUserState(null);
      setStatus('signedOut');
    });
    void reloadServer();
    void refreshUser();
  }, [reloadServer, refreshUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const key = await derivePasswordKey(email, password);
    const res = await api.login(email, key);
    setToken(res.token);
    setUserState(res.user);
    setStatus('signedIn');
  }, []);

  const register = useCallback(
    async (email: string, displayName: string, password: string) => {
      const key = await derivePasswordKey(email, password);
      const res = await api.register(email, displayName, key);
      setToken(res.token);
      setUserState(res.user);
      setStatus('signedIn');
      void reloadServer();
    },
    [reloadServer],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // signing out locally is what matters
    }
    setToken(null);
    setUserState(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      server,
      serverError,
      signIn,
      register,
      signOut,
      refreshUser,
      reloadServer,
      setUser: setUserState,
    }),
    [status, user, server, serverError, signIn, register, signOut, refreshUser, reloadServer],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
