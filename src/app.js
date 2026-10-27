'use strict';

const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const { CATEGORIES, calcEmission, publicFactors, round } = require('./emissions');
const alg = require('./algorithms');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function createApp(db = openDb()) {
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const q = {
    createUser: db.prepare('INSERT INTO users (name) VALUES (?)'),
    getUser: db.prepare('SELECT id, name, daily_goal AS dailyGoal FROM users WHERE id = ?'),
    setGoal: db.prepare('UPDATE users SET daily_goal = ? WHERE id = ?'),
    allUsers: db.prepare('SELECT id, name, daily_goal AS dailyGoal FROM users'),
    insertActivity: db.prepare(
      'INSERT INTO activities (user_id, category, type, quantity, emission, date) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    deleteActivity: db.prepare('DELETE FROM activities WHERE id = ? AND user_id = ?'),
    activitiesSince: db.prepare(
      `SELECT id, category, type, quantity, emission, date
         FROM activities WHERE user_id = ? AND date >= ? AND date <= ?
         ORDER BY date DESC, id DESC`
    ),
    recent: db.prepare(
      `SELECT id, category, type, quantity, emission, date
         FROM activities WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT ?`
    ),
  };

  const resolveToday = (req) =>
    typeof req.query.today === 'string' && DATE_RE.test(req.query.today)
      ? req.query.today
      : alg.toDateStr(new Date());

  function requireUser(req, res) {
    const id = Number(req.query.userId ?? req.body?.userId ?? req.params.id);
    const user = Number.isInteger(id) ? q.getUser.get(id) : null;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return null;
    }
    return user;
  }

  /* ---------- live environmental intelligence ---------- */

  app.get('/api/pollution', async (req, res) => {
    const city = String(req.query.city || '').trim();
    if (city.length < 2 || city.length > 100) {
      return res.status(400).json({ error: 'Enter a city or area name (2-100 characters).' });
    }
    const key = process.env.OPENWEATHER_API_KEY;
    if (!key) {
      return res.status(503).json({ error: 'Live pollution is not configured yet. Add OPENWEATHER_API_KEY to your .env file and restart EcoTrack.' });
    }
    try {
      const geoUrl = new URL('https://api.openweathermap.org/geo/1.0/direct');
      geoUrl.search = new URLSearchParams({ q: city, limit: '1', appid: key });
      const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
      if (!geoRes.ok) return res.status(502).json({ error: 'Location lookup failed. Check the API key and try another place.' });
      const locations = await geoRes.json();
      if (!locations.length) return res.status(404).json({ error: 'Location not found. Try a city name such as Ghaziabad, IN.' });
      const place = locations[0];
      const pollutionUrl = new URL('https://api.openweathermap.org/data/2.5/air_pollution');
      pollutionUrl.search = new URLSearchParams({ lat: String(place.lat), lon: String(place.lon), appid: key });
      const pollutionRes = await fetch(pollutionUrl, { signal: AbortSignal.timeout(8000) });
      if (!pollutionRes.ok) return res.status(502).json({ error: 'Pollution provider could not return data for this location.' });
      const payload = await pollutionRes.json();
      const item = payload.list?.[0];
      if (!item) return res.status(502).json({ error: 'No pollution reading is currently available for this location.' });
      const c = item.components || {};
      const aqi = Number(item.main?.aqi || 0);
      const aqiLabels = { 1: 'Good', 2: 'Fair', 3: 'Moderate', 4: 'Poor', 5: 'Very poor' };
      const suggestions = [];
      if (aqi >= 4) suggestions.push('Consider reducing strenuous outdoor activity and check local health guidance. This reading is not a medical diagnosis.');
      if (aqi >= 3) suggestions.push('Where practical, choose lower-traffic routes and avoid adding unnecessary vehicle trips.');
      if (Number(c.pm2_5 || 0) > 25) suggestions.push('Reduce avoidable combustion emissions: combine errands, carpool, or use public transport when feasible.');
      suggestions.push('For carbon reduction, log your travel and energy use in EcoTrack; air pollution and personal CO₂e are different measures.');
      res.set('Cache-Control', 'public, max-age=600');
      res.json({
        location: { name: place.name, state: place.state || null, country: place.country, lat: place.lat, lon: place.lon },
        observedAt: item.dt ? new Date(item.dt * 1000).toISOString() : null,
        aqi, aqiLabel: aqiLabels[aqi] || 'Unavailable',
        components: { co: c.co ?? null, no: c.no ?? null, no2: c.no2 ?? null, o3: c.o3 ?? null, so2: c.so2 ?? null, pm2_5: c.pm2_5 ?? null, pm10: c.pm10 ?? null, nh3: c.nh3 ?? null },
        suggestions,
        source: 'OpenWeather Air Pollution API',
        note: 'Provider AQI is on a 1–5 scale. Pollutant concentrations are µg/m³ except CO, which is reported in µg/m³ by this API. This is not a street-level guarantee.'
      });
    } catch (err) {
      console.error('Pollution lookup failed:', err.message);
      res.status(502).json({ error: 'Could not reach the pollution service. Please try again shortly.' });
    }
  });

  app.get('/api/pollution/forecast', async (req, res) => {
    const city = String(req.query.city || '').trim();
    if (city.length < 2 || city.length > 100) {
      return res.status(400).json({ error: 'Enter a city or area name (2-100 characters).' });
    }
    const key = process.env.OPENWEATHER_API_KEY;
    if (!key) {
      return res.status(503).json({ error: 'Air-pollution forecast is not configured. Add OPENWEATHER_API_KEY to your .env file and restart EcoTrack.' });
    }
    try {
      const geoUrl = new URL('https://api.openweathermap.org/geo/1.0/direct');
      geoUrl.search = new URLSearchParams({ q: city, limit: '1', appid: key });
      const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
      if (!geoRes.ok) return res.status(502).json({ error: 'Location lookup failed. Check the API key and try another place.' });
      const locations = await geoRes.json();
      if (!locations.length) return res.status(404).json({ error: 'Location not found. Try a city name such as Ghaziabad, IN.' });
      const place = locations[0];
      const forecastUrl = new URL('https://api.openweathermap.org/data/2.5/air_pollution/forecast');
      forecastUrl.search = new URLSearchParams({ lat: String(place.lat), lon: String(place.lon), appid: key });
      const forecastRes = await fetch(forecastUrl, { signal: AbortSignal.timeout(10000) });
      if (!forecastRes.ok) return res.status(502).json({ error: 'OpenWeather could not return an air-pollution forecast for this location.' });
      const payload = await forecastRes.json();
      const points = (payload.list || []).map((item) => ({
        timestamp: item.dt ? new Date(item.dt * 1000).toISOString() : null,
        aqi: Number.isFinite(Number(item.main?.aqi)) ? Number(item.main.aqi) : null,
        components: {
          pm2_5: item.components?.pm2_5 ?? null,
          pm10: item.components?.pm10 ?? null,
          no2: item.components?.no2 ?? null,
          o3: item.components?.o3 ?? null,
          co: item.components?.co ?? null,
          so2: item.components?.so2 ?? null,
          nh3: item.components?.nh3 ?? null,
        },
      }));
      if (!points.length) return res.status(502).json({ error: 'No forecast points are currently available for this location.' });
      res.set('Cache-Control', 'public, max-age=1800');
      res.json({
        location: { name: place.name, state: place.state || null, country: place.country, lat: place.lat, lon: place.lon },
        source: 'OpenWeather Air Pollution Forecast API',
        points,
        note: 'This is a model forecast, not a guarantee of future local air quality. OpenWeather AQI uses a 1–5 scale; pollutant values are reported by the provider in µg/m³. Air pollution is different from personal CO₂e emissions.',
      });
    } catch (err) {
      console.error('Pollution forecast failed:', err.message);
      res.status(502).json({ error: 'Could not reach the air-pollution forecast service. Please try again shortly.' });
    }
  });

  app.get('/api/eco-coach', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const today = resolveToday(req);
    const acts = q.activitiesSince.all(user.id, alg.addDays(today, -6), today);
    const byType = Object.create(null);
    for (const a of acts) byType[a.type] = (byType[a.type] || 0) + a.quantity;
    const ideas = [];
    const add = (title, detail, savingKg, costNote, difficulty = 'Easy') => ideas.push({ title, detail, estimatedWeeklySavingKg: Math.max(0, Math.round(savingKg * 100) / 100), costNote, difficulty });
    if (byType.car_petrol || byType.car_diesel) add('Replace one short car trip', 'Try walking, cycling, public transport or sharing a ride for one suitable short journey.', (byType.car_petrol || 0) * 0.192 * 0.15 + (byType.car_diesel || 0) * 0.171 * 0.15, 'May save fuel costs', 'Easy');
    if (byType.beef_meal) add('Try a lower-impact meal', 'Replace one beef or mutton meal with a meal you enjoy that has a lower estimated footprint.', Math.min(byType.beef_meal, 2) * (6 - 0.9), 'Depends on meal prices', 'Easy');
    if (byType.electricity_kwh) add('Reduce avoidable electricity use', 'Switch off unused devices and adjust cooling/heating sensibly; check actual meter readings over time.', Math.min(byType.electricity_kwh * 0.1, byType.electricity_kwh) * 0.82, 'Potential electricity-bill saving', 'Easy');
    if (byType.general_waste_kg) add('Prevent and sort waste', 'Avoid food waste first, then separate recyclable and compostable material where local services accept it.', Math.min(byType.general_waste_kg, 2) * (0.45 - 0.02), 'Can reduce waste costs where applicable', 'Medium');
    add('Set one measurable weekly goal', 'Choose one change you can realistically repeat, log it, and compare your activity totals next week.', 0, 'Track your progress in EcoTrack', 'Easy');
    res.json({ user: user.name, periodDays: 7, ideas: ideas.sort((a, b) => b.estimatedWeeklySavingKg - a.estimatedWeeklySavingKg).slice(0, 5), disclaimer: 'Savings are rough estimates based on logged quantities and rounded emission factors; actual results depend on what you replace and local conditions.' });
  });

  /* ---------- reference data ---------- */

  app.get('/api/factors', (_req, res) => res.json(publicFactors()));

  /* ---------- users ---------- */

  app.post('/api/users', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2 || name.length > 30) {
      return res.status(400).json({ error: 'Name must be 2-30 characters' });
    }
    const info = q.createUser.run(name);
    res.status(201).json(q.getUser.get(info.lastInsertRowid));
  });

  app.get('/api/users/:id', (req, res) => {
    const user = requireUser(req, res);
    if (user) res.json(user);
  });

  app.put('/api/users/:id/goal', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const goal = Number(req.body?.dailyGoal);
    if (!Number.isFinite(goal) || goal < 1 || goal > 100) {
      return res.status(400).json({ error: 'Daily goal must be between 1 and 100 kg CO2e' });
    }
    q.setGoal.run(goal, user.id);
    res.json(q.getUser.get(user.id));
  });

  /* ---------- activities ---------- */

  app.post('/api/activities', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const { category, type } = req.body ?? {};
    const quantity = Number(req.body?.quantity);
    const date = req.body?.date;

    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
      return res.status(400).json({ error: 'Quantity must be a positive number' });
    }
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
    }
    const emission = calcEmission(category, type, quantity);
    if (emission === null) return res.status(400).json({ error: 'Unknown activity type' });

    const info = q.insertActivity.run(user.id, category, type, quantity, emission, date);
    res.status(201).json({ id: info.lastInsertRowid, category, type, quantity, emission, date });
  });

  app.get('/api/activities', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    res.json(q.recent.all(user.id, limit));
  });

  app.delete('/api/activities/:id', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const info = q.deleteActivity.run(Number(req.params.id), user.id);
    if (!info.changes) return res.status(404).json({ error: 'Activity not found' });
    res.status(204).end();
  });

  /* ---------- dashboard ---------- */

  function buildStats(user, today) {
    const since14 = alg.addDays(today, -13);
    const acts14 = q.activitiesSince.all(user.id, since14, today);
    const since7 = alg.addDays(today, -6);
    const acts7 = acts14.filter((a) => a.date >= since7);

    const daily14 = alg.dailyTotals(acts14, today, 14);
    const daily7 = daily14.slice(-7);
    const avg7 = alg.averageDaily(daily7);
    const score = alg.ecoScore(avg7, user.dailyGoal);

    return { acts14, acts7, daily14, daily7, avg7, score };
  }

  app.get('/api/dashboard', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const today = resolveToday(req);
    const s = buildStats(user, today);

    const allActs = q.activitiesSince.all(user.id, '0000-01-01', today);
    const todayTotal = s.daily14[s.daily14.length - 1].total;

    res.json({
      user,
      today,
      todayTotal,
      avgDaily7: s.avg7,
      weekTotal: round(s.daily7.reduce((a, d) => a + d.total, 0)),
      score: s.score,
      scoreLabel: alg.scoreLabel(s.score),
      streak: alg.greenStreak(allActs, today, user.dailyGoal),
      categories: alg.categoryBreakdown(s.acts7),
      daily: s.daily14,
      forecast: alg.forecast(s.daily14, 7),
      tips: alg.generateTips(s.acts7),
    });
  });

  /* ---------- what-if simulator ---------- */

  app.post('/api/simulate', (req, res) => {
    const { category, fromType, toType } = req.body ?? {};
    const quantity = Number(req.body?.quantity);
    const result = alg.simulateSwap(category, fromType, toType, quantity);
    if (!result) return res.status(400).json({ error: 'Invalid simulation input' });
    res.json(result);
  });

  /* ---------- leaderboard ---------- */

  app.get('/api/leaderboard', (req, res) => {
    const today = resolveToday(req);
    const since7 = alg.addDays(today, -6);
    const rows = q.allUsers.all().map((u) => {
      const acts = q.activitiesSince.all(u.id, since7, today);
      const daily = alg.dailyTotals(acts, today, 7);
      const avg = alg.averageDaily(daily);
      return {
        id: u.id,
        name: u.name,
        avgDaily: avg,
        score: alg.ecoScore(avg, u.dailyGoal),
        loggedDays: daily.filter((d) => d.logged).length,
      };
    });
    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.loggedDays - a.loggedDays);
    res.json(rows.slice(0, 10));
  });

  /* ---------- error handling ---------- */

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
