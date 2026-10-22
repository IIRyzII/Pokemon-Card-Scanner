import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Binder, PriceRow, Want } from '../../../shared/types.ts';
import { gotSince, isDeal, planBudget, priceEntry, snapshotOf, wantKey, wantList, type WantEntry } from './wants.ts';

const want = (cardId: string, variant: string, quantity = 1, priority = 2, extra: Partial<Want> = {}): Want => ({
  id: `w-${cardId}-${variant}`,
  cardId,
  variant,
  quantity,
  priority,
  maxPrice: null,
  maxCurrency: null,
  note: null,
  createdAt: '',
  updatedAt: '',
  ...extra,
});
const binder = (id: string, cards: Binder['cards']): Binder => ({ id, name: id, pockets: 9, cards, colour: 'red', createdAt: '', updatedAt: '' });
const known = () => null;

test('want list: binder gaps and hand-picked wants, copies owned counting towards both', () => {
  const shuckle = binder('shuckle', [
    { cardId: 'sv04-025', variant: 'normal', copies: 9 },
    { cardId: 'sv04-025', variant: 'reverse', copies: 9 },
  ]);
  const rift = binder('rift', [
    { cardId: 'sv04-025', variant: 'normal', copies: 1 },
    { cardId: 'sv04-026', variant: 'normal', copies: 1 },
  ]);
  const owned = new Map([
    [wantKey('sv04-025', 'normal'), 4],
    [wantKey('sv04-030', 'holo'), 2],
  ]);
  const { entries, got } = wantList(
    [want('sv04-025', 'reverse', 2, 1), want('sv04-030', 'holo', 2), want('sv04-040', 'normal', 3, 3)],
    [shuckle, rift],
    owned,
    known,
  );
  const by = new Map(entries.map((e) => [e.key, e]));
  // 9 wanted for the Shuckle binder, 4 owned: 5 to get (the Paradox Rift binder's one is among them)
  assert.equal(by.get('sv04-025|normal')?.need, 5);
  assert.deepEqual(by.get('sv04-025|normal')?.binders.map((b) => b.binderId), ['shuckle']);
  // 9 reverse holos for the binder, and a hand-picked must-have for 2: the binder's 9 count
  const rev = by.get('sv04-025|reverse')!;
  assert.deepEqual([rev.need, rev.wanted, rev.priority, rev.want?.quantity], [9, 9, 1, 2]);
  assert.equal(by.get('sv04-026|normal')?.binders[0].name, 'rift');
  assert.deepEqual([by.get('sv04-040|normal')?.need, by.get('sv04-040|normal')?.priority], [3, 3]);
  // Two wanted and two owned: ticked off
  assert.deepEqual(got.map((w) => w.cardId), ['sv04-030']);
  assert.equal(by.has('sv04-030|holo'), false);
});

const entry = (key: string, priority: 1 | 2 | 3, need = 1): WantEntry => ({
  key,
  cardId: key,
  variant: 'normal',
  need,
  owned: 0,
  wanted: need,
  want: null,
  binders: [],
  priority,
});

test('budget: must-haves first, cheapest first, inside the budget less its buffer', () => {
  const prices: Record<string, number | null> = { a: 30, b: 8, c: 2, d: 12, e: 1, f: null };
  const list = [entry('a', 1), entry('b', 1), entry('c', 2, 3), entry('d', 2), entry('e', 3), entry('f', 1)];
  const plan = planBudget(list, (e) => prices[e.cardId], 25, 10, 'priority');
  assert.equal(plan.buffer, 2.5);
  assert.equal(plan.spendable, 22.5);
  // Must-haves: b (8) fits, a (30) doesn't; then wants: 3 × c (2), d (12) doesn't fit what's left; then e (1)
  assert.deepEqual(
    plan.picks.map((p) => [p.entry.key, p.copies]),
    [
      ['b', 1],
      ['c', 3],
      ['e', 1],
    ],
  );
  assert.equal(plan.spent, 15);
  assert.equal(plan.copies, 5);
  assert.deepEqual(plan.tiers[1], { got: 1, of: 3, spent: 8 });
  assert.equal(plan.unpriced, 1);
  // The must-have that didn't fit, and how much more it takes after what was spent
  assert.equal(plan.next?.entry.key, 'a');
  assert.equal(plan.next?.short, 30 - 7.5);

  const most = planBudget(list, (e) => prices[e.cardId], 25, 10, 'most');
  assert.deepEqual(most.picks.map((p) => p.entry.key), ['e', 'c', 'b']); // 1 + 6 + 8 = 15; d (12) doesn't fit
  const top = planBudget(list, (e) => prices[e.cardId], 25, 0, 'top');
  assert.deepEqual(top.picks.map((p) => p.entry.key), ['b', 'd', 'c', 'e']); // 8, then 12 + 2 + 2 (a third c is over), then 1
  assert.equal(planBudget(list, (e) => prices[e.cardId], 0, 10, 'priority').copies, 0);
});

test('prices: the printing wanted from stored prices, else the usual printing; deals at or under your limit', () => {
  const row = (variant: string, market: number): PriceRow => ({
    source: 'tcgplayer',
    variant,
    gradeKey: 'ungraded',
    market,
    low: null,
    mid: null,
    high: null,
    currency: 'USD',
    label: null,
    url: null,
    updatedAt: '',
  });
  const ctx = { currency: 'USD', fx: null };
  assert.equal(priceEntry({ variant: 'reverse' }, [row('normal', 0.2), row('reverse', 1.5)], ctx, 0.2).each, 1.5);
  const usual = priceEntry({ variant: 'reverse' }, [], ctx, 0.2);
  assert.deepEqual([usual.each, usual.exact], [0.2, false]);
  const convert = (n: number | null) => n;
  const limited = want('x', 'normal', 1, 2, { maxPrice: 5, maxCurrency: 'USD' });
  assert.equal(isDeal({ want: limited }, 4.99, convert), true);
  assert.equal(isDeal({ want: limited }, 5.5, convert), false);
  assert.equal(isDeal({ want: null }, 1, convert), false);
});

test('ticked off: more copies of a wanted card than last time', () => {
  const before = snapshotOf([
    { ...entry('a|normal', 2), owned: 1 },
    { ...entry('b|normal', 2), owned: 0 },
  ]);
  assert.deepEqual(
    gotSince(
      before,
      new Map([
        ['a|normal', 2],
        ['b|normal', 0],
      ]),
    ),
    ['a|normal'],
  );
  assert.deepEqual(gotSince(null, new Map()), []);
});
