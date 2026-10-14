// Card details + raw market prices from the open TCGdex data set (https://tcgdex.dev).
// TCGdex aggregates TCGplayer (USD) and Cardmarket (EUR) prices per printing.

import { VARIANTS, isVariant } from '../../shared/grading.ts';
import type { CardInfo, PriceRow } from '../../shared/types.ts';
import { HttpError, type Env } from './env.ts';

const DEFAULT_API = 'https://api.tcgdex.net/v2/en';

export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  illustrator?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  regulationMark?: string;
  dexId?: number[];
  variants?: Record<string, boolean>;
  set: { id: string; name: string; cardCount?: { official?: number; total?: number } };
  pricing?: {
    tcgplayer?: Record<string, unknown> | null;
    cardmarket?: Record<string, unknown> | null;
  } | null;
}

export interface TcgdexSetInfo {
  releaseDate: string | null;
  serieName: string | null;
  code: string | null;
}

async function get<T>(env: Env, path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${env.TCGDEX_API ?? DEFAULT_API}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'PokeVault-API/1.0' },
    });
  } catch {
    throw new HttpError(502, 'Card data service is unreachable — try again shortly');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `Card data service error (${res.status})`);
  return (await res.json()) as T;
}

export const fetchTcgdexCard = (env: Env, cardId: string) =>
  get<TcgdexCard>(env, `/cards/${encodeURIComponent(cardId)}`);

export async function fetchTcgdexSet(env: Env, setId: string): Promise<TcgdexSetInfo | null> {
  const set = await get<{ releaseDate?: string; serie?: { name?: string }; abbreviation?: { official?: string } }>(
    env,
    `/sets/${encodeURIComponent(setId)}`,
  );
  if (!set) return null;
  return {
    releaseDate: set.releaseDate ?? null,
    serieName: set.serie?.name ?? null,
    code: set.abbreviation?.official ?? null,
  };
}

export function normalizeCard(raw: TcgdexCard, set: TcgdexSetInfo | null): CardInfo {
  const variants = VARIANTS.filter((v) => raw.variants?.[v]);
  return {
    id: raw.id,
    name: raw.name,
    number: raw.localId,
    setId: raw.set.id,
    setName: raw.set.name,
    setTotal: raw.set.cardCount?.official ?? null,
    setCode: set?.code ?? null,
    serieName: set?.serieName ?? null,
    releaseDate: set?.releaseDate ?? null,
    rarity: raw.rarity && raw.rarity !== 'None' ? raw.rarity : null,
    artist: raw.illustrator?.trim() || null,
    image: raw.image ?? null,
    dexId: raw.dexId?.[0] ?? null,
    category: raw.category ?? null,
    hp: typeof raw.hp === 'number' ? raw.hp : null,
    types: Array.isArray(raw.types) ? raw.types : [],
    // Unknown variants: let the user choose any common printing.
    variants: variants.length ? variants : ['normal', 'holo', 'reverse', 'firstEdition'].filter(isVariant),
    regulationMark: raw.regulationMark ?? null,
  };
}

/** TCGplayer's printing names → our variant keys. */
export function tcgplayerVariant(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('1st')) return 'firstEdition';
  if (k.includes('reverse')) return 'reverse';
  if (k.includes('holo')) return 'holo';
  if (k.includes('normal')) return 'normal';
  return k;
}

const price = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

export function extractPrices(raw: TcgdexCard, now: string): PriceRow[] {
  const rows: PriceRow[] = [];
  const tcg = raw.pricing?.tcgplayer;
  if (tcg && typeof tcg === 'object') {
    const updated = typeof tcg.updated === 'string' ? tcg.updated : now;
    for (const [key, value] of Object.entries(tcg)) {
      if (key === 'unit' || key === 'updated' || !value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      const row: PriceRow = {
        source: 'tcgplayer',
        variant: tcgplayerVariant(key),
        gradeKey: 'ungraded',
        market: price(v.marketPrice),
        low: price(v.lowPrice),
        mid: price(v.midPrice),
        high: price(v.highPrice),
        currency: 'USD',
        label: key,
        url: typeof v.productId === 'number' ? `https://www.tcgplayer.com/product/${v.productId}` : null,
        updatedAt: updated,
      };
      if (row.market ?? row.low ?? row.mid ?? row.high) rows.push(row);
    }
  }
  const cm = raw.pricing?.cardmarket;
  if (cm && typeof cm === 'object') {
    const updated = typeof cm.updated === 'string' ? cm.updated : now;
    const base = { source: 'cardmarket' as const, gradeKey: 'ungraded', high: null, currency: 'EUR', url: null, updatedAt: updated };
    const main = { market: price(cm.trend), low: price(cm.low), mid: price(cm.avg30) };
    const holo = { market: price(cm['trend-holo']), low: price(cm['low-holo']), mid: price(cm['avg30-holo']) };
    if (main.market ?? main.mid) rows.push({ ...base, ...main, variant: 'main', label: 'Cardmarket' });
    if (holo.market ?? holo.mid) rows.push({ ...base, ...holo, variant: 'holo', label: 'Cardmarket (holo / reverse)' });
  }
  return rows;
}
