import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryFor, sameCopy } from './copies.ts';
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
