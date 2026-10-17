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
import { extractPrices, standardPrice } from '../shared/market.ts';

const API = 'https://api.tcgdex.net/v2/en';
const GQL = 'https://api.tcgdex.net/v2/graphql';
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
    ];
  });
  rows.sort((a, b) => a[3] - b[3] || a[2].localeCompare(b[2], 'en', { numeric: true }));

  const catalog = {
    version: 1,
    builtAt: new Date().toISOString(),
    source: 'TCGdex (https://tcgdex.dev) — open Pokémon TCG data',
    imageBase: IMAGE_BASE,
    columns: ['id', 'name', 'number', 'set', 'artist', 'rarity', 'category', 'hasImage', 'hp'],
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
 * The market price of one raw copy of every card's standard printing (TCGplayer USD, else
 * Cardmarket EUR), in catalog order: what set values add up. TCGdex only has prices per card, so
 * a full refresh is one small request per card; it's skipped while the last one is recent.
 */
async function buildPrices(catalog) {
  const earlier = await previousPrices();
  const recent = earlier && Date.now() - Date.parse(earlier.updated) < PRICES_MAX_AGE_DAYS * 86_400_000;
  const n = catalog.cards.length;
  const usd = new Array(n).fill(null);
  const eur = new Array(n).fill(null);
  const todo = [];
  catalog.cards.forEach((row, i) => {
    const old = earlier?.byId.get(row[0]);
    if (old) {
      usd[i] = old.usd;
      eur[i] = old.eur;
    }
    if (!recent || !old) todo.push(i);
  });
  console.log(`Fetching market prices for ${todo.length} cards${recent ? ` (the rest are from ${earlier.updated.slice(0, 10)})` : ''}…`);
  const now = new Date().toISOString();
  let failedInARow = 0;
  let failed = 0;
  let done = 0;
  await pool(todo, 8, async (i) => {
    if (failedInARow > 30) return; // TCGdex is struggling: keep the earlier prices
    const id = catalog.cards[i][0];
    try {
      const res = await fetch(`${API}/cards/${encodeURIComponent(id)}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
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
  return { version: 1, updated: recent && !todo.length ? earlier.updated : now, usd, eur };
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
  await write(catalog, await buildPrints(catalog), await buildPrices(catalog));
}

const t0 = Date.now();
main()
  .then(() => console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
