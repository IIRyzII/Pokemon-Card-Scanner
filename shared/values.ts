// How much is a copy worth? One function used by the API (to store each item's
// value) and the web app (to preview a value before adding a card).

import { PRICE_GRADE_LABELS, gradeText, priceGradeKey } from './grading.ts';

export interface PriceRow {
  source: 'tcgplayer' | 'cardmarket' | 'pricecharting';
  /** Our variant key (normal, holo, reverse, firstEdition, wPromo) */
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
  soldOn: string;
  source: string;
  url: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ItemLike {
  variant: string;
  grader: string;
  grade: number | null;
  gradeLabel: string | null;
}

export interface Valuation {
  unit: number | null;
  source: 'tcgplayer' | 'pricecharting' | 'sales' | null;
  detail: string;
}

export interface SalesSummary {
  count: number;
  last: SaleRow | null;
  /** Median of the most recent (up to) five sales */
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

export function summarizeSales(sorted: SaleRow[]): SalesSummary {
  const recent = sorted.slice(0, 5).map((s) => s.price);
  return { count: sorted.length, last: sorted[0] ?? null, median: median(recent) };
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

export function valueItem(item: ItemLike, prices: PriceRow[], sales: SaleRow[], now = new Date()): Valuation {
  const sold = matchingSales(sales, item.grader, item.grade, item.gradeLabel);
  const recentSold = sold.filter((s) => daysAgo(s.soldOn, now) <= RECENT_SALE_DAYS);
  const fromSales = (list: SaleRow[]): Valuation => ({
    unit: summarizeSales(list).median,
    source: 'sales',
    detail: `Median of last ${Math.min(list.length, 5)} logged sale${list.length === 1 ? '' : 's'}`,
  });
  const pcRow = (gradeKey: string) =>
    prices.find(
      (p) => p.source === 'pricecharting' && p.variant === item.variant && p.gradeKey === gradeKey && p.market != null,
    );

  if (item.grader === 'RAW') {
    const tcg = prices.find((p) => p.source === 'tcgplayer' && p.variant === item.variant && p.market != null);
    if (tcg) return { unit: tcg.market, source: 'tcgplayer', detail: 'TCGplayer market price' };
    const pc = pcRow('ungraded');
    if (pc) return { unit: pc.market, source: 'pricecharting', detail: 'PriceCharting ungraded' };
    if (sold.length) return fromSales(recentSold.length ? recentSold : sold);
    return { unit: null, source: null, detail: 'No raw price yet' };
  }

  if (recentSold.length) return fromSales(recentSold);
  const key = priceGradeKey(item.grader, item.grade, item.gradeLabel);
  const pc = key ? pcRow(key) : undefined;
  if (pc && key) {
    const generic = key.startsWith('g');
    return {
      unit: pc.market,
      source: 'pricecharting',
      detail: `PriceCharting ${PRICE_GRADE_LABELS[key]}${generic ? ' (any grader)' : ''}`,
    };
  }
  if (sold.length) return fromSales(sold);
  return {
    unit: null,
    source: null,
    detail: `No ${gradeText(item.grader, item.grade, item.gradeLabel)} price yet — log an eBay sale`,
  };
}
