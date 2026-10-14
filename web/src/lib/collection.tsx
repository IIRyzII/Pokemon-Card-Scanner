// The shared collection, loaded once and refreshed after every change.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CollectionItem, CollectionResponse } from '../../../shared/types.ts';
import { api } from './api.ts';

interface CollectionValue {
  data: CollectionResponse | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** card id → active copies of that card */
  ownedByCard: Map<string, CollectionItem[]>;
}

const CollectionContext = createContext<CollectionValue | null>(null);

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.collection());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Pick up changes made on another device when the app comes back to the foreground.
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const ownedByCard = useMemo(() => {
    const map = new Map<string, CollectionItem[]>();
    for (const item of data?.items ?? []) {
      const list = map.get(item.cardId);
      if (list) list.push(item);
      else map.set(item.cardId, [item]);
    }
    return map;
  }, [data]);

  const value = useMemo(() => ({ data, error, loading, reload, ownedByCard }), [data, error, loading, reload, ownedByCard]);
  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>;
}

export function useCollection(): CollectionValue {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error('useCollection must be used inside <CollectionProvider>');
  return ctx;
}

export const ownedCount = (items: CollectionItem[] | undefined) => (items ?? []).reduce((n, i) => n + i.quantity, 0);
