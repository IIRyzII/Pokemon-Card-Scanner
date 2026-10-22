import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cardPrintings,
  fixPrinting,
  inferPrintings,
  isOffSetStamp,
  isPrintingKey,
  parsePrinting,
  preferPrintings,
  printingKey,
  printingLabel,
  printingOrder,
  setPromoPrintings,
  stampedPromoLinks,
} from './printings.ts';

const lostThunder = (name: string, rarity: string) => inferPrintings({ setId: 'sm8', name, rarity });

test('Sun & Moon: regular cards and holo rares also come as reverse holos; GX, Prism Star and secret cards only as holos', () => {
  assert.deepEqual(lostThunder('Tangela', 'Common'), ['normal', 'reverse']);
  assert.deepEqual(lostThunder('Shuckle', 'Uncommon'), ['normal', 'reverse']);
  assert.deepEqual(lostThunder('Tangrowth', 'Rare'), ['normal', 'reverse']);
  assert.deepEqual(lostThunder('Zebstrika', 'Rare Holo'), ['holo', 'reverse']);
  assert.deepEqual(lostThunder('Shuckle-GX', 'Rare Holo GX'), ['holo']);
  assert.deepEqual(lostThunder('Shuckle-GX', 'Rare Ultra'), ['holo']);
  assert.deepEqual(lostThunder('Shuckle-GX', 'Rare Rainbow'), ['holo']);
  assert.deepEqual(lostThunder('Lugia ◇', 'Rare Prism Star'), ['holo']);
  assert.deepEqual(lostThunder('Ultra Ball', 'Rare Secret'), ['holo']);
});

test('XY and Black & White: EX and BREAK cards are holo only', () => {
  assert.deepEqual(inferPrintings({ setId: 'xy10', name: 'Delphox BREAK', rarity: 'Rare BREAK' }), ['holo']);
  assert.deepEqual(inferPrintings({ setId: 'xy10', name: 'Zygarde-EX', rarity: 'Rare Holo EX' }), ['holo']);
  assert.deepEqual(inferPrintings({ setId: 'bw11', name: 'Shuckle', rarity: 'Common' }), ['normal', 'reverse']);
  assert.deepEqual(inferPrintings({ setId: 'bw7', name: 'Computer Search', rarity: 'Rare ACE' }), ['holo']);
});

test('promos and special sets have no reverse holos', () => {
  assert.deepEqual(inferPrintings({ setId: 'smp', name: 'Pikachu', rarity: 'Promo' }), ['normal']);
  assert.deepEqual(inferPrintings({ setId: 'xyp', name: 'Mewtwo-EX', rarity: 'Promo' }), ['holo'], 'EX promos are holos');
  assert.deepEqual(inferPrintings({ setId: 'g1', name: 'Pikachu', rarity: 'Common' }), ['normal']);
  assert.deepEqual(inferPrintings({ setId: 'det1', name: 'Detective Pikachu', rarity: 'Rare Holo' }), ['holo']);
  assert.deepEqual(inferPrintings({ setId: 'tk-xy-n', name: 'Pikachu', rarity: null }), ['normal']);
});

test("TCGdex's own rarities work where pokemon-tcg-data has no set", () => {
  assert.deepEqual(inferPrintings({ setId: 'sm3.5', name: 'Mewtwo', rarity: 'Holo Rare' }), ['holo', 'reverse']);
  assert.deepEqual(inferPrintings({ setId: 'sm3.5', name: 'Mewtwo-GX', rarity: 'Ultra Rare' }), ['holo']);
});

test('a printing a card does not come in is taken as its main one', () => {
  assert.equal(fixPrinting('normal', ['holo']), 'holo', 'a Shuckle-GX saved as normal');
  assert.equal(fixPrinting('reverse', ['normal', 'reverse']), 'reverse');
  assert.equal(fixPrinting('normal', null), 'normal', 'printings unknown: left alone');
  assert.equal(fixPrinting('normal', []), 'normal');
});

test("adding a card offers the catalog's printings first, then the rest the API allows", () => {
  assert.deepEqual(preferPrintings(['normal', 'holo', 'reverse', 'firstEdition'], ['holo']), ['holo', 'normal', 'reverse', 'firstEdition']);
  assert.deepEqual(preferPrintings(['normal', 'reverse'], ['normal', 'reverse']), ['normal', 'reverse']);
  assert.deepEqual(preferPrintings(['holo', 'reverse'], null), ['reverse', 'holo'], 'a holo-and-reverse card offers the reverse holo first');
  assert.deepEqual(preferPrintings(['normal'], ['holo']), ['normal'], 'only what the API accepts');
});

