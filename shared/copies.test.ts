import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryFor, planMerges, sameCopy } from './copies.ts';
import type { ItemFields } from './types.ts';

const raw = (patch: Partial<ItemFields> = {}): ItemFields => ({
  variant: 'reverse',
  grader: 'RAW',
  grade: null,
  gradeLabel: null,
  condition: 'NM',
  quantity: 1,
  purchasePrice: null,
  purchaseCurrency: 'GBP',
  purchaseDate: null,
  certNumber: null,
  notes: null,
  ...patch,
});
const slab = (patch: Partial<ItemFields> = {}) => raw({ grader: 'PSA', grade: 10, condition: null, ...patch });

test('the same printing and condition, with nothing else recorded, is the same copy', () => {
  assert.ok(sameCopy(raw({ quantity: 3 }), raw()));
  assert.ok(sameCopy(raw({ purchaseCurrency: 'GBP' }), raw({ purchaseCurrency: 'USD' })), 'no price paid: its currency is irrelevant');
  assert.ok(sameCopy(raw({ notes: '' }), raw({ notes: null })));
  assert.ok(sameCopy(slab(), slab()));
});

test('a different printing, condition or grade is a different copy', () => {
  assert.ok(!sameCopy(raw(), raw({ variant: 'normal' })));
  assert.ok(!sameCopy(raw(), raw({ condition: 'LP' })));
  assert.ok(!sameCopy(raw(), slab()));
  assert.ok(!sameCopy(slab(), slab({ grade: 9 })));
  assert.ok(!sameCopy(slab(), slab({ grader: 'CGC' })));
  assert.ok(!sameCopy(slab(), slab({ gradeLabel: 'Black Label' })));
});

test('what was paid, when, notes and cert numbers keep copies apart', () => {
  assert.ok(!sameCopy(raw(), raw({ purchasePrice: 5 })));
  assert.ok(sameCopy(raw({ purchasePrice: 5 }), raw({ purchasePrice: 5 })));
  assert.ok(!sameCopy(raw({ purchasePrice: 5, purchaseCurrency: 'GBP' }), raw({ purchasePrice: 5, purchaseCurrency: 'USD' })));
  assert.ok(!sameCopy(raw(), raw({ purchaseDate: '2026-10-01' })));
  assert.ok(!sameCopy(raw(), raw({ notes: 'centering 60/40' })));
  assert.ok(!sameCopy(slab({ certNumber: '81234567' }), slab()), 'a slab with a cert number is one specific copy');
  assert.ok(!sameCopy(slab({ certNumber: '81234567' }), slab({ certNumber: '81234567' })));
});

test('new copies count with the oldest matching entry that has room', () => {
  const entries = [
    { id: 'lp', ...raw({ condition: 'LP' }) },
    { id: 'full', ...raw({ quantity: 999 }) },
    { id: 'first', ...raw({ quantity: 2 }) },
    { id: 'second', ...raw() },
  ];
  assert.equal(entryFor(entries, raw())?.id, 'first');
  assert.equal(entryFor(entries, raw({ quantity: 997 }))?.id, 'first');
  assert.equal(entryFor(entries, raw({ quantity: 998 }))?.id, 'second');
  assert.equal(entryFor(entries, raw({ condition: 'MP' })), undefined);
});

test('duplicate entries are combined into the oldest of each card; different details stay apart', () => {
  const e = (id: string, cardId: string, createdAt: string, patch: Partial<ItemFields> = {}) => ({ id, cardId, createdAt, ...raw(patch) });
  const plans = planMerges([
    e('pika-2', 'sv03.5-025', '2026-10-02', { quantity: 2 }),
    e('pika-1', 'sv03.5-025', '2026-10-01'),
    e('pika-lp', 'sv03.5-025', '2026-10-03', { condition: 'LP' }),
    e('pika-3', 'sv03.5-025', '2026-10-04'),
    e('furret-1', 'swsh3-136', '2026-10-01', { variant: 'normal' }),
    e('furret-2', 'swsh3-136', '2026-10-05', { variant: 'normal', quantity: 3 }),
    e('zard', 'base1-4', '2026-10-01', { variant: 'holo' }),
    e('slab-a', 'base1-4', '2026-10-02', { variant: 'holo', grader: 'PSA', grade: 9, condition: null, certNumber: '1' }),
    e('slab-b', 'base1-4', '2026-10-03', { variant: 'holo', grader: 'PSA', grade: 9, condition: null, certNumber: '2' }),
  ]);
  assert.deepEqual(
    plans.map((p) => [p.keep.id, p.absorb.map((a) => a.id), p.quantity]),
    [
      ['pika-1', ['pika-2', 'pika-3'], 4],
      ['furret-1', ['furret-2'], 4],
    ],
  );
});

test('combining never makes an entry hold more than 999 copies', () => {
  const e = (id: string, quantity: number, createdAt: string) => ({ id, cardId: 'a', createdAt, ...raw({ quantity }) });
  const plans = planMerges([e('a', 600, '1'), e('b', 500, '2'), e('c', 300, '3')]);
  assert.deepEqual(
    plans.map((p) => [p.keep.id, p.absorb.map((a) => a.id), p.quantity]),
    [['a', ['c'], 900]],
  );
  assert.deepEqual(planMerges([e('a', 1, '1')]), []);
});

test('copies in different languages keep their own entries', () => {
  assert.ok(sameCopy(raw({ language: 'en' }), raw()), 'no language: English');
  assert.ok(!sameCopy(raw({ language: 'fr' }), raw({ language: 'en' })));
  assert.ok(sameCopy(raw({ language: 'de' }), raw({ language: 'de' })));
});
