"""Downloads full-size card pictures from TCGdex for evaluating the grade check's border measurement
on real card designs: PER_SET random cards with pictures from each of 27 sets, from 1999 to 2026.

Pictures are cached in .cache/ as TCGdex serves them (JPEG). The cards picked are written to
OUT_LIST, with the catalogue version used.

Usage: python fetch.py PER_SET SEED OUT_LIST
"""
import io
import json
import os
import random
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

PER_SET, SEED, OUT_LIST = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CATALOG_DIR = os.path.join(REPO, 'web', 'public', 'catalog')
CACHE = os.path.join(HERE, '.cache')
# One or more sets from every era: Base Set to Mega Evolution.
SETS = ['base1', 'base2', 'neo1', 'neo3', 'ecard1', 'ex3', 'ex6', 'ex12', 'dp5', 'pl3', 'hgss1', 'bw2', 'bw9', 'xy1', 'xy7',
        'sm1', 'sm3', 'sm8', 'swsh1', 'swsh7', 'swsh11', 'sv01', 'sv04', 'sv05', 'sv08', 'me01', 'me03']

catalog = json.load(open(os.path.join(CATALOG_DIR, 'catalog.json'), encoding='utf-8'))
meta = json.load(open(os.path.join(CATALOG_DIR, 'meta.json'), encoding='utf-8'))
os.makedirs(CACHE, exist_ok=True)
rng = random.Random(SEED)

by_set = {}
for c in catalog['cards']:
    if c[7]:  # has a picture
        by_set.setdefault(catalog['sets'][c[3]]['id'], []).append(c)
picked = [c for s in SETS for c in rng.sample(by_set.get(s, []), min(PER_SET, len(by_set.get(s, []))))]


def fetch(c):
    name = c[0].replace('/', '_').replace('?', 'Q')
    jpg = os.path.join(CACHE, name + '.jpg')
    if not os.path.exists(jpg):
        s = catalog['sets'][c[3]]
        url = catalog['imageOverrides'].get(c[0], f"{catalog['imageBase']}/{s['serie']}/{s['id']}/{c[2]}") + '/high.jpg'
        for _ in range(3):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'PokeVault-evaluation'})
                data = urllib.request.urlopen(req, timeout=30).read()
                if Image.open(io.BytesIO(data)).format != 'JPEG':
                    raise ValueError('not a JPEG')
                open(jpg, 'wb').write(data)
                break
            except Exception:
                pass
        else:
            return None
    im = Image.open(jpg)
    return {'id': c[0], 'file': name, 'w': im.width, 'h': im.height}


with ThreadPoolExecutor(8) as pool:
    cards = [x for x in pool.map(fetch, picked) if x]
json.dump({'catalog': meta.get('hash') or meta.get('version'), 'seed': SEED, 'perSet': PER_SET, 'cards': cards}, open(OUT_LIST, 'w'), indent=1)
print(f'{len(cards)} of {len(picked)} cards ready')
