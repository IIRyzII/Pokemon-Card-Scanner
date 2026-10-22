// How much is a copy worth? One function used by the API (to store each item's
// value) and the web app (to preview a value before adding a card).
// Prices come in several currencies (TCGplayer/PriceCharting USD, Cardmarket EUR,
// logged sales in whatever they were entered in) and are converted to one.

import { convert, type FxRates } from './currency.ts';
import { PRICE_GRADE_LABELS, gradeText, priceGradeKey } from './grading.ts';
import { basePrinting, isSpecialPrinting } from './printings.ts';

export interface PriceRow {
  source: 'tcgplayer' | 'cardmarket' | 'pricecharting';
  /** Our variant key (normal, holo, reverse, firstEdition, wPromo); Cardmarket uses 'main' / 'holo' */
  variant: string;
  /** 'ungraded' for market prices, otherwise a PriceGradeKey */
  gradeKey: string;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  currency: string;
  label: string | null;
  url: string | null;
  updatedAt: string;
}

export interface SaleRow {
  id: string;
  cardId: string;
  grader: string;
  grade: number | null;
  gradeLabel: string | null;
  price: number;
  currency: string;
  soldOn: string;
  source: string;
  url: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ItemLike {
  variant: string;
  /** Language code; English when left out */
  language?: string | null;
  grader: string;
  grade: number | null;
  gradeLabel: string | null;
}

/** The currency to value things in, plus the exchange rates to get there. */
export interface ValueContext {
  currency: string;
  fx: FxRates | null;
}

export interface Valuation {
  /** Value of one copy in ctx.currency */
  unit: number | null;
  currency: string;
  source: 'tcgplayer' | 'cardmarket' | 'pricecharting' | 'sales' | null;
  detail: string;
}

export interface SalesSummary {
  count: number;
  last: SaleRow | null;
  /** The last sale's price converted to the target currency */
  lastPrice: number | null;
  /** Median of the most recent (up to) five sales, in the target currency */
  median: number | null;
}

const RECENT_SALE_DAYS = 180;

export function matchingSales(sales: SaleRow[], grader: string, grade: number | null, label: string | null): SaleRow[] {
  return sales
    .filter(
      (s) =>
        s.grader === grader &&
        (grader === 'RAW' || (s.grade ?? null) === (grade ?? null)) &&
        (grader === 'RAW' || (s.gradeLabel ?? null) === (label ?? null)),
    )
    .sort((a, b) => b.soldOn.localeCompare(a.soldOn) || b.createdAt.localeCompare(a.createdAt));
}

export function summarizeSales(sorted: SaleRow[], ctx: ValueContext): SalesSummary {
  const inCurrency = (s: SaleRow) => convert(s.price, s.currency, ctx.currency, ctx.fx);
  const recent = sorted
    .slice(0, 5)
    .map(inCurrency)
    .filter((v): v is number => v !== null);
  const last = sorted[0] ?? null;
  return { count: sorted.length, last, lastPrice: last ? inCurrency(last) : null, median: median(recent) };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round(((v[mid - 1] + v[mid]) / 2) * 100) / 100;
}

function daysAgo(isoDate: string, now: Date): number {
  return (now.getTime() - new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000;
}

/**
 * Cardmarket reports a main price and a "holo" price (the reverse holo for modern cards); a special
 * printing (a cosmos holo, a stamped version) is a product of its own, with a row of its own.
 */
function cardmarketVariant(variant: string): string | null {
  if (isSpecialPrinting(variant)) return variant;
  if (variant === 'reverse') return 'holo';
  if (variant === 'firstEdition') return null; // Cardmarket's top-level price is the unlimited print
  return 'main';
}

export function valueItem(item: ItemLike, prices: PriceRow[], sales: SaleRow[], ctx: ValueContext, now = new Date()): Valuation {
  const conv = (amount: number | null, from: string) => (amount === null ? null : convert(amount, from, ctx.currency, ctx.fx));
  const result = (unit: number | null, source: Valuation['source'], detail: string): Valuation => ({
    unit,
    currency: ctx.currency,
    source,
    detail,
  });
  const sold = matchingSales(sales, item.grader, item.grade, item.gradeLabel);
  const recentSold = sold.filter((s) => daysAgo(s.soldOn, now) <= RECENT_SALE_DAYS);
  const fromSales = (list: SaleRow[]): Valuation | null => {
    const m = summarizeSales(list, ctx).median;
    const n = Math.min(list.length, 5);
    return m === null ? null : result(m, 'sales', `Median of last ${n} logged sale${n === 1 ? '' : 's'}`);
  };
  const fromRow = (row: PriceRow | undefined, source: Valuation['source'], detail: string): Valuation | null => {
    const unit = row ? conv(row.market, row.currency) : null;
    if (unit === null || !row) return null;
    const converted = row.currency !== ctx.currency ? ` (converted from ${row.currency})` : '';
    return result(unit, source, `${detail}${converted}`);
  };
  const pcRow = (gradeKey: string) =>
    prices.find((p) => p.source === 'pricecharting' && p.variant === item.variant && p.gradeKey === gradeKey && p.market != null);

  if (item.grader === 'RAW') {
    const cmVariant = cardmarketVariant(item.variant);
    const english = (item.language ?? 'en') === 'en';
    const tcgplayer = () =>
      fromRow(
        prices.find((p) => p.source === 'tcgplayer' && p.variant === item.variant && p.market != null),
        'tcgplayer',
        english ? 'TCGplayer market price' : 'TCGplayer market price (English copies)',
      );
    const priceCharting = () => fromRow(pcRow('ungraded'), 'pricecharting', 'PriceCharting ungraded');
    // A special printing with no price of its own yet: its plain printing's, said so.
    const plainPrinting = (): Valuation | null => {
      if (!isSpecialPrinting(item.variant)) return null;
      const plain = valueItem({ ...item, variant: basePrinting(item.variant) }, prices, sales, ctx, now);
      return plain.unit === null ? null : { ...plain, detail: `${plain.detail}, for its plain printing (none for this one yet)` };
    };
    const cardmarket = () =>
      fromRow(
        cmVariant ? prices.find((p) => p.source === 'cardmarket' && p.variant === cmVariant && p.market != null) : undefined,
        'cardmarket',
        'Cardmarket trend (all languages)',
      );
    // TCGplayer only sells English copies; French, German and the rest trade on Cardmarket, whose
    // price covers every language.
    return (
      (english ? (tcgplayer() ?? priceCharting() ?? cardmarket()) : (cardmarket() ?? tcgplayer() ?? priceCharting())) ??
      (sold.length ? fromSales(recentSold.length ? recentSold : sold) : null) ??
      plainPrinting() ??
      result(null, null, 'No raw price yet')
    );
  }

  const key = priceGradeKey(item.grader, item.grade, item.gradeLabel);
  const pcDetail = key ? `PriceCharting ${PRICE_GRADE_LABELS[key]}${key.startsWith('g') ? ' (any grader)' : ''}` : '';
  return (
    (recentSold.length ? fromSales(recentSold) : null) ??
    (key ? fromRow(pcRow(key), 'pricecharting', pcDetail) : null) ??
    (sold.length ? fromSales(sold) : null) ??
    result(null, null, `No ${gradeText(item.grader, item.grade, item.gradeLabel)} price yet — log an eBay sale`)
  );
}
