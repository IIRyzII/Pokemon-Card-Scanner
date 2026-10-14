// Which currency prices are shown in. Defaults to the collection's home currency
// (set on the server); each person can pick their own in Account → Currency.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CURRENCY_INFO, convert as convertFx, isCurrency, type Currency } from '../../../shared/currency.ts';
import type { ValueContext } from '../../../shared/values.ts';
import { money } from './format.ts';
import { useSession } from './session.tsx';

const KEY = 'pokevault.currency';

function readChoice(): Currency | null {
  try {
    const v = localStorage.getItem(KEY);
    return isCurrency(v) ? v : null;
  } catch {
    return null;
  }
}

interface CurrencyValue {
  /** Currency prices are shown in */
  currency: Currency;
  /** The collection's home currency (from the server) */
  home: Currency;
  /** True when this person picked a currency (rather than following the home one) */
  chosen: boolean;
  ratesDate: string | null;
  setCurrency: (c: Currency | null) => void;
  /** Converts into the display currency; null if no rate is known */
  convert: (amount: number | null | undefined, from: string) => number | null;
  /** Converted + formatted, e.g. "£12.34"; falls back to the original currency if it can't convert */
  format: (amount: number | null | undefined, from: string, opts?: { round?: boolean }) => string;
  /** For valuing a copy in the display currency */
  ctx: ValueContext;
  ebayDomain: string;
}

const CurrencyContext = createContext<CurrencyValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { server } = useSession();
  const [choice, setChoice] = useState<Currency | null>(readChoice);
  const home: Currency = isCurrency(server?.currency) ? server.currency : 'USD';
  const currency = choice ?? home;
  const fx = server?.fx ?? null;

  const setCurrency = useCallback((c: Currency | null) => {
    setChoice(c);
    try {
      if (c) localStorage.setItem(KEY, c);
      else localStorage.removeItem(KEY);
    } catch {
      // stays for this visit only
    }
  }, []);

  const value = useMemo<CurrencyValue>(() => {
    const convert = (amount: number | null | undefined, from: string) =>
      amount === null || amount === undefined ? null : convertFx(amount, from, currency, fx);
    return {
      currency,
      home,
      chosen: choice !== null,
      ratesDate: fx?.date ?? null,
      setCurrency,
      convert,
      format: (amount, from, opts) => {
        if (amount === null || amount === undefined) return '—';
        const converted = convert(amount, from);
        return converted === null ? money(amount, from, opts) : money(converted, currency, opts);
      },
      ctx: { currency, fx },
      ebayDomain: CURRENCY_INFO[currency].ebay,
    };
  }, [currency, home, choice, fx, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used inside <CurrencyProvider>');
  return ctx;
}
