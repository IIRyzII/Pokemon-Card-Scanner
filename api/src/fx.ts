// Exchange rates from the European Central Bank's free daily reference feed.
// Cached in D1 and refreshed at most every 12 hours (the ECB publishes once a day).

import { isCurrency, parseEcbXml, type Currency, type FxRates } from '../../shared/currency.ts';
import { nowIso, type Env } from './env.ts';

const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const MAX_AGE_MS = 12 * 3_600_000;

/** The collection's home currency: values and totals are stored in it. */
export const homeCurrency = (env: Env): Currency => (isCurrency(env.CURRENCY) ? env.CURRENCY : 'USD');

export async function getRates(env: Env): Promise<FxRates | null> {
  const row = await env.DB.prepare('SELECT rates_date, per_eur, fetched_at FROM fx_rates WHERE id = 1').first<{
    rates_date: string;
    per_eur: string;
    fetched_at: string;
  }>();
  const cached: FxRates | null = row ? { date: row.rates_date, perEur: JSON.parse(row.per_eur) as Record<string, number> } : null;
  if (row && Date.now() - Date.parse(row.fetched_at) < MAX_AGE_MS) return cached;
  try {
    const res = await fetch(ECB_URL, { headers: { 'User-Agent': 'PokeVault-API/1.0' } });
    const fresh = res.ok ? parseEcbXml(await res.text()) : null;
    if (!fresh) return cached;
    await env.DB.prepare(
      `INSERT INTO fx_rates (id, rates_date, per_eur, fetched_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET rates_date = excluded.rates_date, per_eur = excluded.per_eur, fetched_at = excluded.fetched_at`,
    )
      .bind(fresh.date, JSON.stringify(fresh.perEur), nowIso())
      .run();
    return fresh;
  } catch {
    return cached; // keep using yesterday's rates rather than failing
  }
}
