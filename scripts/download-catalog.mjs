// Downloads the published card catalog (the files the web app reads: catalog.json, meta.json,
// prints.bin and prices.json) into web/public/catalog, so the app can run locally without
// building the catalog from TCGdex, which takes a long time from scratch (see build-catalog.mjs).
//
// Usage: node scripts/download-catalog.mjs [--from URL] [--out DIR] [--if-missing]
//   --from:       where the catalog is published (default: this project's GitHub Pages site)
//   --out:        where to save it (default: web/public/catalog)
//   --if-missing: do nothing when a catalog is already there (used by `npm run dev`)

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const FROM = (argValue('--from') ?? 'https://iiryzii.github.io/Pokemon-Card-Scanner/catalog').replace(/\/$/, '');
const OUT = path.resolve(argValue('--out') ?? path.join(ROOT, 'web/public/catalog'));

async function get(file) {
  const res = await fetch(`${FROM}/${file}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${FROM}/${file}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  if (args.includes('--if-missing') && existsSync(path.join(OUT, 'catalog.json'))) {
    console.log(`Catalog already in ${OUT} (run "npm run catalog:download" to fetch the latest)`);
    return;
  }
  console.log(`Downloading the card catalog from ${FROM}…`);
  const meta = JSON.parse(new TextDecoder().decode(await get('meta.json')));
  const catalog = await get('catalog.json');
  const hash = createHash('sha256').update(catalog).digest('hex').slice(0, 12);
  if (meta.hash && hash !== meta.hash) throw new Error('catalog.json does not match meta.json (the site may be mid-deploy): try again in a few minutes');
  const files = { 'meta.json': JSON.stringify(meta, null, 2), 'catalog.json': catalog };
  // Optional parts: without them the scanner reads card text only, and sets show no values
  for (const file of ['prints.bin', 'prices.json']) {
    try {
      files[file] = await get(file);
    } catch (err) {
      console.warn(`  ${file} not downloaded (${err.message})`);
    }
  }
  await mkdir(OUT, { recursive: true });
  for (const [file, data] of Object.entries(files)) await writeFile(path.join(OUT, file), data);
  const size = Object.values(files).reduce((n, d) => n + (typeof d === 'string' ? d.length : d.byteLength), 0);
  const counts = meta.counts ? `${meta.counts.cards} cards in ${meta.counts.sets} sets, ` : '';
  console.log(`Saved ${counts}built ${meta.builtAt ?? 'at an unknown time'} (${(size / 1024 / 1024).toFixed(1)} MB) to ${OUT}`);
}

main().catch((err) => {
  console.error(`Couldn't download the catalog: ${err.message}`);
  process.exit(1);
});
