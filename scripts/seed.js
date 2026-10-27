'use strict';

/**
 * Fills the database with demo users and ~3 weeks of realistic activity so the
 * charts, forecast and leaderboard look good in a hackathon demo.
 *   npm run seed
 */

const { openDb } = require('../src/db');
const { calcEmission } = require('../src/emissions');
const { toDateStr, addDays } = require('../src/algorithms');

const db = openDb();
const today = toDateStr(new Date());

const personas = [
  { name: 'Aarav', car: 18, bus: 6, beef: 0.5, veg: 1.6, kwh: 7 },
  { name: 'Meera', car: 4, bus: 3, beef: 0.1, veg: 2.2, kwh: 5 },
  { name: 'Kabir', car: 30, bus: 0, beef: 1, veg: 1, kwh: 11 },
];

const insertUser = db.prepare('INSERT INTO users (name) VALUES (?)');
const insertAct = db.prepare(
  'INSERT INTO activities (user_id, category, type, quantity, emission, date) VALUES (?, ?, ?, ?, ?, ?)'
);

const jitter = (v) => Math.max(0, Math.round(v * (0.7 + Math.random() * 0.6) * 10) / 10);

const run = db.transaction(() => {
  for (const p of personas) {
    const userId = insertUser.run(p.name).lastInsertRowid;
    for (let i = 20; i >= 0; i--) {
      const date = addDays(today, -i);
      // gentle improvement over time so the trend line tells a story
      const improve = 1 - (20 - i) * 0.01;
      const rows = [
        ['transport', 'car_petrol', jitter(p.car * improve)],
        ['transport', 'bus', jitter(p.bus)],
        ['food', 'beef_meal', Math.random() < p.beef ? 1 : 0],
        ['food', 'vegetarian_meal', Math.round(p.veg)],
        ['energy', 'electricity_kwh', jitter(p.kwh)],
      ];
      for (const [category, type, quantity] of rows) {
        if (quantity > 0) insertAct.run(userId, category, type, quantity, calcEmission(category, type, quantity), date);
      }
    }
  }
});

run();
console.log(`Seeded ${personas.length} demo users with 21 days of activity.`);
