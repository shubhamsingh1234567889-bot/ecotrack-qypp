'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

async function withServer(fn) {
  const app = createApp(openDb(':memory:'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

test('full flow: create user, log activities, read dashboard, delete', async () => {
  await withServer(async (call) => {
    const bad = await call('/api/users', 'POST', { name: 'x' });
    assert.equal(bad.status, 400);

    const user = (await call('/api/users', 'POST', { name: 'Asha' })).body;
    assert.equal(user.name, 'Asha');
    assert.equal(user.dailyGoal, 8);

    const today = '2026-10-13';
    const logged = await call('/api/activities', 'POST', {
      userId: user.id, category: 'transport', type: 'car_petrol', quantity: 10, date: today,
    });
    assert.equal(logged.status, 201);
    assert.equal(logged.body.emission, 1.92);

    await call('/api/activities', 'POST', {
      userId: user.id, category: 'food', type: 'beef_meal', quantity: 1, date: today,
    });

    const dash = (await call(`/api/dashboard?userId=${user.id}&today=${today}`)).body;
    assert.equal(dash.todayTotal, 7.92);
    assert.equal(dash.categories.transport, 1.92);
    assert.equal(dash.categories.food, 6);
    assert.ok(dash.score > 0);
    assert.ok(dash.tips.length >= 1);

    const board = (await call(`/api/leaderboard?today=${today}`)).body;
    assert.equal(board[0].name, 'Asha');

    const del = await call(`/api/activities/${logged.body.id}?userId=${user.id}`, 'DELETE');
    assert.equal(del.status, 204);
    const again = await call(`/api/activities/${logged.body.id}?userId=${user.id}`, 'DELETE');
    assert.equal(again.status, 404);
  });
});

test('validation rejects bad input', async () => {
  await withServer(async (call) => {
    const user = (await call('/api/users', 'POST', { name: 'Ravi' })).body;
    const base = { userId: user.id, category: 'transport', type: 'bus', quantity: 5, date: '2026-10-13' };

    assert.equal((await call('/api/activities', 'POST', { ...base, category: 'magic' })).status, 400);
    assert.equal((await call('/api/activities', 'POST', { ...base, type: 'jetpack' })).status, 400);
    assert.equal((await call('/api/activities', 'POST', { ...base, quantity: -3 })).status, 400);
    assert.equal((await call('/api/activities', 'POST', { ...base, date: 'yesterday' })).status, 400);
    assert.equal((await call('/api/activities', 'POST', { ...base, userId: 999 })).status, 404);
    assert.equal((await call(`/api/users/${user.id}/goal`, 'PUT', { dailyGoal: 0 })).status, 400);

    const goal = await call(`/api/users/${user.id}/goal`, 'PUT', { dailyGoal: 6 });
    assert.equal(goal.body.dailyGoal, 6);
  });
});

test('simulate endpoint', async () => {
  await withServer(async (call) => {
    const ok = await call('/api/simulate', 'POST', {
      category: 'food', fromType: 'beef_meal', toType: 'vegan_meal', quantity: 2,
    });
    assert.equal(ok.body.savingKg, 10.8);
    const bad = await call('/api/simulate', 'POST', { category: 'food', fromType: 'x', toType: 'y', quantity: 2 });
    assert.equal(bad.status, 400);
  });
});

test('eco coach uses logged activity and returns transparent estimates', async () => {
  await withServer(async (call) => {
    const user = (await call('/api/users', 'POST', { name: 'Eco User' })).body;
    await call('/api/activities', 'POST', {
      userId: user.id, category: 'transport', type: 'car_petrol', quantity: 20, date: '2026-10-13',
    });
    const result = await call(`/api/eco-coach?userId=${user.id}&today=2026-10-13`);
    assert.equal(result.status, 200);
    assert.ok(result.body.ideas.some((idea) => idea.title.includes('car trip')));
    assert.ok(result.body.disclaimer.includes('rough estimates'));
  });
});

test('pollution endpoint validates location input', async () => {
  await withServer(async (call) => {
    const result = await call('/api/pollution?city=x');
    assert.equal(result.status, 400);
  });
});

test('pollution forecast endpoint validates location input', async () => {
  await withServer(async (call) => {
    const result = await call('/api/pollution/forecast?city=x');
    assert.equal(result.status, 400);
  });
});
