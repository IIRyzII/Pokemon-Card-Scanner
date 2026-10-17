// Runs against the real generated catalog (npm run catalog).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildCatalog, normNum, searchCards, type CatalogJson } from './catalog.ts';
import { identifyCard, matchConfidence, similarity, type ScanGuess } from './match.ts';

const json = JSON.parse(readFileSync(new URL('../../public/catalog/catalog.json', import.meta.url), 'utf8')) as CatalogJson;
const cat = buildCatalog(json);

test('normNum removes padding but keeps prefixes', () => {
  assert.equal(normNum('025'), '25');
  assert.equal(normNum('SWSH050'), 'SWSH50');
  assert.equal(normNum('tg05'), 'TG5');
  assert.equal(normNum('0'), '0');
});

test('search by name ranks exact names first', () => {
  const r = searchCards(cat, 'charizard');
  assert.ok(r.length > 20);
  assert.equal(r[0].nameKey, 'charizard');
});

test('search by name + number/total finds the exact card', () => {
  assert.equal(searchCards(cat, 'charizard 4/102')[0].id, 'base1-4');
  assert.equal(searchCards(cat, 'pikachu 025/165')[0].id, 'sv03.5-025');
  assert.equal(searchCards(cat, '199/165')[0].id, 'sv03.5-199');
});

test('search by name + set words / set code', () => {
  assert.ok(searchCards(cat, 'charizard base set').some((c) => c.id === 'base1-4'));
  assert.ok(searchCards(cat, 'pikachu mew').every((c) => c.set.code === 'MEW' || c.name.toLowerCase().includes('mew')));
});

test('search handles gallery numbers and squashed names', () => {
  assert.equal(searchCards(cat, 'TG05/TG30').length > 0, true);
  assert.ok(searchCards(cat, 'hooh').some((c) => c.name === 'Ho-Oh'));
});

test('artist index groups spellings', () => {
  const arita = cat.artistByKey.get('mitsuhiroarita');
  assert.ok(arita && arita.cards.length > 300);
  assert.ok(cat.artists.length > 300);
});

test('similarity tolerates OCR slips', () => {
  assert.ok(similarity('charizarcl', 'charizard') > 0.7);
  assert.ok(similarity('pikachu', 'raichu') < 0.6);
});

test('identify: number + total + name', () => {
  const r = identifyCard(cat, { names: ['Charizard'], number: '4', total: 102, setCode: null, artist: 'Mitsuhiro Arita' });
  assert.equal(r[0].card.id, 'base1-4');
});

test('identify: modern card by set code + number, noisy name', () => {
  const r = identifyCard(cat, { names: ['Pikachv'], number: '025', total: 165, setCode: 'MEW', artist: null });
  assert.equal(r[0].card.id, 'sv03.5-025');
});

test('identify: number + total alone narrows to a few candidates', () => {
  const r = identifyCard(cat, { names: [], number: '199', total: 165, setCode: null, artist: null });
  assert.equal(r[0].card.id, 'sv03.5-199');
});

test('identify: name only returns that Pokémon', () => {
  const r = identifyCard(cat, { names: ['Umbreon VMAX'], number: null, total: null, setCode: null, artist: null });
  assert.ok(r.length > 0 && r.every((c) => c.card.name.startsWith('Umbreon')), r.map((c) => c.card.name).join(','));
});

test('identify: trainer gallery', () => {
  const r = identifyCard(cat, { names: [], number: 'TG05', total: 30, setCode: null, artist: null });
  assert.ok(r.length > 0 && r[0].card.number.startsWith('TG'));
});

test('identify: a misread digit still finds the card via set size + name', () => {
  const r = identifyCard(cat, { names: ['Pikachu'], number: '625', total: 165, setCode: null, artist: null });
  assert.equal(r[0].card.id, 'sv03.5-025', r.slice(0, 3).map((c) => `${c.card.id}:${c.score}`).join(','));
});

test('identify: misread digit + set code', () => {
  const r = identifyCard(cat, { names: [], number: '0Z5', total: null, setCode: 'MEW', artist: null });
  assert.ok(r.slice(0, 3).some((c) => c.card.id === 'sv03.5-025'));
});

