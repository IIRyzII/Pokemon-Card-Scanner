"""Generates simulated photos of whole binder pages for evaluating the page scanner.

Each page holds cards from one set in number order, as a set binder would. About 10% of pockets
are left empty and about 10% hold a random card from the catalog instead (a card in the wrong
pocket). Cards sit loose in their pockets and about 30% are in penny sleeves; the pocket plastic
hazes the page; about half the pages reflect a lamp; and the page is a little off the on-screen
guide (86-100% of its height, up to 4% off centre, turned up to 4 degrees, slightly tilted). The
output image is what the app gets from the guide: the page's area, 1300 pixels tall.

Card pictures are downloaded from TCGdex (the same source as the catalog) into .cache/.

Usage: python generate.py PAGES SEED OUT_DIR
Writes OUT_DIR/page_<k>.jpg and OUT_DIR/truth.json (the cards that belong in each pocket, what is
actually in it, which cards are sleeved, and the catalog version used).
"""
import io
import json
import math
import os
import random
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PAGES, SEED, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CATALOG_DIR = os.path.join(REPO, 'web', 'public', 'catalog')
CACHE = os.path.join(HERE, '.cache')
PX = 5  # page pixels per mm
POCKET_W, POCKET_H, SEAM = 67, 92, 4  # mm, as the app assumes
LAYOUTS = [(3, 3)] * 6 + [(2, 2), (4, 3)]  # mostly 9-pocket pages

rng = random.Random(SEED)
nrng = np.random.default_rng(SEED)
catalog = json.load(open(os.path.join(CATALOG_DIR, 'catalog.json'), encoding='utf-8'))
meta = json.load(open(os.path.join(CATALOG_DIR, 'meta.json'), encoding='utf-8'))
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

by_set = {}
for c in catalog['cards']:
    if c[7]:  # has a picture
        by_set.setdefault(c[3], []).append(c)
sets = sorted(s for s, cs in by_set.items() if len(cs) >= 30)
everything = [c for c in catalog['cards'] if c[7]]


def path(c):
    return os.path.join(CACHE, c[0].replace('/', '_').replace('?', 'Q') + '.jpg')


def fetch(c):
    p = path(c)
    if os.path.exists(p):
        return True
    s = catalog['sets'][c[3]]
    url = catalog['imageOverrides'].get(c[0], f"{catalog['imageBase']}/{s['serie']}/{s['id']}/{c[2]}") + '/high.jpg'
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'PokeVault-evaluation'})
            im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGB')
            im.resize((63 * PX, 88 * PX), Image.LANCZOS).save(p, 'JPEG', quality=85)
            return True
        except Exception:
            pass
    return False


def perspective(out_pts, in_pts):
    a, b = [], []
    for (x, y), (u, v) in zip(out_pts, in_pts):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


plans = []
for _ in range(PAGES):
    cols, rows = rng.choice(LAYOUTS)
    cards = by_set[rng.choice(sets)]
    start = rng.randrange(0, len(cards) - cols * rows)
    expected = cards[start:start + cols * rows]
    actual = []
    for c in expected:
        r = rng.random()
        actual.append(None if r < 0.1 else rng.choice(everything) if r < 0.2 else c)
    plans.append((cols, rows, expected, actual))
needed = {c[0]: c for _, _, e, a in plans for c in e + [x for x in a if x]}
with ThreadPoolExecutor(8) as pool:
    fetched = dict(zip(needed, pool.map(fetch, needed.values())))

