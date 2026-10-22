import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardmarketIndex, cardmarketName, cardmarketPrices, cardmarketRows, entryOf, linkSet, pricesOf, productParts, type CardmarketProduct, type LinkInput } from './cardmarket.ts';

const product = (idProduct: number, name: string, idExpansion = 1546): CardmarketProduct => ({ idProduct, name, idExpansion });

test('names are spelled the same way on both sides', () => {
  assert.equal(cardmarketName('Rayquaza ☆'), cardmarketName('Rayquaza Gold Star'));
  assert.equal(cardmarketName('Pikachu Star'), cardmarketName('Pikachu Gold Star'));
  assert.equal(cardmarketName('Latias δ'), cardmarketName('Latias δ Delta Species'));
  assert.equal(cardmarketName('Heatran'), cardmarketName('Heatran Lv.47'));
  assert.equal(cardmarketName('Pokémon Center Lady'), 'pokemon center lady');
  assert.equal(productParts('Nidoran [M] [Horn Hazard]').name, cardmarketName('Nidoran♂'));
  assert.deepEqual(productParts('Unown [Y] [Yield | Hidden Power]'), { name: 'unown y', moves: ['yield', 'hidden power'] });
  assert.deepEqual(productParts('Unown [Y]'), { name: 'unown y', moves: [] });
  assert.deepEqual(productParts('Crushing Hammer'), { name: 'crushing hammer', moves: [] });
});

// EX Deoxys, as Cardmarket lists it (a few of its products).
const deoxysSet = [
  product(276419, 'Deoxys [Form Change | Link Blast]'),
  product(276420, 'Deoxys [Form Change | Energy Crush]'),
  product(276425, 'Rayquaza [Dragon Aura | Tumbling Attack]'),
  product(276426, 'Sableye [Night Vision | Slash | Limitation]'),
  product(276500, 'Deoxys ex [Form Change | Energy Burst]'),
  product(276501, 'Deoxys ex [Form Change | Psyburst]'),
  product(276510, 'Rayquaza Gold Star [Spiral Rush | Holy Star]'),
  product(276487, 'Balloon Berry'),
];

test("TCGdex's wrong links are corrected by name and attacks; right ones stand", () => {
  const cards: LinkInput[] = [
    { id: 'ex8-16', name: 'Deoxys', moves: ['Form Change', 'Link Blast'], hint: 276419 },
    { id: 'ex8-17', name: 'Deoxys', moves: ['Energy Crush', 'Form Change'], hint: 276419 },
    { id: 'ex8-26', name: 'Rayquaza', moves: ['Dragon Aura', 'Tumbling Attack'], hint: 276425 },
    { id: 'ex8-27', name: 'Sableye', moves: ['Night Vision', 'Slash', 'Limitation'], hint: 276426 },
    { id: 'ex8-98', name: 'Deoxys ex', moves: ['Psychic Burst', 'Form Change'], hint: 276419 },
    { id: 'ex8-107', name: 'Rayquaza ☆', moves: ['Spiral Rush', 'Holy Star'], hint: 276425 },
    { id: 'ex8-88', name: 'Balloon Berry', moves: [], hint: null },
    { id: 'ex8-200', name: 'Mystery Card', moves: ['Nothing Here'], hint: null },
  ];
  const links = linkSet(cardmarketIndex(deoxysSet), cards);
  assert.deepEqual(links.get('ex8-16'), { product: 276419, how: 'checked' });
  assert.deepEqual(links.get('ex8-17'), { product: 276420, how: 'corrected' });
  assert.deepEqual(links.get('ex8-107'), { product: 276510, how: 'corrected' }, 'Rayquaza ☆, not the plain Rayquaza');
  // Deoxys ex: "Psychic Burst" is "Psyburst" on Cardmarket; Form Change is shared by both Deoxys ex.
  assert.equal(links.get('ex8-98')!.product !== 276419, true, 'not plain Deoxys');
  assert.deepEqual(links.get('ex8-88'), { product: 276487, how: 'corrected' }, 'found though TCGdex had none');
  assert.deepEqual(links.get('ex8-200'), { product: null, how: 'none' });
});

test('look-alike products go to the card whose place in the set they fit (TCGdex swaps them)', () => {
  // Aquapolis: holo "H" cards are numbered first on Cardmarket, then the set in order; every holo
  // has a numbered printing with the same name and attacks.
  const aquapolis = [
    product(275050, 'Houndoom [Fireworks | Dark Impact]', 1),
    product(275085, 'Exeggutor [Big Eggsplosion | Lateral Eggsplosion]', 1),
    product(275086, 'Houndoom [Smokescreen | Burn Up]', 1),
    product(275087, 'Houndoom [Fireworks | Dark Impact]', 1),
    product(275088, 'Hypno [Psychic Wave | Sleep Inducer]', 1),
  ];
  const cards: LinkInput[] = [
    { id: 'ecard2-13', name: 'Exeggutor', moves: ['Big Eggsplosion', 'Lateral Eggsplosion'], hint: 275085 },
    { id: 'ecard2-14', name: 'Houndoom', moves: ['Smokescreen', 'Burn Up'], hint: 275050 },
    { id: 'ecard2-15', name: 'Houndoom', moves: ['Fireworks', 'Dark Impact'], hint: 275050 },
    { id: 'ecard2-16', name: 'Hypno', moves: ['Psychic Wave', 'Sleep Inducer'], hint: 275088 },
    { id: 'ecard2-H11', name: 'Houndoom', moves: ['Fireworks', 'Dark Impact'], hint: 275087 },
  ];
  const links = linkSet(cardmarketIndex(aquapolis), cards);
  assert.equal(links.get('ecard2-14')!.product, 275086);
  assert.equal(links.get('ecard2-15')!.product, 275087, 'numbered right after 14, before 16');
  assert.equal(links.get('ecard2-H11')!.product, 275050, 'the holo gets the other one');
});

test('prices: published entries and price rows', () => {
  const p = cardmarketPrices({ trend: 6985.88, low: 5000, avg30: 4162.09, 'trend-holo': 3312.82, 'low-holo': null, 'avg30-holo': 775.75 });
  const entry = entryOf(276510, p);
  assert.deepEqual(entry, [276510, 6985.88, 5000, 4162.09, 3312.82, null, 775.75]);
  assert.deepEqual(pricesOf(entry as Exclude<typeof entry, 0>), p);
  const rows = cardmarketRows(p, '2026-10-22T00:45:11.000Z');
  assert.deepEqual(
    rows.map((r) => [r.source, r.variant, r.market, r.low, r.mid, r.currency]),
    [
      ['cardmarket', 'main', 6985.88, 5000, 4162.09, 'EUR'],
      ['cardmarket', 'holo', 3312.82, null, 775.75, 'EUR'],
    ],
  );
  assert.deepEqual(cardmarketRows(cardmarketPrices({}), 'x'), [], 'no prices, no rows');
});
