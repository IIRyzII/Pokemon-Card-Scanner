// End-to-end test of the API against a local `wrangler dev` with a FRESH database:
//   rm -rf .wrangler && npm run dev    (in one terminal)
//   npm test                           (in another)
// Uses live TCGdex data, so it needs internet access.

import { pbkdf2Sync } from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:8787';
const ITERATIONS = 600_000; // keep in sync with shared/password.ts
const salt = (email) => `pokevault:v1:${email.trim().toLowerCase()}`;
const key = (email, password) => pbkdf2Sync(password, salt(email), ITERATIONS, 32, 'sha256').toString('base64');

async function api(method, path, { token, body, expect } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: 'http://localhost:5173',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (expect !== undefined && res.status !== expect) {
    throw new Error(`${method} ${path} → ${res.status} (expected ${expect}): ${JSON.stringify(data)}`);
  }
  return { status: res.status, data, headers: res.headers };
}

let step = 0;
async function check(name, fn) {
  step++;
  try {
    await fn();
    console.log(`  ✓ ${step}. ${name}`);
  } catch (err) {
    console.error(`  ✗ ${step}. ${name}\n    ${err.message}`);
    process.exitCode = 1;
    throw err;
  }
}

const today = new Date().toISOString().slice(0, 10);
const alice = { email: 'alice@example.com', password: 'correct horse battery' };
const bob = { email: 'Bob@Example.com', password: 'another good password' };
let A, B, charizardId, pikachuId, saleId, bobId;