test('identify: HP narrows a name-only read', () => {
  const r = identifyCard(cat, { names: ['Charizard'], number: null, total: null, setCode: null, artist: null, hp: 120 });
  assert.ok(r.slice(0, 10).every((c) => c.card.hp === 120), r.slice(0, 10).map((c) => `${c.card.id}:${c.card.hp}`).join(','));
  assert.ok(r.slice(0, 12).some((c) => c.card.id === 'base1-4')); // the scanner shows 12
});

test('identify: slashless reading finds the vintage card', () => {
  const r = identifyCard(cat, { names: ['Charizard'], number: null, total: null, setCode: null, artist: null, alternatives: [{ number: '4', total: 102 }] });
  assert.equal(r[0].card.id, 'base1-4');
});

// Auto-scan picks a card on its own only when matchConfidence says so.
const read = (g: Partial<ScanGuess>): ScanGuess => ({ names: [], number: null, total: null, setCode: null, artist: null, ...g });
const confidence = (g: ScanGuess) => {
  const r = identifyCard(cat, g, 12);
  return { top: r[0]?.card.id, level: matchConfidence(g, r) };
};

test('confidence: number + set + name or HP is sure', () => {
  assert.deepEqual(confidence(read({ names: ['Charizard'], number: '4', total: 102, hp: 120 })), { top: 'base1-4', level: 'sure' });
  assert.deepEqual(confidence(read({ names: ['Pikachv'], number: '025', total: 165, setCode: 'MEW' })), { top: 'sv03.5-025', level: 'sure' });
  assert.deepEqual(confidence(read({ number: '025', total: 165, setCode: 'MEW' })), { top: 'sv03.5-025', level: 'sure' });
  assert.deepEqual(confidence(read({ hp: 120, alternatives: [{ number: '4', total: 102 }] })), { top: 'base1-4', level: 'sure' });
  assert.deepEqual(confidence(read({ names: ['Charizard V'], number: 'SWSH050' })), { top: 'swshp-SWSH050', level: 'sure' });
  // OCR fragments around the name (a real read of Darkness Ablaze Furret)
  assert.deepEqual(confidence(read({ names: ['gist Furret GEE J.'], number: '136', total: 189 })), { top: 'swsh3-136', level: 'sure' });
});

test('confidence: a unique number on its own, or a misread digit, is only likely', () => {
  assert.deepEqual(confidence(read({ number: '199', total: 165 })), { top: 'sv03.5-199', level: 'likely' });
  assert.deepEqual(confidence(read({ names: ['Pikachu'], number: '625', total: 165 })), { top: 'sv03.5-025', level: 'likely' });
});

test('confidence: ambiguous or conflicting reads are never auto-picked', () => {
  assert.equal(confidence(read({ names: ['Charizard'] })).level, null);
  assert.equal(confidence(read({ names: ['Charizard'], hp: 120 })).level, null);
  assert.equal(confidence(read({ number: '4', total: 102 })).level, null); // #4 in every 102-card set
  assert.equal(confidence(read({ number: '025', total: 165 })).level, null); // Expedition has 165 cards too
  assert.equal(confidence(read({ number: 'TG05', total: 30 })).level, null); // four Trainer Galleries
  assert.equal(confidence(read({ names: ['Charizard'], number: '4', hp: 120 })).level, null); // Base Set vs Base Set 2
  assert.equal(confidence(read({ names: ['Blastoise'], number: '4', total: 102, hp: 100 })).level, null);
  assert.equal(confidence(read({})).level, null);
});

test('reprints that share a picture: a garbled number still says which printing', async () => {
  const { pictureVerdict } = await import('./pictures.ts');
  // Crown Zenith's Crushing Hammer (125/159) reprints Sword & Shield's (159/202). OCR read "25159".
  const crz = cat.byId.get('swsh12.5-125')!;
  const ssh = cat.byId.get('swsh1-159')!;
  const pictures = [
    { card: crz, distance: 18 },
    { card: ssh, distance: 24 },
  ];
  const g = read({ names: ['Crushing Hammer'], alternatives: [{ number: '25', total: 159 }, { number: '251', total: 59 }] });
  const r = identifyCard(cat, g, 12, pictures);
  assert.equal(r[0].card.id, 'swsh12.5-125');
  assert.equal(matchConfidence(g, r, pictureVerdict(pictures)), 'sure');
  // With nothing read off the bottom of the card, it can't tell the printings apart.
  const nameOnly = read({ names: ['Crushing Hammer'] });
  assert.equal(matchConfidence(nameOnly, identifyCard(cat, nameOnly, 12, pictures), pictureVerdict(pictures)), 'likely');
});
