# Page-scan evaluation

This folder measures how well the page scanner (`web/src/scan/pageScan.ts`) handles photos of whole binder pages, in both of its modes:

- **Check** (a binder's page in the app): each pocket is compared with the card that belongs there.
- **Read** (the scanner's "Binder page" mode): each pocket's card is recognised from its picture alone.

The photos are simulated, not real. `generate.py` composes binder pages from the catalog's card pictures and adds the problems a phone photo has. `score.mjs` runs the scanner on them and compares its answers with what the generator put in each pocket.

## What the simulated photos include

- Pages of 9 pockets (most pages), 12 or 4, holding consecutive cards from one set, as a set binder would.
- About 10% of pockets empty and about 10% holding a random card from another set (a card in the wrong pocket).
- Cards loose in their pockets (slid down, a little to one side), and about 30% in penny sleeves.
- The pocket plastic's haze, its welded seams, and a lamp reflected in the plastic on about half of the pages.
- The page a little off the on-screen guide: 86–100% of its height, up to 4% off centre, turned up to 4 degrees and slightly tilted.
- Exposure changes, sensor noise, slight blur and JPEG compression.

## How to run it

You need Node.js 22.12 or newer (with `npm ci` run in the repository root), Python 3 with the packages in `requirements.txt`, and an internet connection. The first run downloads about 1,300 card pictures (about 60 MB) into `.cache/`.

```bash
npm run catalog:download                          # the published catalog and picture fingerprints
pip install -r eval/page-scan/requirements.txt
python eval/page-scan/generate.py 60 3 eval/page-scan/out/held-out
node --experimental-strip-types eval/page-scan/score.mjs eval/page-scan/out/held-out
```

`generate.py PAGES SEED OUT_DIR` is repeatable for a given seed and catalog. Add `--detail` to `score.mjs` to list every pocket that wasn't handled perfectly.

## Results

These results come from the catalog built on 28 October 2026 (hash `a70246deedf3`). A different catalog build picks different sets, so expect small differences.

The detection thresholds in `pageScan.ts` were chosen during development using pages from this generator with seeds 1 and 2. The **held-out** set (seed 3) was not used for any tuning and is the fairer measure.

### Check a binder's page

| Measure | Held-out (seed 3, 60 pages) | Development (seeds 1 and 2, 80 pages) |
|---|---|---|
| Right card in its pocket: found | 393 of 423 (92.9%) | 524 of 561 (93.4%) |
| …of those in penny sleeves: found | 116 of 124 (93.5%) | 167 of 178 (93.8%) |
| Right card marked "not sure" | 30 | 37 |
| Wrong card taken for the right one | 0 of 45 | 0 of 66 |
| Wrong card named (named correctly) | 31 (29) | 45 (44) |
| Empty pocket taken for the card | 0 of 42 | 0 of 71 |

### Read a page of any cards

| Measure | Held-out (seed 3, 60 pages) | Development (seeds 1 and 2, 80 pages) |
|---|---|---|
| Recognised and ticked, right | 402 of 468 (85.9%) | 541 of 627 (86.3%) |
| Recognised and ticked, wrong | 0 | 0 |
| Offered as "probably" (not ticked): right, wrong | 19, 0 | 22, 2 |
| Not recognised | 47 (10.0%) | 62 (9.9%) |
| Exact card among the choices offered | 435 (92.9%) | 584 (93.1%) |
| Empty pocket read as a card | 0 of 42 | 0 of 71 |

A reprint with the same picture counts as right in the "Read" mode. The picture cannot tell such reprints apart, so the app offers them as choices.

Each mode took about 1 second a page on the development PC (Windows 11, Node.js 24). This is indicative only: phones are slower.

## Limitations

- **The photos are simulated.** They are built from the same TCGdex pictures that the reference fingerprints are made from. So they test robustness to placement, sleeves, glare, blur and noise, but not to differences between a printed card and its scan: colour, print variation, wear, holographic foil, real binder plastic or camera processing. Real-world accuracy is expected to be lower. It has not been measured on real photographs.
- Only English cards with a picture in the catalog are used. Japanese, Korean and Chinese cards are not in the catalog.
- The wrong cards are random cards from other sets. A wrong card from the same set, or a reprint of the right card, is a harder case that this set barely covers.
- The results are for the scanner on a desktop PC in Node.js, not in a phone's browser. The code is the same, but timings differ.
