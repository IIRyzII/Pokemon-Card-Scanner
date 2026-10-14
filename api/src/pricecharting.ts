// Optional graded price points from PriceCharting (needs a paid API token,
// stored as the PRICECHARTING_TOKEN secret). PriceCharting's prices are built
// from completed eBay sales. Docs: https://www.pricecharting.com/api-documentation

import { PRICECHARTING_FIELDS, PRICE_GRADE_KEYS } from '../../shared/grading.ts';
import { priceChartingSearchUrl } from '../../shared/links.ts';
import type { CardInfo, PriceRow } from '../../shared/types.ts';
import { HttpError } from './env.ts';

const API = 'https://www.pricecharting.com/api';

export interface PcProduct {
  id: string;
  'product-name': string;
  'console-name': string;
  [field: string]: unknown;
}

// The API allows one call per second.
let lastCall = 0;
async function call<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `${API}${path}?${new URLSearchParams({ ...params, t: token })}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as (T & { status?: string; 'error-message'?: string }) | null;
  if (!res.ok || !body || body.status === 'error') {
    throw new HttpError(502, `PriceCharting: ${body?.['error-message'] ?? `HTTP ${res.status}`}`);
  }
  return body;
}

export async function pcProduct(token: string, id: string): Promise<PcProduct> {
  return call<PcProduct>('/product', { id }, token);
}

async function pcSearch(token: string, query: string): Promise<PcProduct[]> {
  const body = await call<{ products?: PcProduct[] }>('/products', { q: query }, token);
  return body.products ?? [];
}

const norm = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
const normNumber = (s: string) => s.toUpperCase().replace(/^([A-Z]*)0*(\d)/, '$1$2');

/** How well a PriceCharting product matches our card + printing (higher is better). */
export function scoreProduct(p: PcProduct, card: CardInfo, variant: string): number {
  const name = p['product-name'] ?? '';
  const consoleName = norm(p['console-name'] ?? '');
  if (!consoleName.includes('pokemon') || consoleName.includes('japanese') || consoleName.includes('chinese')) return -1;
  const num = name.match(/#\s*([A-Za-z]*\d+[A-Za-z]*)/)?.[1];
  if (!num || normNumber(num) !== normNumber(card.number)) return -1;

  let score = 50;
  const productWords = new Set(norm(name.replace(/\[[^\]]*\]/g, '')).split(' '));
  const cardWords = norm(card.name).split(' ').filter(Boolean);
  score += (20 * cardWords.filter((w) => productWords.has(w)).length) / Math.max(1, cardWords.length);
  const setWords = norm(card.setName).split(' ').filter((w) => w.length > 1);
  const consoleWords = new Set(consoleName.split(' '));
  score += (30 * setWords.filter((w) => consoleWords.has(w)).length) / Math.max(1, setWords.length);

  const tags = [...name.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].toLowerCase());
  const has = (t: string) => tags.some((x) => x.includes(t));
  if (variant === 'firstEdition') score += has('1st edition') ? 20 : -40;
  else if (has('1st edition')) score -= 40;
  if (variant === 'reverse') score += has('reverse') ? 20 : -40;
  else if (has('reverse')) score -= 40;
  const other = tags.filter((t) => !t.includes('1st edition') && !t.includes('reverse') && t !== 'holo');
  score -= 15 * other.length;
  return score;
}

export async function findProduct(token: string, card: CardInfo, variant: string): Promise<PcProduct | null> {
  const extra = variant === 'firstEdition' ? ' 1st edition' : variant === 'reverse' ? ' reverse holo' : '';
  const products = await pcSearch(token, `${card.name} ${card.number}${extra} ${card.setName}`);
  let best: PcProduct | null = null;
  let bestScore = 60; // minimum acceptable match
  for (const p of products) {
    const score = scoreProduct(p, card, variant);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** All graded/ungraded price points of one product, as our price rows (USD). */
export function productPrices(p: PcProduct, card: CardInfo, variant: string, now: string): PriceRow[] {
  const url = priceChartingSearchUrl(card);
  const rows: PriceRow[] = [];
  for (const key of PRICE_GRADE_KEYS) {
    const pennies = p[PRICECHARTING_FIELDS[key]];
    if (typeof pennies !== 'number' || pennies <= 0) continue;
    rows.push({
      source: 'pricecharting',
      variant,
      gradeKey: key,
      market: Math.round(pennies) / 100,
      low: null,
      mid: null,
      high: null,
      currency: 'USD',
      label: `${p['product-name']} — ${p['console-name']}`,
      url,
      updatedAt: now,
    });
  }
  return rows;
}