test('a card that only comes as a holo and a reverse holo lists the reverse holo first', () => {
  assert.deepEqual(printingOrder(['holo', 'reverse']), ['reverse', 'holo']);
  assert.deepEqual(printingOrder(['normal', 'reverse']), ['normal', 'reverse']);
  assert.deepEqual(printingOrder(['normal', 'holo', 'reverse']), ['normal', 'holo', 'reverse'], 'only when those are its only two');
  assert.deepEqual(printingOrder(['holo']), ['holo']);
});

test('special printings: keys, their parts, labels, and which keys the API takes', () => {
  assert.equal(printingKey({ type: 'holo', foil: 'cosmos', stamp: ['snowflake'] }), 'holo~cosmos+snowflake');
  assert.equal(printingKey({ type: 'holo', foil: null, stamp: ['staff', 'set-logo'] }), 'holo+set-logo+staff', 'stamps in order');
  assert.equal(printingKey({ type: 'reverse' }), 'reverse');
  assert.equal(printingKey({ type: 'metal', foil: 'gold' }), 'holo~gold-metal', "151's gold metal Mew ex: a special holo");
  assert.equal(printingKey({ type: 'metal' }), 'holo~metal');
  assert.equal(printingLabel('holo~gold-metal'), 'Gold Metal');
  assert.equal(printingLabel('holo~metal'), 'Metal');
  assert.deepEqual(parsePrinting('reverse~pokeball'), { base: 'reverse', foil: 'pokeball', stamps: [] });
  assert.deepEqual(parsePrinting('holo+set-logo+staff'), { base: 'holo', foil: null, stamps: ['set-logo', 'staff'] });
  assert.equal(printingLabel('holo~cosmos'), 'Cosmos Holo');
  assert.equal(printingLabel('reverse~masterball'), 'Master Ball Reverse Holo');
  assert.equal(printingLabel('holo+set-logo+staff'), 'Holo · Set logo + Staff stamps');
  assert.equal(printingLabel('normal+gamestop'), 'Regular · GameStop stamp');
  assert.equal(printingLabel('reverse'), 'Reverse Holo');
  assert.ok(isPrintingKey('holo~cosmos+snowflake') && isPrintingKey('normal') && isPrintingKey('firstEdition'));
  assert.ok(!isPrintingKey('sparkly') && !isPrintingKey('holo~<b>') && !isPrintingKey('holo ') && !isPrintingKey(7) && !isPrintingKey(null));
});

test("a card's printings from TCGdex's details: plain ones, special ones, and a promo's own form", () => {
  // Paradox Rift's Kingdra: in packs as a holo and a reverse holo; a cosmos holo from a blister pack
  assert.deepEqual(cardPrintings([['holo', 1], ['holo~cosmos', 2], ['reverse', 1]]), { basics: ['holo', 'reverse'], specials: ['holo~cosmos'] });
  // Snorunt: its only holo is a cosmos holo with a snowflake stamp
  assert.deepEqual(cardPrintings([['normal', 1], ['holo~cosmos+snowflake', 2], ['reverse', 1]]), {
    basics: ['normal', 'reverse'],
    specials: ['holo~cosmos+snowflake'],
  });
  // SVP 057 Chi-Yu only exists stamped: the set-logo one is the card itself, the staff one a special printing
  assert.deepEqual(cardPrintings([['holo+set-logo', 1], ['holo+set-logo+staff', 2]]), { basics: ['holo'], specials: ['holo+set-logo+staff'] });
  // A 1st Edition stamp alone is the 1st Edition printing; a World Championships deck card isn't the set's
  assert.deepEqual(cardPrintings([['holo', 1], ['holo+1st-edition', 2], ['holo+jason-klaczynski', 3]]), { basics: ['holo', 'firstEdition'], specials: [] });
  assert.equal(cardPrintings([]), null);
  // TCGdex gives every Fossil card a "galaxy" foil, 1st Edition too: it's just the card
  assert.deepEqual(cardPrintings([['holo~galaxy', 1], ['holo~galaxy+1st-edition', 2], ['holo~cosmos+pre-release', 3]]), {
    basics: ['holo', 'firstEdition'],
    specials: ['holo~cosmos+pre-release'],
  });
  assert.deepEqual(cardPrintings([['normal~galaxy', 1], ['normal~galaxy+1st-edition', 2], ['normal', 3]]), { basics: ['normal', 'firstEdition'], specials: [] });
  // …and lists 151's gold Mew ex as a holo and as a gold holo (its gold metal one is another card)
  assert.deepEqual(cardPrintings([['holo', 1], ['holo~gold', 1], ['holo~gold-metal', 2]]), { basics: ['holo'], specials: ['holo~gold-metal'] });
  assert.deepEqual(cardPrintings([['holo~gold', 1]]), { basics: ['holo'], specials: [] }, 'a gold secret rare is its own holo');
  assert.ok(isOffSetStamp('jason-klaczynski') && isOffSetStamp('1st-edition-scratch-error'));
  assert.ok(!isOffSetStamp('set-logo') && !isOffSetStamp('pokemon-center') && !isOffSetStamp('worlds-2024') && !isOffSetStamp('master-ball-league'));
});

