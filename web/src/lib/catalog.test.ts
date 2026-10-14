// Runs against the real generated catalog (npm run catalog).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildCatalog, normNum, searchCards, type CatalogJson } from './catalog.ts';
import { identifyCard, similarity } from './match.ts';

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
