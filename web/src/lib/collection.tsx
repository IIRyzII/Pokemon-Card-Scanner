// The shared collection, loaded once and refreshed after every change. Its prices are brought up
// to date whenever the app opens.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionItem, CollectionResponse } from '../../../shared/types.ts';
import { api } from './api.ts';

interface CollectionValue {
  data: CollectionResponse | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** card id → active copies of that card */
  ownedByCard: Map<string, CollectionItem[]>;
  /** Out-of-date prices are being fetched again (the app just opened). */
  pricesUpdating: boolean;
}

/**
 * Coming back to the app after this long counts as opening it again: phones usually resume an
 * app rather than start it afresh. (The server only fetches prices that are a few hours old.)
 */
const PRICE_CHECK_EVERY_MS = 30 * 60_000;

const CollectionContext = createContext<CollectionValue | null>(null);

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pricesUpdating, setPricesUpdating] = useState(false);
  const lastPriceCheck = useRef(0);

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

  const refreshPrices = useCallback(async () => {
    if (Date.now() - lastPriceCheck.current < PRICE_CHECK_EVERY_MS) return;
    lastPriceCheck.current = Date.now();
    setPricesUpdating(true);
    try {
      // The server does a batch of cards per call, so a big collection takes a few.
      for (let round = 0; round < 30; round++) {
        const { refreshed, failed, remaining } = await api.refreshPrices();
        if (refreshed || failed) setData(await api.collection());
        if (!remaining) break;
      }
    } catch {
      // Offline or the server is busy: the server's hourly refresh carries on regardless.
    } finally {
      setPricesUpdating(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void refreshPrices();
    // Pick up changes made on another device when the app comes back to the foreground.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void reload();
      void refreshPrices();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload, refreshPrices]);

  const ownedByCard = useMemo(() => {
    const map = new Map<string, CollectionItem[]>();
    for (const item of data?.items ?? []) {
      const list = map.get(item.cardId);
      if (list) list.push(item);
      else map.set(item.cardId, [item]);
    }
    return map;
  }, [data]);

  const value = useMemo(
    () => ({ data, error, loading, reload, ownedByCard, pricesUpdating }),
    [data, error, loading, reload, ownedByCard, pricesUpdating],
  );
  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>;
}

export function useCollection(): CollectionValue {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error('useCollection must be used inside <CollectionProvider>');
  return ctx;
}

export const ownedCount = (items: CollectionItem[] | undefined) => (items ?? []).reduce((n, i) => n + i.quantity, 0);
