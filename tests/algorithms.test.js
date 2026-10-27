'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const alg = require('../src/algorithms');
const { calcEmission } = require('../src/emissions');

const act = (date, emission, extra = {}) => ({
  date,
  emission,
  category: 'transport',
  type: 'car_petrol',
  quantity: 1,
  ...extra,
});

test('calcEmission multiplies factor by quantity', () => {
  assert.equal(calcEmission('transport', 'car_petrol', 10), 1.92);
  assert.equal(calcEmission('transport', 'bicycle', 50), 0);
  assert.equal(calcEmission('transport', 'teleporter', 5), null);
  assert.equal(calcEmission('transport', 'bus', -1), null);
});

test('ecoScore maps ratio to goal onto 0-100', () => {
  assert.equal(alg.ecoScore(4, 8), 100);
  assert.equal(alg.ecoScore(2, 8), 100);
  assert.equal(alg.ecoScore(8, 8), 67);
  assert.equal(alg.ecoScore(16, 8), 0);
  assert.equal(alg.ecoScore(30, 8), 0);
  assert.equal(alg.ecoScore(null, 8), null);
});

test('dailyTotals fills missing days and flags logged ones', () => {
  const daily = alg.dailyTotals([act('2026-10-12', 2), act('2026-10-12', 3), act('2026-10-10', 1)], '2026-10-13', 4);
  assert.deepEqual(
    daily.map((d) => [d.date, d.total, d.logged]),
    [
      ['2026-10-10', 1, true],
      ['2026-10-11', 0, false],
      ['2026-10-12', 5, true],
      ['2026-10-13', 0, false],
    ]
  );
  assert.equal(alg.averageDaily(daily), 3);
});

test('greenStreak counts consecutive days within goal and survives an unlogged today', () => {
  const acts = [act('2026-10-12', 5), act('2026-10-11', 6), act('2026-10-10', 7)];
  assert.equal(alg.greenStreak(acts, '2026-10-13', 8), 3);

  const broken = [act('2026-10-12', 5), act('2026-10-11', 20), act('2026-10-10', 7)];
  assert.equal(alg.greenStreak(broken, '2026-10-13', 8), 1);

  const gap = [act('2026-10-12', 5), act('2026-10-10', 7)];
  assert.equal(alg.greenStreak(gap, '2026-10-13', 8), 1);
});

test('linearRegression recovers an exact line', () => {
  const { slope, intercept } = alg.linearRegression([0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1 })));
  assert.ok(Math.abs(slope - 2) < 1e-9);
  assert.ok(Math.abs(intercept - 1) < 1e-9);
});

test('forecast needs 3 points, detects direction and never goes negative', () => {
  const few = alg.dailyTotals([act('2026-10-13', 5)], '2026-10-13', 7);
  assert.equal(alg.forecast(few), null);

  const rising = alg.dailyTotals(
    [act('2026-10-11', 4), act('2026-10-12', 6), act('2026-10-13', 8)],
    '2026-10-13',
    7
  );
  const f = alg.forecast(rising, 3);
  assert.equal(f.direction, 'rising');
  assert.equal(f.predictions.length, 3);
  assert.equal(f.predictions[0].date, '2026-10-14');

  const falling = alg.dailyTotals(
    [act('2026-10-11', 3), act('2026-10-12', 1.5), act('2026-10-13', 0.2)],
    '2026-10-13',
    7
  );
  const g = alg.forecast(falling, 7);
  assert.equal(g.direction, 'falling');
  assert.ok(g.predictions.every((p) => p.total >= 0));
});

test('generateTips ranks by saving and falls back when there is no data', () => {
  const empty = alg.generateTips([]);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].category, 'general');

  const week = [
    { category: 'transport', type: 'car_petrol', quantity: 100, emission: 19.2 },
    { category: 'food', type: 'beef_meal', quantity: 4, emission: 24 },
    { category: 'energy', type: 'electricity_kwh', quantity: 20, emission: 16.4 },
  ];
  const tips = alg.generateTips(week);
  assert.ok(tips.length >= 2 && tips.length <= 3);
  for (let i = 1; i < tips.length; i++) {
    assert.ok(tips[i - 1].weeklySavingKg >= tips[i].weeklySavingKg);
  }
  // 100 km * 30% * (0.192 - 0.041) = 4.53
  const transport = tips.find((t) => t.category === 'transport');
  assert.equal(transport.weeklySavingKg, 4.53);
});

test('simulateSwap computes the saving between two activities', () => {
  const r = alg.simulateSwap('transport', 'car_petrol', 'bus', 100);
  assert.equal(r.beforeKg, 19.2);
  assert.equal(r.afterKg, 10.5);
  assert.equal(r.savingKg, 8.7);
  assert.equal(alg.simulateSwap('transport', 'car_petrol', 'nope', 100), null);
});