truth = []
for k, (cols, rows, expected, actual) in enumerate(plans):
    actual = [a if a and fetched.get(a[0]) else None for a in actual]
    page_w, page_h = cols * POCKET_W + (cols + 1) * SEAM, rows * POCKET_H + (rows + 1) * SEAM
    page_colour = rng.choice([(18, 18, 20), (40, 42, 48), (235, 235, 230), (20, 30, 60)])
    page = Image.new('RGB', (page_w * PX, page_h * PX), page_colour)
    sleeved = []
    for i, c in enumerate(actual):
        if not c:
            sleeved.append(False)
            continue
        r, col = divmod(i, cols)
        x0 = (SEAM + col * (POCKET_W + SEAM)) * PX
        y0 = (SEAM + r * (POCKET_H + SEAM)) * PX
        im = Image.open(path(c)).convert('RGB')
        in_sleeve = rng.random() < 0.3
        sleeved.append(in_sleeve)
        ox = rng.uniform(0.5, POCKET_W - 63 - 0.5) * PX  # loose: a little to one side…
        oy = (POCKET_H - 88 - rng.uniform(0, 1.5)) * PX  # …and slid down
        if in_sleeve:  # a penny sleeve: a couple of mm of clear plastic round the card
            sleeve = Image.new('RGB', (im.width + 4 * PX, im.height + 5 * PX), tuple(min(255, v + 25) for v in page_colour))
            sleeve.paste(im, (2 * PX, 3 * PX))
            im, ox, oy = sleeve, ox - 2 * PX, oy - 3 * PX
        mask = Image.new('L', im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], int(0.045 * im.width), fill=255)
        page.paste(im, (int(x0 + ox), int(y0 + oy)), mask)
    page = Image.fromarray((np.asarray(page, np.float32) * 0.9 + 255 * 0.08).clip(0, 255).astype(np.uint8))  # the plastic's haze
    draw = ImageDraw.Draw(page)
    for c in range(cols + 1):  # welded seams between pockets
        x = (c * (POCKET_W + SEAM) + SEAM / 2) * PX
        draw.line([(x, 0), (x, page_h * PX)], fill=(200, 200, 205), width=2)
    for r in range(rows + 1):
        y = (r * (POCKET_H + SEAM) + SEAM / 2) * PX
        draw.line([(0, y), (page_w * PX, y)], fill=(200, 200, 205), width=2)

    # The guide's crop: the page a little off it, turned and tilted
    out_h = 1300
    out_w = int(out_h * page_w / page_h)
    fill = rng.uniform(0.86, 1.0)
    w, h = out_w * fill, out_h * fill
    cx = out_w / 2 + rng.uniform(-0.04, 0.04) * out_w
    cy = out_h / 2 + rng.uniform(-0.04, 0.04) * out_h
    angle = math.radians(rng.uniform(-4, 4))
    tilt = rng.uniform(-0.04, 0.04)
    corners = []
    for u, v in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]:
        x, y = u * w * (1 + tilt * v * 2), v * h
        corners.append((cx + x * math.cos(angle) - y * math.sin(angle), cy + x * math.sin(angle) + y * math.cos(angle)))
    source = [(0, 0), (page.width, 0), (page.width, page.height), (0, page.height)]
    frame = page.transform((out_w, out_h), Image.PERSPECTIVE, perspective(corners, source), Image.BICUBIC, fillcolor=(70, 60, 50))
    img = np.asarray(frame, np.float32)
    if rng.random() < 0.5:  # a lamp reflected in the plastic
        yy, xx = np.mgrid[0:out_h, 0:out_w].astype(np.float32)
        gx, gy, gs = rng.uniform(0.1, 0.9) * out_w, rng.uniform(0.1, 0.9) * out_h, rng.uniform(0.06, 0.16) * out_h
        img = img + (260 * np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * gs ** 2)) ** 1.5)[..., None]
    img = img * rng.uniform(0.8, 1.1) + nrng.normal(0, 4, img.shape)  # exposure and sensor noise
    photo = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 1.3)))
    name = f'page_{k}.jpg'
    photo.save(os.path.join(OUT, name), 'JPEG', quality=85)
    truth.append({
        'file': name, 'cols': cols, 'rows': rows,
        'expected': [c[0] for c in expected],
        'actual': [a[0] if a else None for a in actual],
        'sleeved': sleeved,
    })

json.dump({'seed': SEED, 'catalog': {'builtAt': meta.get('builtAt'), 'hash': meta.get('hash')}, 'pages': truth}, open(os.path.join(OUT, 'truth.json'), 'w'), indent=1)
print(f'wrote {len(truth)} pages to {OUT} (seed {SEED}, catalog built {meta.get("builtAt")})')
