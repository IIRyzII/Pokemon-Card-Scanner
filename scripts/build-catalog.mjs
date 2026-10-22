#!/usr/bin/env node
// Builds PokéVault's own card catalog (sets, cards, artists, rarities) from the
// open TCGdex data set and writes it as static JSON that GitHub Pages serves.
// The web app searches and identifies scanned cards against this file, so it
// never depends on a third-party API at runtime.
//
// It also fingerprints every card's picture (prints.bin) so the scanner can recognise a card by
// how it looks. Prints already published are reused, so only new cards' pictures are downloaded.
// And it records every card's market price (prices.json) for set values; those are refreshed
// when they're more than a few days old.
//
// Cardmarket's prices come from Cardmarket itself (its public product list and daily price guide),
// not TCGdex's copy: TCGdex links some cards to the wrong Cardmarket product (Rayquaza ☆ to the
// plain Rayquaza), so every card's link is checked against its name and attacks and corrected
// (shared/cardmarket.ts). They're published per set (cardmarket/<set>.json) for the API.
//
// And every card's exact printings from TCGdex's details: its special ones too (a cosmos holo from
// a blister pack, a set-logo or store stamp), which of them are promos rather than in the set's
// packs, and which stamped promo-set cards are versions of a set's own (SVP 057 Chi-Yu, Paradox
// Rift's Build & Battle promo): what a grand master set binder is made of (shared/printings.ts).
//
// Usage: node --experimental-strip-types scripts/build-catalog.mjs [--out web/public/catalog] [--if-missing] [--fallback-url https://you.github.io/repo/catalog] [--prices-max-age-days 6]
//   --if-missing:   do nothing when a catalog already exists (used by `npm run dev`).
//   --fallback-url: the published catalog: prints and recent prices are reused from it, and if
//                   TCGdex is unreachable the whole catalog is copied from it instead of failing.
//   --prices-max-age-days: reuse earlier prices younger than this (default 6), else fetch them all.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { cardPrint, PRINT_SPEC, PRINT_WORDS } from '../shared/cardprint.ts';
import { VARIANTS } from '../shared/grading.ts';
import { cardPrintings, inferPrintings, isSpecialPrinting, parsePrinting, printingKey, setPromoPrintings, stampedPromoLinks } from '../shared/printings.ts';
import { cardmarketIndex, cardmarketName, cardmarketPrices, cardmarketRows, entryOf, linkSet, pricesOf, productParts } from '../shared/cardmarket.ts';
import { extractPrices, reportedSources, standardPrice } from '../shared/market.ts';

const API = 'https://api.tcgdex.net/v2/en';
const GQL = 'https://api.tcgdex.net/v2/graphql';
const CARDMARKET = 'https://downloads.s3.cardmarket.com/productCatalog';
const IMAGE_BASE = 'https://assets.tcgdex.net/en';
// Pokémon TCG Pocket is a digital-only game, so its cards can never be scanned.
const EXCLUDED_SERIES = new Set(['tcgp']);
const CONCURRENCY = 6;
const USER_AGENT = 'PokeVault-catalog-builder/1.0 (+https://github.com)';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT_DIR = path.resolve(argValue('--out') ?? 'web/public/catalog');
const FALLBACK_URL = argValue('--fallback-url');
const PRICES_MAX_AGE_DAYS = Number(argValue('--prices-max-age-days') ?? 6);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, init = {}, attempt = 1) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 5) throw err;
    await sleep(500 * 2 ** attempt);
    return getJSON(url, init, attempt + 1);
  }
}

/** Raw bytes of a URL, or null if it doesn't exist. */
async function getBytes(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (attempt >= 4) throw err;
    await sleep(500 * 2 ** attempt);
    return getBytes(url, attempt + 1);
  }
}

