// Currencies the app can show prices in, and conversion using the European
// Central Bank's daily reference rates (quoted as units per 1 EUR).

export const CURRENCIES = ['GBP', 'USD', 'EUR', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (v: unknown): v is Currency =>
  typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v);

export const CURRENCY_INFO: Record<Currency, { label: string; locale: string; ebay: string }> = {
  GBP: { label: 'British pound (£)', locale: 'en-GB', ebay: 'www.ebay.co.uk' },
  USD: { label: 'US dollar ($)', locale: 'en-US', ebay: 'www.ebay.com' },
  EUR: { label: 'Euro (€)', locale: 'en-IE', ebay: 'www.ebay.de' },
  CAD: { label: 'Canadian dollar (CA$)', locale: 'en-CA', ebay: 'www.ebay.ca' },
  AUD: { label: 'Australian dollar (A$)', locale: 'en-AU', ebay: 'www.ebay.com.au' },
};

export interface FxRates {
  /** Date the ECB published these rates (YYYY-MM-DD) */
  date: string;
  /** Units of each currency per 1 EUR; EUR itself is 1 */
  perEur: Record<string, number>;
}

/** Converts an amount between currencies; null when a rate is unknown. */
export function convert(amount: number, from: string, to: string, fx: FxRates | null | undefined): number | null {
  if (from === to) return amount;
  const rateFrom = from === 'EUR' ? 1 : fx?.perEur[from];
  const rateTo = to === 'EUR' ? 1 : fx?.perEur[to];
  if (!rateFrom || !rateTo) return null;
  return Math.round((amount / rateFrom) * rateTo * 100) / 100;
}

/** Parses https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml */
export function parseEcbXml(xml: string): FxRates | null {
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const perEur: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
    const rate = Number(m[2]);
    if (rate > 0) perEur[m[1]] = rate;
  }
  return date && perEur.USD && perEur.GBP ? { date, perEur } : null;
}
