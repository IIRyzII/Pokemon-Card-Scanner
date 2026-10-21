import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BINDER_COLOUR_KEYS, colourOf, nextColour } from './binders.ts';

test("a binder's colour is the one chosen, else always the same one picked from its id", () => {
  assert.equal(colourOf({ id: 'x', colour: 'teal' }), 'teal');
  const auto = colourOf({ id: 'f3a1c9e0', colour: null });
  assert.ok(BINDER_COLOUR_KEYS.includes(auto));
  assert.equal(colourOf({ id: 'f3a1c9e0' }), auto, 'stable');
  assert.equal(colourOf({ id: 'f3a1c9e0', colour: 'plaid' }), auto, 'unknown colours are ignored');
});

test('new binders get a colour not on the shelf yet', () => {
  assert.equal(nextColour([]), 'red');
  assert.equal(nextColour([{ id: 'a', colour: 'red' }, { id: 'b', colour: 'orange' }]), 'yellow');
  const full = BINDER_COLOUR_KEYS.map((colour, i) => ({ id: String(i), colour }));
  assert.ok(BINDER_COLOUR_KEYS.includes(nextColour(full)), 'when all are used, they come round again');
});
