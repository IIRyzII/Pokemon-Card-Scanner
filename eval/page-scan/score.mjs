// Scores the page scanner (web/src/scan/pageScan.ts) on simulated page photos from generate.py,
// in both of its modes:
//   check: a binder's page, each pocket checked against the card that belongs there (checkPage)
//   read:  a page of any cards, each pocket's card recognised from its picture alone (readPage)
//
// Usage: node --experimental-strip-types eval/page-scan/score.mjs DIR [DIR…] [--detail]
// --detail lists every pocket that wasn't handled perfectly.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const jpeg = createRequire(path.join(REPO, 'package.json'))('jpeg-js');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildCatalog } = await load('web/src/lib/catalog.ts');
const { PrintIndex } = await load('web/src/lib/pictures.ts');
const { checkPage, readPage } = await load('web/src/scan/pageScan.ts');

const catalogDir = path.join(REPO, 'web/public/catalog');
const catalog = buildCatalog(JSON.parse(readFileSync(path.join(catalogDir, 'catalog.json'), 'utf8')));
const meta = JSON.parse(readFileSync(path.join(catalogDir, 'meta.json'), 'utf8'));
const bin = readFileSync(path.join(catalogDir, 'prints.bin'));
const index = new PrintIndex(new Uint32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4), catalog.cards);

const detail = process.argv.includes('--detail');
const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const note = (...s) => detail && console.log(' ', ...s);

const check = { present: 0, found: 0, unsure: 0, calledOther: 0, sleeved: 0, sleevedFound: 0, wrong: 0, wrongNamed: 0, wrongNamedRight: 0, wrongTaken: 0, empty: 0, emptyTaken: 0, ms: 0 };
const read = { cards: 0, clearRight: 0, clearWrong: 0, guessRight: 0, guessWrong: 0, none: 0, inChoices: 0, empty: 0, emptyClear: 0, emptyGuess: 0, ms: 0 };
let pages = 0;
const seen = new Set();

for (const dir of dirs) {
  const truth = JSON.parse(readFileSync(path.join(dir, 'truth.json'), 'utf8'));
  seen.add(`${truth.catalog?.builtAt} (${truth.catalog?.hash})`);
  for (const page of truth.pages) {
    pages++;
    const raw = jpeg.decode(readFileSync(path.join(dir, page.file)), { useTArray: true, formatAsRGBA: true });
    const photo = { data: raw.data, width: raw.width, height: raw.height };
    const where = (i) => `${path.basename(dir)}/${page.file} pocket ${i + 1}`;

    let t = performance.now();
    const checks = checkPage(index, photo, page.cols, page.rows, page.expected.map((id) => catalog.byId.get(id) ?? null));
    check.ms += performance.now() - t;
    checks.forEach((c, i) => {
      if (!c) return; // its card isn't in this catalog
      const [expected, actual] = [page.expected[i], page.actual[i]];
      const got = `${c.outcome}${c.seen ? ` (${c.seen.id})` : ''}, distance ${c.distance}`;
      if (actual === expected) {
        check.present++;
        if (page.sleeved[i]) check.sleeved++;
        if (c.outcome === 'match') {
          check.found++;
          if (page.sleeved[i]) check.sleevedFound++;
        } else {
          c.outcome === 'other' ? check.calledOther++ : check.unsure++;
          note(`check: ${where(i)}: ${expected} is there → ${got}`);
        }
      } else if (actual) {
        check.wrong++;
        if (c.outcome === 'match') check.wrongTaken++, console.log(`  CHECK: ${where(i)}: ${actual} TAKEN FOR ${expected}`);
        if (c.outcome === 'other') {
          check.wrongNamed++;
          if (c.seen?.id === actual) check.wrongNamedRight++;
          else note(`check: ${where(i)}: ${actual} named as ${c.seen?.id}`);
        }
      } else {
        check.empty++;
        if (c.outcome === 'match') check.emptyTaken++, console.log(`  CHECK: ${where(i)}: EMPTY POCKET TAKEN FOR ${expected}`);
      }
    });

    t = performance.now();
    const reads = readPage(index, photo, page.cols, page.rows);
    read.ms += performance.now() - t;
    reads.forEach((r, i) => {
      const actual = page.actual[i];
      const got = `${r.outcome} ${r.card?.id ?? '-'}, distance ${r.distance}`;
      if (!actual) {
        read.empty++;
        if (r.outcome === 'clear') read.emptyClear++, console.log(`  READ: ${where(i)}: EMPTY POCKET READ AS ${r.card?.id}`);
        if (r.outcome === 'guess') read.emptyGuess++;
        return;
      }
      const card = catalog.byId.get(actual);
      if (!card) return;
      read.cards++;
      // A reprint with the same picture counts as right: the picture can't tell them apart, and the user picks from the choices
      const right = !!r.card && (r.card.id === actual || r.card.nameKey === card.nameKey);
      if (r.choices.some((c) => c.id === actual)) read.inChoices++;
      if (r.outcome === 'clear') right ? read.clearRight++ : (read.clearWrong++, console.log(`  READ: ${where(i)}: ${actual} READ AS ${r.card?.id}`));
      else if (r.outcome === 'guess') right ? read.guessRight++ : (read.guessWrong++, note(`read: ${where(i)}: ${actual} guessed as ${r.card?.id}`));
      else (read.none++, note(`read: ${where(i)}: ${actual} not recognised (${got})`));
    });
  }
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
console.log(`\n${pages} pages from ${dirs.length} set(s); generated with catalog ${[...seen].join(', ')}; scored with catalog ${meta.builtAt} (${meta.hash})`);
console.log(`\nCheck a binder's page (${(check.ms / pages).toFixed(0)} ms a page):`);
console.log(`  right card in its pocket: ${check.present}; found ${check.found} (${pct(check.found, check.present)}), unsure ${check.unsure}, called another card ${check.calledOther}`);
console.log(`    of which in penny sleeves: ${check.sleeved}; found ${check.sleevedFound} (${pct(check.sleevedFound, check.sleeved)})`);
console.log(`  wrong card in a pocket: ${check.wrong}; taken for the right card ${check.wrongTaken}; named ${check.wrongNamed} (named correctly ${check.wrongNamedRight})`);
console.log(`  empty pockets: ${check.empty}; taken for the card ${check.emptyTaken}`);
console.log(`\nRead a page of any cards (${(read.ms / pages).toFixed(0)} ms a page):`);
console.log(`  cards: ${read.cards}; recognised and ticked ${read.clearRight + read.clearWrong} (right ${read.clearRight} = ${pct(read.clearRight, read.cards)}, wrong ${read.clearWrong})`);
console.log(`  offered as "probably" (not ticked): ${read.guessRight + read.guessWrong} (right ${read.guessRight}, wrong ${read.guessWrong}); not recognised ${read.none} (${pct(read.none, read.cards)})`);
console.log(`  the exact card among the choices offered: ${read.inChoices} (${pct(read.inChoices, read.cards)})`);
console.log(`  empty pockets: ${read.empty}; read as a card ${read.emptyClear}; offered as "probably" ${read.emptyGuess}`);