test('promo printings: stamped ones and promo foils always, pack patterns never, plain ones hardly any card has', () => {
  const cards = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    rarity: 'Common',
    basics: i === 9 ? ['normal', 'holo', 'reverse'] : ['normal', 'reverse'],
    specials: i === 0 ? ['holo~cosmos', 'reverse~pokeball', 'reverse+gamestop'] : ['reverse~pokeball'],
  }));
  const promos = setPromoPrintings(cards, false);
  assert.deepEqual(promos.get('c0'), ['holo~cosmos', 'reverse+gamestop'], 'Poké Ball reverse holos come in the packs');
  assert.deepEqual(promos.get('c9'), ['holo'], 'a holo only one of the commons comes in');
  assert.equal(promos.get('c1'), undefined);
  // In a promo set the cards' own printings are the set; only their stamped extras are promos
  const svp = setPromoPrintings([{ id: 'svp-057', rarity: 'Promo', basics: ['holo'], specials: ['holo+set-logo+staff'] }], true);
  assert.deepEqual(Object.fromEntries(svp), { 'svp-057': ['holo+set-logo+staff'] });
});

test('a stamped promo is a version of the first set card with its name and attacks; unstamped promos and trainers are not', () => {
  const links = stampedPromoLinks(
    [
      { id: 'svp-057', name: 'Chi-Yu', moves: ['Flare Bringer', 'Megafire of Envy'], stamps: ['set-logo'] },
      { id: 'svp-059', name: 'Xatu', moves: ['Super Psy Bolt', 'Clairvoyant Sense'], stamps: ['set-logo', 'staff'] },
      { id: 'svp-061', name: 'Pineco', moves: ['Rollout'], stamps: [] },
      { id: 'svp-099', name: 'Nest Ball', moves: [], stamps: ['set-logo'] },
    ],
    [
      { id: 'sv04-029', name: 'Chi-Yu', moves: ['Megafire of Envy', 'Flare Bringer'], released: '2023-11-03' },
      { id: 'sv05-070', name: 'Xatu', moves: ['Super Psy Bolt', 'Clairvoyant Sense'], released: '2024-03-22' }, // a later reprint
      { id: 'sv04-072', name: 'Xatu', moves: ['Super Psy Bolt', 'Clairvoyant Sense'], released: '2023-11-03' },
      { id: 'sv04-100', name: 'Pineco', moves: ['Rollout'], released: '2023-11-03' },
      { id: 'sv01-181', name: 'Nest Ball', moves: [], released: '2023-03-31' },
    ],
  );
  assert.deepEqual(Object.fromEntries(links), { 'svp-057': 'sv04-029', 'svp-059': 'sv04-072' });
});

test('special printings when ordering, fixing and offering printings', () => {
  assert.deepEqual(printingOrder(['holo', 'reverse', 'holo~cosmos']), ['reverse', 'holo', 'holo~cosmos'], 'plain ones first');
  // A copy saved as "holo" of a card whose only holo is its cosmos holo is that cosmos holo
  assert.equal(fixPrinting('holo', ['normal', 'reverse', 'holo~cosmos+snowflake']), 'holo~cosmos+snowflake');
  assert.equal(fixPrinting('holo~cosmos', ['holo', 'reverse']), 'holo~cosmos', 'a special printing is kept as it is');
  // Adding Snorunt: the catalog's printings; the API's plain holo is its cosmos holo
  assert.deepEqual(preferPrintings(['normal', 'holo', 'reverse'], ['normal', 'reverse', 'holo~cosmos+snowflake']), [
    'normal',
    'reverse',
    'holo~cosmos+snowflake',
  ]);
});
