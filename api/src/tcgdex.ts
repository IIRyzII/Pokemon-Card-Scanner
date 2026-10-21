// Card details + raw market prices from the open TCGdex data set (https://tcgdex.dev).
// TCGdex aggregates TCGplayer (USD) and Cardmarket (EUR) prices per printing.

import { VARIANTS, isVariant } from '../../shared/grading.ts';
import type { CardInfo } from '../../shared/types.ts';
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
  /** Per printing; `variantId: "generated"` where TCGdex has no data (it then says "normal") */
  variants_detailed?: { type: string; variantId?: string }[];
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
  // TCGdex has no printings for many Black & White, XY and Sun & Moon cards: it fills in "normal"
  // (marked "generated"), though they come as holos and reverse holos too. Treat those as unknown.
  const guessed = !!raw.variants_detailed?.length && raw.variants_detailed.every((v) => v.variantId === 'generated');
  const variants = guessed ? [] : VARIANTS.filter((v) => raw.variants?.[v]);
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

// Price extraction is shared with the catalog builder (set values).
export { extractPrices, reportedSources, tcgplayerVariant } from '../../shared/market.ts';
