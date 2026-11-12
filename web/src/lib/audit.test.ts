import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuditEntry } from '../../../shared/types.ts';
import { describeAudit } from './audit.ts';

const entry = (action: string, entity: string, details: object | string | null, entityId: string | null = 'x'): AuditEntry => ({
  id: 1,
  userId: 'u',
  userEmail: 'alice@example.com',
  action,
  entity,
  entityId,
  details: details === null || typeof details === 'string' ? details : JSON.stringify(details),
  createdAt: '2026-11-12T10:00:00Z',
});
const card = 'Blastoise · Base Set #2';

test('selling and the collection, in words', () => {
  assert.equal(describeAudit(entry('list', 'item', { card, forSale: 2, askingPrice: 60, askingCurrency: 'GBP' })), `put 2 of ${card} up for sale at £60.00`);
  assert.equal(describeAudit(entry('sell', 'item', { card, quantity: 2, price: 55, currency: 'GBP', platform: 'eBay' })), `sold 2 × ${card} for £55.00 on eBay`);
  assert.equal(describeAudit(entry('unsell', 'item', { card, quantity: 1, restored: false })), `undid the sale of ${card} (its entry was gone, so the copies didn't go back)`);
  assert.equal(describeAudit(entry('unlist', 'item', { card })), `took ${card} off sale`);
  assert.equal(describeAudit(entry('merge', 'item', { card, entries: 3, quantity: 5 })), `combined 3 entries of ${card} into one (×5)`);
});

test('a "delete" says what was deleted, not always a user', () => {
  assert.equal(describeAudit(entry('delete', 'user', { email: 'bob@example.com' })), 'deleted the account of bob@example.com');
  assert.equal(describeAudit(entry('delete', 'sealed', { name: '151 Elite Trainer Box', quantity: 1 })), 'removed 151 Elite Trainer Box (sealed)');
  assert.equal(describeAudit(entry('delete', 'want', { cardId: 'base1-4' })), 'took base1-4 off the want list');
  assert.equal(describeAudit(entry('delete', 'binder', { name: 'Shuckle' })), 'deleted the binder Shuckle');
});

test('logged sales in their own currency; unknown entries as they were recorded', () => {
  assert.equal(describeAudit(entry('log-sale', 'card', { grader: 'PSA', grade: 9, price: 120, currency: 'GBP' }, 'base1-4')), 'logged a PSA 9 sale of £120.00 for base1-4');
  assert.equal(describeAudit(entry('log-sale', 'card', { grader: 'RAW', price: 3 }, 'sv03.5-025')), 'logged a raw sale of $3.00 for sv03.5-025');
  assert.equal(describeAudit(entry('something-new', 'thing', 'not json', 'id1')), 'something-new thing id1');
});
