// The hand-picked want list, loaded once and kept up to date after every change (the card page's
// "Want it" and the want list share it).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Want, WantInput } from '../../../shared/types.ts';
import { api } from './api.ts';

interface WantsValue {
  /** null until loaded */
  wants: Want[] | null;
  error: string | null;
  reload: () => Promise<void>;
  /** Puts a card on the list, or changes it if that printing is already on it */
  save: (input: WantInput) => Promise<Want>;
  remove: (id: string) => Promise<void>;
  /** card id → its wants (one per printing) */
  byCard: Map<string, Want[]>;
}

const WantsContext = createContext<WantsValue | null>(null);

export function WantsProvider({ children }: { children: ReactNode }) {
  const [wants, setWants] = useState<Want[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setWants((await api.wants()).wants);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const save = useCallback(async (input: WantInput) => {
    const { want } = await api.saveWant(input);
    setWants((list) => [...(list ?? []).filter((w) => w.id !== want.id), want]);
    return want;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteWant(id);
    setWants((list) => (list ?? []).filter((w) => w.id !== id));
  }, []);

  const value = useMemo<WantsValue>(() => {
    const byCard = new Map<string, Want[]>();
    for (const w of wants ?? []) byCard.set(w.cardId, [...(byCard.get(w.cardId) ?? []), w]);
    return { wants, error, reload, save, remove, byCard };
  }, [wants, error, reload, save, remove]);

  return <WantsContext.Provider value={value}>{children}</WantsContext.Provider>;
}

export function useWants(): WantsValue {
  const ctx = useContext(WantsContext);
  if (!ctx) throw new Error('useWants must be used inside <WantsProvider>');
  return ctx;
}