async function graphql(query) {
  const body = await getJSON(GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (body?.errors?.length) throw new Error(`GraphQL: ${body.errors[0].message}`);
  return body.data;
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Repairs malformed illustrator strings from the source data. */
function cleanArtistName(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (s.includes('"')) {
    // Seen in the data: '"Big Mama" Tagawa"' and '"Big Mama" Tagawa"Big Mama" Tagawa'
    const half = s.length / 2;
    if (Number.isInteger(half) && s.slice(0, half) === s.slice(half)) s = s.slice(0, half);
    if ((s.match(/"/g) ?? []).length % 2 === 1) s = s.replace(/"([^"]*)$/, '$1').trim();
  }
  return s;
}

// Spacing/case/accents are ignored so "aky CG Works" and "akyCG Works" group together.
const artistKey = (name) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const isMixedCase = (s) => s !== s.toLowerCase() && s !== s.toUpperCase();
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-.'"(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

// Open card data whose rarities tell holo rares from plain ones ("Rare Holo" / "Rare"), which
// TCGdex's don't for the sets it has no printings for. Static files on GitHub, no API.
const PTCG_DATA = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const PTCG_SET_IDS = { 'sm3.5': 'sm35', 'sm7.5': 'sm75' };
/** "SV01" → "SV1", "025" → "25": card numbers as both sources can agree on. */
const numberKey = (n) => String(n).toUpperCase().replace(/(^|[A-Z])0+(?=\d)/g, '$1');

/**
 * TCGdex has no printing data for some sets: it marks every card in them "normal" (most Black &
 * White, XY and Sun & Moon sets). Their printings are worked out from each card's rarity instead.
 */
async function inferMissingPrintings(sets, cards, variantBits, rarityByCard) {
  const bySet = new Map();
  for (const c of cards) bySet.set(c.setId, [...(bySet.get(c.setId) ?? []), c]);
  const missing = [...bySet].filter(([, list]) => list.every((c) => ((variantBits.get(c.id) ?? 0) & ~1) === 0)).map(([id]) => id);
  if (!missing.length) return;
  console.log(`Working out printings for ${missing.length} sets TCGdex has none for…`);
  const ptcgSets = (await getJSON(`${PTCG_DATA}/sets/en.json`).catch(() => null)) ?? [];
  const ptcgIds = new Set(ptcgSets.map((s) => s.id));
  const ptcgByName = new Map(ptcgSets.map((s) => [s.name.toLowerCase(), s.id]));
  let fromPtcg = 0;
  let inferred = 0;
  await pool(missing, CONCURRENCY, async (setId) => {
    const name = sets.find((s) => s.id === setId)?.name?.toLowerCase();
    const ptcgId = PTCG_SET_IDS[setId] ?? (ptcgIds.has(setId) ? setId : ptcgByName.get(name));
    const ptcgCards = ptcgId ? ((await getJSON(`${PTCG_DATA}/cards/en/${ptcgId}.json`).catch(() => null)) ?? []) : [];
    const rarityByNumber = new Map(ptcgCards.map((c) => [numberKey(c.number), c.rarity]));
    for (const c of bySet.get(setId)) {
      const ptcgRarity = rarityByNumber.get(numberKey(c.localId));
      if (ptcgRarity) fromPtcg++;
      const printings = inferPrintings({ setId, name: c.name, rarity: ptcgRarity ?? rarityByCard.get(c.id) ?? null });
      variantBits.set(c.id, printings.reduce((bits, v) => bits | (1 << VARIANTS.indexOf(v)), 0));
      inferred++;
    }
  });
  console.log(`  ${inferred} cards (${fromPtcg} with pokemon-tcg-data's rarity, the rest with TCGdex's)`);
}

async function build() {
  console.log('Fetching sets…');
  const { sets: rawSets } = await graphql(
    '{ sets { id name releaseDate cardCount { official total } serie { id name } logo symbol } }',
  );
  const sets = rawSets.filter((s) => s && !EXCLUDED_SERIES.has(s.serie?.id));
  console.log(`  ${sets.length} sets (${rawSets.length - sets.length} digital-only skipped)`);

  console.log('Fetching set codes (e.g. "MEW", "SVI")…');
  await pool(sets, CONCURRENCY, async (s) => {
    const detail = await getJSON(`${API}/sets/${encodeURIComponent(s.id)}`);
    s.code = detail?.abbreviation?.official ?? null;
  });

  console.log('Fetching all cards…');
  const allCards = await getJSON(`${API}/cards`);
  const setById = new Map(sets.map((s) => [s.id, s]));
  const allSetIds = new Set(rawSets.filter(Boolean).map((s) => s.id));
  const setIdsByLength = [...allSetIds].sort((a, b) => b.length - a.length);

  const cards = [];
  let unknownSet = 0;
  for (const c of allCards) {
    let setId = c.id.endsWith(`-${c.localId}`) ? c.id.slice(0, -(c.localId.length + 1)) : null;
    if (!setId || !allSetIds.has(setId)) setId = setIdsByLength.find((id) => c.id.startsWith(`${id}-`)) ?? null;
    if (!setId) {
      unknownSet++;
      continue;
    }
    const set = setById.get(setId);
    if (!set) continue; // belongs to an excluded (digital) series
    cards.push({ id: c.id, name: c.name, localId: c.localId, setId, image: c.image ?? null });
  }
  console.log(`  ${cards.length} physical cards${unknownSet ? ` (${unknownSet} with unknown set skipped)` : ''}`);
  const cardIds = new Set(cards.map((c) => c.id));

  // The list endpoint returns brief rows only, so artist/rarity/category are
  // attached by querying each facet value once (a few hundred small requests
  // instead of ~21k per-card requests).
  async function facet(listPath, filterKey, label) {
    const values = (await getJSON(`${API}/${listPath}`)) ?? [];
    console.log(`Mapping ${values.length} ${label}…`);
    const map = new Map();
    await pool(values, CONCURRENCY, async (value) => {
      const rows = await getJSON(`${API}/cards?${filterKey}=${encodeURIComponent(`eq:${value}`)}`);
      for (const row of rows ?? []) if (cardIds.has(row.id) && !map.has(row.id)) map.set(row.id, value);
    });
    return map;
  }
  const artistByCard = await facet('illustrators', 'illustrator', 'artists');
  const rarityByCard = await facet('rarities', 'rarity', 'rarities');
  const categoryByCard = await facet('categories', 'category', 'categories');
  const hpByCard = await facet('hp', 'hp', 'HP values');

  // Which printings each card comes in (for binders): one filtered list per printing, as bits in
  // VARIANTS order (normal = 1, holo = 2, reverse = 4, …).
  console.log('Mapping printings…');
  const variantBits = new Map();
  await pool([...VARIANTS], CONCURRENCY, async (variant, bit) => {
    const rows = await getJSON(`${API}/cards?variants.${variant}=true`);
    for (const row of rows ?? []) if (cardIds.has(row.id)) variantBits.set(row.id, (variantBits.get(row.id) ?? 0) | (1 << bit));
  });
  console.log(`  ${variantBits.size} cards with known printings`);
  await inferMissingPrintings(sets, cards, variantBits, rarityByCard);

  // Group artist spellings ("MIKI KUDO", "miki kudo", "Miki Kudo") under one display name.
  const spellings = new Map(); // key -> Map(spelling -> count)
  for (const raw of artistByCard.values()) {
    const name = cleanArtistName(raw);
    if (!name) continue;
    const key = artistKey(name);
    if (!spellings.has(key)) spellings.set(key, new Map());
    const m = spellings.get(key);
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  const displayByKey = new Map();
  for (const [key, m] of spellings) {
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const mixed = ranked.find(([s]) => isMixedCase(s));
    const display = mixed ? mixed[0] : /^[0-9]/.test(ranked[0][0]) ? ranked[0][0] : titleCase(ranked[0][0]);
    displayByKey.set(key, display);
  }

  const artists = [...new Set(displayByKey.values())].sort((a, b) => a.localeCompare(b));
  const artistIdx = new Map(artists.map((a, i) => [a, i]));
  const rarities = [...new Set(rarityByCard.values())].filter((r) => r && r !== 'None').sort();
  const rarityIdx = new Map(rarities.map((r, i) => [r, i]));
  const categories = [...new Set(categoryByCard.values())].sort();
  const categoryIdx = new Map(categories.map((c, i) => [c, i]));

  const outSets = sets
    .map((s) => ({
      id: s.id,
      name: s.name,
      serie: s.serie?.id ?? null,
      serieName: s.serie?.name ?? null,
      date: s.releaseDate ?? null,
      official: s.cardCount?.official ?? null,
      total: s.cardCount?.total ?? null,
      code: s.code ?? null,
      logo: s.logo ?? null,
      symbol: s.symbol ?? null,
    }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id));
  const setIdx = new Map(outSets.map((s, i) => [s.id, i]));

  const imageOverrides = {};
  const rows = cards.map((c) => {
    const set = outSets[setIdx.get(c.setId)];
    const expected = `${IMAGE_BASE}/${set.serie}/${c.setId}/${c.localId}`;
    if (c.image && c.image !== expected) imageOverrides[c.id] = c.image;
    const rawArtist = artistByCard.get(c.id);
    const artist = rawArtist ? displayByKey.get(artistKey(cleanArtistName(rawArtist))) : undefined;
    return [
      c.id,
      c.name,
      c.localId,
      setIdx.get(c.setId),
      artist !== undefined ? artistIdx.get(artist) : -1,
      rarityIdx.get(rarityByCard.get(c.id)) ?? -1,
      categoryIdx.get(categoryByCard.get(c.id)) ?? -1,
      c.image ? 1 : 0,
      Number(hpByCard.get(c.id)) || 0,
      variantBits.get(c.id) ?? 0,
    ];
  });
  rows.sort((a, b) => a[3] - b[3] || a[2].localeCompare(b[2], 'en', { numeric: true }));

  const catalog = {
    version: 1,
    builtAt: new Date().toISOString(),
    source: 'TCGdex (https://tcgdex.dev) — open Pokémon TCG data',
    imageBase: IMAGE_BASE,
    columns: ['id', 'name', 'number', 'set', 'artist', 'rarity', 'category', 'hasImage', 'hp', 'variants'],
    sets: outSets,
    artists,
    rarities,
    categories,
    imageOverrides,
    cards: rows,
  };
  return catalog;
}

/** Prints from an earlier build ({ version, byId: card id → print }), from disk or the published site. */
async function previousPrints() {
  for (const read of earlierSources()) {
    try {
      const meta = JSON.parse(new TextDecoder().decode(await read('meta.json')));
      if (meta.prints?.version !== PRINT_SPEC.version) continue;
      const catalog = JSON.parse(new TextDecoder().decode(await read('catalog.json')));
      const bytes = await read('prints.bin');
      if (!bytes || bytes.length !== catalog.cards.length * PRINT_WORDS * 4) continue;
      const words = new Uint32Array(new Uint8Array(bytes).buffer);
      const byId = new Map(catalog.cards.map((row, i) => [row[0], words.subarray(i * PRINT_WORDS, (i + 1) * PRINT_WORDS)]));
      return byId;
    } catch {
      // nothing usable there; try the next source
    }
  }
  return new Map();
}

/** A print for every card with a picture, in catalog order (all zeros = no picture). */
async function buildPrints(catalog) {
  const reuse = await previousPrints();
  const words = new Uint32Array(catalog.cards.length * PRINT_WORDS);
  const todo = [];
  catalog.cards.forEach((row, i) => {
    if (!row[7]) return;
    const old = reuse.get(row[0]);
    if (old && old.some((w) => w !== 0)) words.set(old, i * PRINT_WORDS);
    else todo.push(i);
  });
  console.log(`Fingerprinting ${todo.length} card pictures (${catalog.cards.length - todo.length} reused or without a picture)…`);
  let failed = 0;
  let done = 0;
  await pool(todo, 8, async (i) => {
    const [, , number, setIdx] = catalog.cards[i];
    const set = catalog.sets[setIdx];
    try {
      const bytes = await getBytes(`${catalog.imageBase}/${set.serie}/${set.id}/${number}/low.jpg`);
      if (!bytes) throw new Error('no picture');
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
      words.set(cardPrint({ data: img.data, width: img.width, height: img.height, channels: 4 }), i * PRINT_WORDS);
    } catch {
      failed++;
    }
    if (++done % 2000 === 0) console.log(`  ${done}/${todo.length}`);
  });
  if (failed) console.log(`  ${failed} pictures couldn't be read (those cards are still found by their text)`);
  return words;
}

/** Reads a file from an earlier build: this machine's output folder first, then the published site. */
const earlierSources = () => [
  async (file) => readFile(path.join(OUT_DIR, file)),
  ...(FALLBACK_URL ? [async (file) => getBytes(`${FALLBACK_URL.replace(/\/$/, '')}/${file}`)] : []),
];

/** Prices from an earlier build: { updated, byId: card id → { usd, eur } }, or null. */
async function previousPrices() {
  for (const read of earlierSources()) {
    try {
      const prices = JSON.parse(new TextDecoder().decode(await read('prices.json')));
      const catalog = JSON.parse(new TextDecoder().decode(await read('catalog.json')));
      if (prices.version !== 1 || prices.usd.length !== catalog.cards.length) continue;
      const byId = new Map(catalog.cards.map((row, i) => [row[0], { usd: prices.usd[i], eur: prices.eur[i] }]));
      return { updated: prices.updated, byId };
    } catch {
      // nothing usable there; try the next source
    }
  }
  return null;
}

/**
 * Each card's TCGdex link to Cardmarket, its attacks and its detailed printings, from an earlier
 * build: card id → [TCGdex's product or null, "attack|attack", our entry, [[printing, Cardmarket
 * product (0: none, null: not fetched yet)]…], { special printing: entry }], or null. (Only cards
 * fetched again get them afresh.)
 */
async function previousCardmarket() {
  for (const read of earlierSources()) {
    try {
      const file = JSON.parse(new TextDecoder().decode(await read('cardmarket.json')));
      if (file.version === 1) return { updated: file.updated, byId: new Map(Object.entries(file.cards)) };
    } catch {
      // nothing usable there; try the next source
    }
  }
  return null;
}

/**
 * A card's printings in detail: [printing, its own Cardmarket product (0: none; null: not known,
 * fetched from TCGdex's GraphQL API, which doesn't have them)]. Jumbo cards are left out: they
 * don't go in a binder.
 */
const detailedPrintings = (list, withProducts) =>
  (list ?? [])
    .filter((v) => v?.type && (!v.size || v.size === 'standard'))
    .map((v) => [printingKey(v), !withProducts ? null : typeof v.thirdParty?.cardmarket === 'number' ? v.thirdParty.cardmarket : 0]);

/** How much of a card the builds have fetched: 0 nothing, 1 its printings (GraphQL), 2 all of it. */
const fetchedLevel = (link) => (!link?.printings ? 0 : link.printings.some(([, cm]) => cm === null) ? 1 : 2);

/**
 * The detailed printings and attacks of the cards earlier builds haven't fetched, from TCGdex's
 * GraphQL API, 100 cards a request, so every card has them from the first build (a card at a
 * time, below, TCGdex stops answering after a few thousand). It doesn't have each printing's
 * Cardmarket product: those cards are fetched again a card at a time, as TCGdex allows.
 */
async function fetchPrintings(catalog, links) {
  const ids = catalog.cards.map((row) => row[0]).filter((id) => !links.get(id)?.printings);
  if (!ids.length) return;
  console.log(`Fetching the printings of ${ids.length} cards…`);
  let fetched = 0;
  let failed = 0;
  let failedInARow = 0;
  const fetchBatch = async (batch) => {
    if (failedInARow >= 4) {
      failed += batch.length; // TCGdex isn't answering
      return;
    }
    try {
      const data = await graphql(
        `{ ${batch.map((id, i) => `c${i}: card(id: ${JSON.stringify(id)}) { id variants_detailed { type foil stamp size } attacks { name } abilities { name } }`).join(' ')} }`,
      );
      failedInARow = 0;
      for (const card of Object.values(data ?? {})) {
        if (!card?.id) continue;
        const moves = [...(card.attacks ?? []), ...(card.abilities ?? [])].map((m) => m?.name).filter(Boolean);
        const link = links.get(card.id);
        links.set(card.id, { hint: link?.hint ?? null, moves: moves.length ? moves : (link?.moves ?? []), printings: detailedPrintings(card.variants_detailed, false) });
        fetched++;
      }
    } catch {
      failedInARow++;
      // One card TCGdex can't answer for fails its whole request: try each half
      if (batch.length <= 10) failed += batch.length;
      else for (const half of [batch.slice(0, batch.length / 2), batch.slice(batch.length / 2)]) await fetchBatch(half);
    }
  };
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  await pool(batches, 4, fetchBatch);
  console.log(`  ${fetched} cards' printings fetched${failed ? `; ${failed} cards' couldn't be (the next build tries again)` : ''}`);
}

/**
 * The market price of one raw copy of every card's standard printing (TCGplayer USD, else
 * Cardmarket EUR), in catalog order: what set values add up. TCGdex only has prices per card, so
 * a full refresh is one small request per card; it's skipped while the last one is recent.
 */
async function buildPrices(catalog) {
  const earlier = await previousPrices();
  const earlierLinks = await previousCardmarket();
  const recent = earlier && Date.now() - Date.parse(earlier.updated) < PRICES_MAX_AGE_DAYS * 86_400_000;
  const n = catalog.cards.length;
  const usd = new Array(n).fill(null);
  const eur = new Array(n).fill(null);
  /** card id → { hint: TCGdex's Cardmarket product, moves: attack names, printings: detailedPrintings } */
  const links = new Map();
  for (const row of catalog.cards) {
    const link = earlierLinks?.byId.get(row[0]);
    if (link) links.set(row[0], { hint: link[0], moves: link[1] ? link[1].split('|') : [], printings: Array.isArray(link[3]) ? link[3] : null });
  }
  await fetchPrintings(catalog, links);
  const todo = [];
  catalog.cards.forEach((row, i) => {
    const old = earlier?.byId.get(row[0]);
    if (old) {
      usd[i] = old.usd;
      eur[i] = old.eur;
    }
    if (!recent || !old || fetchedLevel(links.get(row[0])) < 2) todo.push(i);
  });
  // Cards fetched least go first (nothing yet, then only their printings): when TCGdex stops
  // answering part way (it does), the next build carries on from where this one stopped, not from
  // the oldest sets again.
  const level = (i) => fetchedLevel(links.get(catalog.cards[i][0]));
  todo.sort((a, b) => level(a) - level(b) || a - b);
  console.log(`Fetching market prices for ${todo.length} cards${recent ? ` (the rest are from ${earlier.updated.slice(0, 10)})` : ''}…`);
  const now = new Date().toISOString();
  let failedInARow = 0;
  let failed = 0;
  let done = 0;
  const fetchCard = async (id) => {
    const res = await fetch(`${API}/cards/${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  await pool(todo, 8, async (i) => {
    if (failedInARow > 30) return; // TCGdex is struggling: keep the earlier prices
    const id = catalog.cards[i][0];
    try {
      let raw = await fetchCard(id);
      if (!raw) return;
      const moves = [...(raw.attacks ?? []), ...(raw.abilities ?? [])].map((m) => m?.name).filter(Boolean);
      const hint = raw.pricing?.cardmarket?.idProduct ?? links.get(id)?.hint ?? null;
      links.set(id, { hint: typeof hint === 'number' ? hint : null, moves, printings: detailedPrintings(raw.variants_detailed, true) });
      // TCGdex leaves TCGplayer's prices out of some responses: ask again before taking Cardmarket's,
      // and keep the TCGplayer price from last time rather than switching sources.
      for (let again = 0; again < 2 && !reportedSources(raw).includes('tcgplayer'); again++) {
        raw = (await fetchCard(id).catch(() => null)) ?? raw; // a failed retry keeps the answer we have
      }
      if (!reportedSources(raw).includes('tcgplayer') && usd[i] !== null) {
        failedInARow = 0;
        return;
      }
      const p = standardPrice(raw.variants, extractPrices(raw, now));
      usd[i] = p?.currency === 'USD' ? p.amount : null;
      eur[i] = p?.currency === 'EUR' ? p.amount : null;
      failedInARow = 0;
    } catch {
      failed++;
      failedInARow++;
    }
    if (++done % 4000 === 0) console.log(`  ${done}/${todo.length}`);
  });
  if (failedInARow > 30) console.log('  TCGdex stopped answering; kept the earlier prices for the rest');
  else if (failed) console.log(`  ${failed} cards' prices couldn't be fetched (kept their earlier price, if any)`);
  const priced = usd.filter((v, i) => v !== null || eur[i] !== null).length;
  console.log(`  ${priced} of ${n} cards have a market price`);
  return { prices: { version: 1, updated: recent && !todo.length ? earlier.updated : now, usd, eur }, links, earlierLinks };
}

/**
 * Every card's Cardmarket product, checked (shared/cardmarket.ts), with Cardmarket's own prices
 * from its daily price guide. Without Cardmarket's files, the earlier build's are kept.
 * Returns { updated, cards: card id → [TCGdex's product, "attack|attack", entry] } or null.
 */
async function buildCardmarket(catalog, links, earlierLinks) {
  let products;
  let guide;
  try {
    [products, guide] = await Promise.all([
      getJSON(`${CARDMARKET}/productList/products_singles_6.json`),
      getJSON(`${CARDMARKET}/priceGuide/price_guide_6.json`),
    ]);
    if (!products?.products?.length || !guide?.priceGuides?.length) throw new Error('empty');
  } catch (err) {
    console.warn(`Cardmarket's product list or price guide couldn't be fetched (${err.message})`);
    if (!earlierLinks) return null;
    console.warn(`  kept the earlier build's Cardmarket prices (from ${earlierLinks.updated.slice(0, 10)})`);
    const cards = Object.fromEntries(earlierLinks.byId);
    // …with the printings fetched this time
    for (const [id, link] of links) if (cards[id] && link.printings) cards[id] = [cards[id][0], cards[id][1], cards[id][2], link.printings, cards[id][4] ?? 0];
    return { updated: earlierLinks.updated, cards };
  }
  const index = cardmarketIndex(products.products);
  const priceOf = new Map(guide.priceGuides.map((g) => [g.idProduct, g]));
  const bySet = new Map();
  for (const row of catalog.cards) {
    const setId = catalog.sets[row[3]].id;
    if (!bySet.has(setId)) bySet.set(setId, []);
    const link = links.get(row[0]);
    if (link) bySet.get(setId).push({ id: row[0], name: row[1], moves: link.moves, hint: link.hint });
  }
  const cards = {};
  const tally = { checked: 0, corrected: 0, guessed: 0, none: 0 };
  let specialPrices = 0;
  for (const list of bySet.values()) {
    const nameOf = new Map(list.map((c) => [c.id, cardmarketName(c.name)]));
    for (const [id, { product, how }] of linkSet(index, list)) {
      tally[how]++;
      const link = links.get(id);
      const entry = product === null ? 0 : entryOf(product, cardmarketPrices(priceOf.get(product) ?? {}));
      // Special printings are products of their own (Paradox Rift's cosmos holo Kingdra): TCGdex's
      // link to each, kept when the product is that card.
      const specials = {};
      for (const [key, cm] of link.printings ?? []) {
        if (!cm || !isSpecialPrinting(key) || productParts(index.byId.get(cm)?.name ?? '').name !== nameOf.get(id)) continue;
        specials[key] = entryOf(cm, cardmarketPrices(priceOf.get(cm) ?? {}));
        specialPrices++;
      }
      cards[id] = [link.hint, link.moves.join('|'), entry, link.printings ?? 0, Object.keys(specials).length ? specials : 0];
    }
  }
  console.log(
    `Cardmarket: ${tally.checked} of TCGdex's links confirmed, ${tally.corrected + tally.guessed} corrected or added ` +
      `(${tally.guessed} of them among look-alike products), ${tally.none} cards without one; ${specialPrices} special printings priced`,
  );
  const made = Date.parse(String(guide.createdAt)); // when Cardmarket made it: "2026-10-22T02:45:11+0200"
  return { updated: new Date(Number.isNaN(made) ? Date.now() : made).toISOString(), cards };
}

/**
 * Every card's printings from TCGdex's details (shared/printings.ts): the plain ones it comes in
 * (the row's printing bits), its special ones (row[10]: a cosmos holo, a stamped version…), which
 * of them are promos rather than in its set's packs (row[11]), and for a stamped promo-set card,
 * the set card it's a version of (row[12]). Sets TCGdex has no printing data for (every card one
 * plain regular printing) keep the printings worked out from rarities.
 */
function applyPrintings(catalog, links) {
  const isPromoSet = (set) => /promo/i.test(set.name);
  const bySet = new Map();
  for (const row of catalog.cards) {
    row.length = 10; // an earlier build's extras are worked out afresh
    if (!bySet.has(row[3])) bySet.set(row[3], []);
    bySet.get(row[3]).push(row);
  }
  const extras = new Map(); // card id → [specials, promos, card it's a version of]
  let detailed = 0;
  let specials = 0;
  let promos = 0;
  for (const [setIndex, rows] of bySet) {
    const found = rows.map((row) => ({ row, p: links.get(row[0])?.printings ? cardPrintings(links.get(row[0]).printings) : null }));
    const generated = found.every(({ p }) => !p || (p.basics.length === 1 && p.basics[0] === 'normal' && !p.specials.length));
    const cards = found.map(({ row, p }) => {
      if (generated || !p) return { id: row[0], rarity: catalog.rarities[row[5]] ?? null, basics: VARIANTS.filter((_, bit) => row[9] & (1 << bit)), specials: [] };
      detailed++;
      row[9] = p.basics.reduce((bits, v) => bits | (1 << VARIANTS.indexOf(v)), 0);
      return { id: row[0], rarity: catalog.rarities[row[5]] ?? null, basics: p.basics, specials: p.specials };
    });
    const setPromos = setPromoPrintings(cards, isPromoSet(catalog.sets[setIndex]));
    for (const c of cards) {
      const promo = setPromos.get(c.id) ?? [];
      specials += c.specials.length;
      promos += promo.length;
      if (c.specials.length || promo.length) extras.set(c.id, [c.specials, promo, 0]);
    }
  }
  // Stamped promo-set cards that are versions of a set's own (Build & Battle and prerelease promos)
  const promoSet = (row) => isPromoSet(catalog.sets[row[3]]);
  const versions = stampedPromoLinks(
    catalog.cards.filter(promoSet).map((row) => ({
      id: row[0],
      name: row[1],
      moves: links.get(row[0])?.moves ?? [],
      stamps: (links.get(row[0])?.printings ?? []).flatMap(([key]) => parsePrinting(key).stamps),
    })),
    catalog.cards
      .filter((row) => !promoSet(row))
      .map((row) => ({ id: row[0], name: row[1], moves: links.get(row[0])?.moves ?? [], released: catalog.sets[row[3]].date ?? '9999' })),
  );
  for (const [promo, card] of versions) extras.set(promo, [...(extras.get(promo) ?? [[], [], 0]).slice(0, 2), card]);
  for (const row of catalog.cards) {
    const e = extras.get(row[0]);
    if (e) row.push(e[0].length ? e[0] : 0, e[1].length ? e[1] : 0, e[2] || 0);
  }
  catalog.printings = 1; // the app reads promos from row[11] (an older catalog: it works them out)
  console.log(
    `Printings: ${detailed} cards from TCGdex's details; ${specials} special printings, ${promos} printings only promos come in, ` +
      `${versions.size} stamped promo cards linked to their set`,
  );
}

/** Set values: cards TCGplayer doesn't price get Cardmarket's price (ours, not TCGdex's copy). */
function applyCardmarket(catalog, prices, cardmarket) {
  catalog.cards.forEach((row, i) => {
    const entry = cardmarket.cards[row[0]]?.[2];
    if (entry === undefined || prices.usd[i] !== null) return;
    const variants = Object.fromEntries(VARIANTS.map((v, bit) => [v, !!(row[9] & (1 << bit))]));
    const p = entry === 0 ? null : standardPrice(variants, cardmarketRows(pricesOf(entry), cardmarket.updated));
    prices.eur[i] = p?.amount ?? null;
  });
}

async function writeCardmarket(catalog, cardmarket) {
  await writeFile(path.join(OUT_DIR, 'cardmarket.json'), JSON.stringify({ version: 1, updated: cardmarket.updated, cards: cardmarket.cards }));
  const dir = path.join(OUT_DIR, 'cardmarket');
  await mkdir(dir, { recursive: true });
  const bySet = new Map();
  for (const row of catalog.cards) {
    const entry = cardmarket.cards[row[0]]?.[2];
    if (entry === undefined) continue; // not looked at yet: the API goes by TCGdex's
    const setId = catalog.sets[row[3]].id;
    if (!bySet.has(setId)) bySet.set(setId, {});
    bySet.get(setId)[row[0]] = entry;
    for (const [key, special] of Object.entries(cardmarket.cards[row[0]]?.[4] || {})) bySet.get(setId)[`${row[0]}|${key}`] = special;
  }
  for (const [setId, cards] of bySet) {
    await writeFile(path.join(dir, `${setId}.json`), JSON.stringify({ version: 1, updated: cardmarket.updated, cards }));
  }
  console.log(`Wrote Cardmarket prices for ${bySet.size} sets`);
}

async function write(catalog, prints, prices) {
  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify(catalog);
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 12);
  await writeFile(path.join(OUT_DIR, 'catalog.json'), json);
  const printBytes = new Uint8Array(prints.buffer, prints.byteOffset, prints.byteLength);
  await writeFile(path.join(OUT_DIR, 'prints.bin'), printBytes);
  const pricesJson = JSON.stringify(prices);
  await writeFile(path.join(OUT_DIR, 'prices.json'), pricesJson);
  const meta = {
    version: catalog.version,
    hash,
    builtAt: catalog.builtAt,
    counts: { sets: catalog.sets.length, cards: catalog.cards.length, artists: catalog.artists.length },
    prints: { version: PRINT_SPEC.version, words: PRINT_WORDS, hash: createHash('sha256').update(printBytes).digest('hex').slice(0, 12) },
    prices: { version: prices.version, updated: prices.updated, hash: createHash('sha256').update(pricesJson).digest('hex').slice(0, 12) },
  };
  await writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`Wrote ${OUT_DIR} (${(json.length / 1024 / 1024).toFixed(2)} MB, hash ${hash})`);
  return meta;
}

async function main() {
  if (args.includes('--if-missing') && existsSync(path.join(OUT_DIR, 'catalog.json'))) {
    console.log(`Catalog already exists in ${OUT_DIR} (run "npm run catalog" to rebuild)`);
    return;
  }
  let catalog;
  try {
    catalog = await build();
    if (catalog.cards.length < 1000) throw new Error(`Only ${catalog.cards.length} cards — refusing to publish a partial catalog`);
  } catch (err) {
    if (!FALLBACK_URL) throw err;
    console.warn(`Catalog build failed (${err.message}); reusing the published catalog from ${FALLBACK_URL}`);
    catalog = await getJSON(`${FALLBACK_URL.replace(/\/$/, '')}/catalog.json`);
    if (!catalog?.cards?.length) throw err;
  }
  const prints = await buildPrints(catalog);
  const { prices, links, earlierLinks } = await buildPrices(catalog);
  applyPrintings(catalog, links);
  const cardmarket = await buildCardmarket(catalog, links, earlierLinks);
  if (cardmarket) applyCardmarket(catalog, prices, cardmarket);
  await write(catalog, prints, prices);
  if (cardmarket) await writeCardmarket(catalog, cardmarket);
}

const t0 = Date.now();
main()
  .then(() => console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
