# Grade-check evaluation

This folder checks the grade check's border measurement (`web/src/scan/condition.ts`) on real card designs. The measurement finds the card's edge and the inner edge of its border all along each side, and gives the centering of each axis as the larger border's share at the most off-centre point (as PSA designates it).

The true centering of the card pictures used here isn't known, so this doesn't measure accuracy against the truth. It measures two other things:

- **Coverage:** how often a design's borders can be measured at all, on its picture flat, as if the card had been found exactly.
- **Stability:** how much a photo changes the result. Each picture is also put into a simulated phone photo, held at an angle on a dark table, slightly soft and noisy, and found the way the app finds it. The photo's result is compared with the flat one.

Accuracy against known borders is checked by the unit tests (`web/src/scan/condition.test.ts`). They draw synthetic cards with known border widths, including a tilted print, a silver border, the back's blue border and a copyright line inside the border. Each is measured within 1.5 points.

## How to run it

You need Node.js 22.12 or newer (with `npm ci` run in the repository root), Python 3 with Pillow (`requirements.txt`), and an internet connection. The first run downloads 108 card pictures (about 10 MB) into `.cache/`.

```bash
npm run catalog:download                          # the published catalogue
pip install -r eval/condition/requirements.txt
python eval/condition/fetch.py 4 5 eval/condition/out/cards.json
node --experimental-strip-types eval/condition/measure.mjs eval/condition/out/cards.json --details
```

`fetch.py PER_SET SEED OUT_LIST` picks PER_SET random cards from each of 27 sets, from Base Set (1999) to Mega Evolution (2026). It is repeatable for a given seed and catalogue. `--details` lists every reading that a photo moved by more than 3 points.

## Results

These results come from the catalogue built on 28 October 2026 (hash `a70246deedf3`), seed 5, 4 cards a set (108 cards).

| Measure | Result |
|---|---|
| Both axes measured, flat | 88 of 108 cards (81.5%) |
| Card found in the simulated photo | 108 of 108 |
| Both axes measured in the photo (of the 88) | 81 (92.0%) |
| Photo against flat: median difference | 0.3 points |
| Photo against flat: 90th percentile | 1.5 points |
| Readings more than 1 / 3 / 5 points apart | 24 / 14 / 8 of 174 (13.8% / 8.0% / 4.6%) |
| "Check the lines" warning shown, on readings more than 3 points apart | 7 of 14 |
| …and on the other readings | 17 of 160 |

A point here is a percentage point of the larger border's share: 55/45 to 56/44 is one point.

**Why borders weren't measured.** A magnified look at each failure found three causes:

- Some TCGdex pictures are digital renders cropped inside the printed border, or without one. They have a very thin border or none, and the measurement correctly declines them.
- On some designs, the border runs into a frame of almost the same colour, for example yellow into pale yellow, or silver into light grey.
- On e-Reader cards (2002–2003), the yellow border continues into the card's own yellow frame.

**Where photos moved the result.** Of the 14 readings more than 3 points apart, four are e-Reader cards and most of the rest are special designs with silver borders or EX-era cards. In those, a slightly soft photo blurs a faint change of colour, so the measurement takes a different edge. The app shows the lines it found over the photo, so a wrong line can be seen and moved by hand. When the borders across and down don't add up to about the same width, it also asks the user to check the lines. That check caught 7 of the 14.

An earlier version stopped at the copyright line that recent cards print inside the bottom border. It now takes the inner edge that most places along the side agree on, because the border's inner edge runs the whole length of the side and the print doesn't.

## Limitations

- **No ground truth.** This is coverage and stability on real designs, not accuracy. The unit tests check accuracy on synthetic cards only. Real-world accuracy has not been measured on photographs of real cards with measured borders.
- **Simulated photos.** They are made from the TCGdex pictures. So they don't include a printed card's colours, holographic foil, a warped card, real lenses or camera processing.
- **No real card backs.** TCGdex has no pictures of the back. The back's border and the white-wear check are tested only on synthetic backs in the unit tests.
- **The white-wear check is a rough rule of thumb.** It looks for white pixels along the very edge of the back. Its levels ("specks", "wear") are this project's own, not a grader's.
- Only English cards. Japanese cards are not in the catalogue.