console.log(`Testing ${BASE}`);
try {
  await check('status: fresh database, CORS allowed for the dev origin', async () => {
    const { data, headers } = await api('GET', '/api/auth/status', { expect: 200 });
    assert.equal(data.hasUsers, false, 'Database is not fresh — delete api/.wrangler and restart wrangler dev');
    assert.equal(headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });

  await check('first sign-up becomes admin', async () => {
    const { data } = await api('POST', '/api/auth/register', {
      body: { email: alice.email, displayName: 'Alice', key: key(alice.email, alice.password) },
      expect: 201,
    });
    assert.equal(data.user.role, 'admin');
    A = data.token;
  });

  await check('second sign-up is pending and cannot see the collection', async () => {
    const { data } = await api('POST', '/api/auth/register', {
      body: { email: bob.email, displayName: 'Bob', key: key(bob.email, bob.password) },
      expect: 201,
    });
    assert.equal(data.user.role, 'pending');
    assert.equal(data.user.email, 'bob@example.com');
    B = data.token;
    bobId = data.user.id;
    await api('GET', '/api/collection', { token: B, expect: 403 });
  });

  await check('duplicate email is rejected; bad password key is rejected', async () => {
    await api('POST', '/api/auth/register', {
      body: { email: 'ALICE@example.com', displayName: 'x', key: key(alice.email, 'whatever123') },
      expect: 409,
    });
    await api('POST', '/api/auth/register', { body: { email: 'c@example.com', displayName: 'C', key: 'abc' }, expect: 400 });
  });

  await check('requests without a token get 401', async () => {
    await api('GET', '/api/collection', { expect: 401 });
    await api('GET', '/api/collection', { token: 'not-a-real-token', expect: 401 });
  });

  await check('admin approves Bob as viewer; viewer can read but not write', async () => {
    const { data } = await api('PATCH', `/api/users/${bobId}`, { token: A, body: { role: 'viewer' }, expect: 200 });
    assert.equal(data.user.role, 'viewer');
    const list = await api('GET', '/api/collection', { token: B, expect: 200 });
    assert.equal(list.data.items.length, 0);
    await api('POST', '/api/collection', { token: B, body: { cardId: 'base1-4', variant: 'holo' }, expect: 403 });
    await api('GET', '/api/users', { token: B, expect: 403 });
  });

  await check('viewer cannot manage users; admin cannot remove the last admin', async () => {
    await api('PATCH', `/api/users/${bobId}`, { token: B, body: { role: 'admin' }, expect: 403 });
    const me = await api('GET', '/api/auth/me', { token: A, expect: 200 });
    await api('PATCH', `/api/users/${me.data.user.id}`, { token: A, body: { role: 'editor' }, expect: 409 });
  });

  await check('editor adds a PSA 9 Base Set Charizard (card data from our API)', async () => {
    await api('PATCH', `/api/users/${bobId}`, { token: A, body: { role: 'editor' }, expect: 200 });
    const { data } = await api('POST', '/api/collection', {
      token: B,
      body: { cardId: 'base1-4', variant: 'holo', grader: 'PSA', grade: 9, certNumber: '12345678', purchasePrice: 900 },
      expect: 201,
    });
    charizardId = data.item.id;
    assert.equal(data.item.name, 'Charizard');
    assert.equal(data.item.setName, 'Base Set');
    assert.equal(data.item.number, '4');
    assert.equal(data.item.setTotal, 102);
    assert.equal(data.item.artist, 'Mitsuhiro Arita');
    assert.ok(data.item.image?.startsWith('https://assets.tcgdex.net/'));
    assert.equal(data.item.grade, 9);
    assert.equal(data.item.condition, null);
    assert.equal(data.item.addedByName, 'Bob');
  });

  await check('raw reverse-holo 151 Pikachu ×2 gets a TCGplayer market value', async () => {
    const { data } = await api('POST', '/api/collection', {
      token: B,
      body: { cardId: 'sv03.5-025', variant: 'reverse', grader: 'RAW', condition: 'NM', quantity: 2 },
      expect: 201,
    });
    pikachuId = data.item.id;
    assert.equal(data.item.valueSource, 'tcgplayer', JSON.stringify(data.item));
    assert.ok(data.item.value > 0);
  });

  await check('validation: wrong printing, bad grade, unknown card', async () => {
    await api('POST', '/api/collection', { token: B, body: { cardId: 'base1-4', variant: 'reverse' }, expect: 400 });
    await api('POST', '/api/collection', {
      token: B,
      body: { cardId: 'base1-4', variant: 'holo', grader: 'PSA', grade: 9.3 },
      expect: 400,
    });
    await api('POST', '/api/collection', { token: B, body: { cardId: 'nope-999999', variant: 'holo' }, expect: 404 });
  });

  await check('card detail: market prices, history and owned copies', async () => {
    const { data } = await api('GET', '/api/cards/base1-4', { token: B, expect: 200 });
    assert.equal(data.card.name, 'Charizard');
    assert.equal(data.card.setCode, 'BS');
    assert.equal(data.card.setTotal, 102);
    assert.ok(data.card.variants.includes('holo'));
    assert.equal(data.card.dexId, 6);
    assert.ok(data.prices.some((p) => p.source === 'tcgplayer' && p.variant === 'holo'), 'TCGplayer holo price');
    assert.ok(data.history.length > 0, 'price history recorded');
    assert.equal(data.owned.length, 1);
    assert.ok(data.refreshedAt);
  });

  await check('logging an eBay PSA 9 sale values the slab from sales', async () => {
    const { data } = await api('POST', '/api/sales', {
      token: B,
      body: { cardId: 'base1-4', grader: 'PSA', grade: 9, price: 1525.5, soldOn: today, url: 'https://www.ebay.com/itm/1' },
      expect: 201,
    });
    saleId = data.sale.id;
    const list = await api('GET', '/api/collection', { token: B, expect: 200 });
    const zard = list.data.items.find((i) => i.id === charizardId);
    assert.equal(zard.value, 1525.5);
    assert.equal(zard.valueSource, 'sales');
    assert.ok(list.data.summary.totalValue >= 1525.5);
    await api('POST', '/api/sales', {
      token: B,
      body: { cardId: 'base1-4', grader: 'PSA', grade: 9, price: 10, soldOn: '2999-01-01' },
      expect: 400,
    });
  });

  await check('edit quantity; remove to trash and restore', async () => {
    const { data } = await api('PATCH', `/api/collection/${pikachuId}`, { token: B, body: { quantity: 3 }, expect: 200 });
    assert.equal(data.item.quantity, 3);
    assert.equal(data.item.variant, 'reverse');
    await api('DELETE', `/api/collection/${pikachuId}`, { token: B, expect: 200 });
    const active = await api('GET', '/api/collection', { token: B, expect: 200 });
    assert.ok(!active.data.items.some((i) => i.id === pikachuId));
    const trash = await api('GET', '/api/collection?deleted=1', { token: B, expect: 200 });
    assert.ok(trash.data.items.some((i) => i.id === pikachuId));
    await api('POST', `/api/collection/${pikachuId}/restore`, { token: B, expect: 200 });
  });

  await check('deleting a sale recomputes value; only admins purge', async () => {
    await api('DELETE', `/api/sales/${saleId}`, { token: B, expect: 200 });
    const { data } = await api('GET', `/api/collection/${charizardId}`, { token: B, expect: 200 });
    assert.notEqual(data.item.valueSource, 'sales');
    await api('DELETE', `/api/collection/${pikachuId}`, { token: B, expect: 200 });
    await api('DELETE', `/api/collection/${pikachuId}/purge`, { token: B, expect: 403 });
    await api('DELETE', `/api/collection/${pikachuId}/purge`, { token: A, expect: 200 });
  });

  await check('admin audit log and export', async () => {
    const { data } = await api('GET', '/api/admin/audit', { token: A, expect: 200 });
    const actions = data.entries.map((e) => e.action);
    for (const a of ['register', 'add', 'log-sale', 'remove', 'restore', 'purge', 'update']) assert.ok(actions.includes(a), a);
    const exp = await api('GET', '/api/admin/export', { token: A, expect: 200 });
    assert.equal(exp.data.collection.length, 1);
    assert.ok(!JSON.stringify(exp.data).includes('pw_hash'));
    await api('GET', '/api/admin/audit', { token: B, expect: 403 });
  });

  await check('admin creates an account with a temporary password; others cannot', async () => {
    const dave = 'dave@example.com';
    const { data } = await api('POST', '/api/users', {
      token: A,
      body: { email: dave, displayName: 'Dave', role: 'editor', key: key(dave, 'temporary pass 1') },
      expect: 201,
    });
    assert.equal(data.user.role, 'editor');
    await api('POST', '/api/auth/login', { body: { email: dave, key: key(dave, 'temporary pass 1') }, expect: 200 });
    await api('POST', '/api/users', {
      token: B,
      body: { email: 'eve@example.com', displayName: 'Eve', role: 'admin', key: key('eve@example.com', 'whatever pass') },
      expect: 403,
    });
  });

  await check('wrong password fails; password change signs other devices out', async () => {
    await api('POST', '/api/auth/login', {
      body: { email: bob.email, key: key(bob.email, 'wrong password!') },
      expect: 401,
    });
    const second = await api('POST', '/api/auth/login', {
      body: { email: 'bob@example.com', key: key(bob.email, bob.password) },
      expect: 200,
    });
    const newPassword = 'a brand new password';
    await api('POST', '/api/auth/password', {
      token: B,
      body: { currentKey: key(bob.email, bob.password), newKey: key(bob.email, newPassword) },
      expect: 200,
    });
    await api('GET', '/api/auth/me', { token: second.data.token, expect: 401 });
    await api('GET', '/api/auth/me', { token: B, expect: 200 });
    await api('POST', '/api/auth/login', { body: { email: bob.email, key: key(bob.email, newPassword) }, expect: 200 });
  });

  await check('disabled users are signed out; logout invalidates the token', async () => {
    await api('PATCH', `/api/users/${bobId}`, { token: A, body: { disabled: true }, expect: 200 });
    await api('GET', '/api/auth/me', { token: B, expect: 401 });
    await api('PATCH', `/api/users/${bobId}`, { token: A, body: { disabled: false }, expect: 200 });
    await api('POST', '/api/auth/logout', { token: A, expect: 200 });
    await api('GET', '/api/auth/me', { token: A, expect: 401 });
  });

  console.log(`\nAll ${step} checks passed.`);
} catch {
  console.error('\nAPI test failed.');
}
