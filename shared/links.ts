// Outbound links: eBay sold listings, PriceCharting, TCGplayer, Serebii, Art of Pokémon.

export interface CardRef {
  name: string;
  number: string;
  setName: string;
  setTotal?: number | null;
}

/** "4/102", "025/165"; prefixed numbers (TG05, SWSH050, H5) are shown as printed. */
export function cardNumberText(number: string, setTotal?: number | null): string {
  return /^\d+$/.test(number) && setTotal ? `${number}/${setTotal}` : number;
}

const q = encodeURIComponent;

export function ebaySoldUrl(
  card: CardRef,
  grader = 'RAW',
  grade?: number | null,
  label?: string | null,
  domain = 'www.ebay.com',
): string {
  const num = cardNumberText(card.number, card.setTotal);
  const parts = [card.name, num];
  if (!num.includes('/')) parts.push(card.setName);
  if (grader !== 'RAW') {
    parts.push(grader === 'OTHER' ? 'graded' : grader);
    if (grade != null) parts.push(String(grade));
    if (label) parts.push(label);
  } else {
    parts.push('-PSA -BGS -CGC -SGC -TAG -graded -slab');
  }
  // LH_Sold + LH_Complete = sold listings only; _sop=13 = most recently ended first.
  return `https://${domain}/sch/i.html?_nkw=${q(parts.join(' '))}&LH_Sold=1&LH_Complete=1&_sop=13`;
}

export function priceChartingSearchUrl(card: CardRef): string {
  return `https://www.pricecharting.com/search-products?type=prices&q=${q(`${card.name} ${card.number} ${card.setName}`)}`;
}

export function tcgplayerUrl(card: CardRef, productId?: number | null): string {
  if (productId) return `https://www.tcgplayer.com/product/${productId}`;
  return `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${q(`${card.name} ${card.setName}`)}`;
}

export function cardmarketSearchUrl(card: CardRef): string {
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${q(card.name)}`;
}

/** Serebii's Cardex lists every card of one Pokémon by National Dex number. */
export function serebiiCardexUrl(dexId: number): string {
  return `https://www.serebii.net/card/dex/${String(dexId).padStart(3, '0')}.shtml`;
}

export function artistSlug(artist: string): string {
  return artist
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function artOfPkmArtistUrl(artist: string): string {
  return `https://www.artofpkm.com/illustrators/${artistSlug(artist)}`;
}
