import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBottomText, parseNameText } from './parse.ts';

test('names: strips stage banners, HP and evolution text', () => {
  assert.equal(parseNameText('BASIC\nCharizard ex HP 330')[0], 'Charizard ex');
  assert.equal(parseNameText('STAGE 2 Evolves from Charmeleon\nCharizard 120 HP')[0], 'Charizard');
  assert.equal(parseNameText('Pikachu HP60')[0], 'Pikachu');
  assert.equal(parseNameText('TRAINER\nSupporter\nProfessor\'s Research')[0], "Professor's Research");
  assert.equal(parseNameText('Mega Charizard X ex HP 360')[0], 'Mega Charizard X ex');
});

test('names: keeps the unstripped line too ("Energy Retrieval")', () => {
  const names = parseNameText('TRAINER\nEnergy Retrieval');
  assert.ok(names.includes('Energy Retrieval'), JSON.stringify(names));
});

test('names: ignores junk lines', () => {
  assert.deepEqual(parseNameText('@ 4 ~\n12\n'), []);
});

test('bottom: vintage "4/102" with illustrator', () => {
  const r = parseBottomText('Illus. Mitsuhiro Arita\n4/102 *');
  assert.equal(r.number, '4');
  assert.equal(r.total, 102);
  assert.equal(r.artist, 'Mitsuhiro Arita');
});

test('bottom: modern set code + number', () => {
  const r = parseBottomText('Illus. Naoyo Kimura\nG MEW EN 025/165 •');
  assert.deepEqual([r.number, r.total, r.setCode, r.artist], ['025', 165, 'MEW', 'Naoyo Kimura']);
});

test('bottom: fixes OCR letter/digit confusions', () => {
  const r = parseBottomText('lllus. Ken Sugimori O25/l65');
  assert.equal(r.number, '025');
  assert.equal(r.total, 165);
});

test('bottom: secret rare above set size', () => {
  const r = parseBottomText('H MEW EN 199/165');
  assert.equal(r.number, '199');
  assert.equal(r.total, 165);
});

test('bottom: gallery and vault numbering', () => {
  assert.deepEqual(pick(parseBottomText('TG05/TG30')), ['TG05', 30]);
  assert.deepEqual(pick(parseBottomText('Illus. Akira Egawa GG44/GG70')), ['GG44', 70]);
  assert.deepEqual(pick(parseBottomText('SV49/SV94')), ['SV49', 94]);
  assert.deepEqual(pick(parseBottomText('RC5 / RC32')), ['RC5', 32]);
});

test('bottom: promos', () => {
  assert.deepEqual(pick(parseBottomText('Illus. Atsuko Nishida SWSH050')), ['SWSH050', null]);
  const svp = parseBottomText('SVP EN 085');
  assert.deepEqual([svp.setCode, svp.number], ['SVP', '085']);
});

test('bottom: copyright lines are not card numbers', () => {
  const r = parseBottomText('©2023 Pokémon / Nintendo / Creatures / GAME FREAK');
  assert.equal(r.number, null);
});

test('bottom: SVI set code is not mistaken for Shiny Vault', () => {
  const r = parseBottomText('G SVI EN 198/198');
  assert.deepEqual([r.number, r.total, r.setCode], ['198', 198, 'SVI']);
});

function pick(r: { number: string | null; total: number | null }) {
  return [r.number, r.total];
}

test('names: trims OCR fragments around the name', () => {
  assert.equal(parseNameText('ll Pikachu')[0], 'Pikachu');
  assert.equal(parseNameText("Fe Furret ’ wl Xx")[0], 'Furret');
  assert.equal(parseNameText('i Charizard')[0], 'Charizard');
  assert.equal(parseNameText('Mewtwo V HP220')[0], 'Mewtwo V');
  assert.equal(parseNameText('Mr. Mime HP70')[0], 'Mr. Mime');
});

test('hp: reads hit points in either order and rejects junk', async () => {
  const { parseHp } = await import('./parse.ts');
  assert.equal(parseHp('BASIC\nCharizard ex HP 330'), 330);
  assert.equal(parseHp('Charizard 120 HP'), 120);
  assert.equal(parseHp('Pikachu HP6O'), 60);
  assert.equal(parseHp('Pikachu HP 65'), null);
  assert.equal(parseHp('TRAINER Professor Research'), null);
});

test('bottom: OCR dropped the slash ("4102")', async () => {
  const { slashlessReadings } = await import('./parse.ts');
  const r = parseBottomText('us. Mitsuhiro Arica © 1995.96.98.99 Nintendo, Creat res, GAMEFREAK. © 1999 Wizards. 4102 »');
  assert.equal(r.number, null);
  assert.deepEqual(r.alternatives, [{ number: '4', total: 102 }]);
  assert.deepEqual(slashlessReadings('025165'), [{ number: '025', total: 165 }]);
  assert.deepEqual(slashlessReadings('Fire Spin 100 HP 120 ©2023'), []);
});
