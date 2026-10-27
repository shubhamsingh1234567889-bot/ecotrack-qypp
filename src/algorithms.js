'use strict';

const { FACTORS, lookup, round } = require('./emissions');

/* ------------------------------------------------------------------ *
 * Date helpers (all dates are YYYY-MM-DD strings, calendar days)
 * ------------------------------------------------------------------ */

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** Returns the `days` calendar days ending at `endDate`, oldest first. */
function lastNDays(endDate, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDays(endDate, -i));
  return out;
}

/* ------------------------------------------------------------------ *
 * Algorithm 1: daily totals
 * Groups activities by date and sums kg CO2e. Days with no logs are
 * returned with `logged: false` so other algorithms can ignore them.
 * ------------------------------------------------------------------ */

function dailyTotals(activities, endDate, days) {
  const map = new Map();
  for (const a of activities) {
    const cur = map.get(a.date) || { total: 0, count: 0 };
    cur.total += a.emission;
    cur.count += 1;
    map.set(a.date, cur);
  }
  return lastNDays(endDate, days).map((date) => {
    const v = map.get(date);
    return { date, total: v ? round(v.total) : 0, logged: !!v };
  });
}

/* ------------------------------------------------------------------ *
 * Algorithm 2: category breakdown
 * ------------------------------------------------------------------ */

function categoryBreakdown(activities) {
  const out = {};
  for (const cat of Object.keys(FACTORS)) out[cat] = 0;
  for (const a of activities) out[a.category] = (out[a.category] || 0) + a.emission;
  for (const k of Object.keys(out)) out[k] = round(out[k]);
  return out;
}

/** Mean daily emissions over days that have at least one log. */
function averageDaily(daily) {
  const logged = daily.filter((d) => d.logged);
  if (!logged.length) return null;
  return round(logged.reduce((s, d) => s + d.total, 0) / logged.length);
}

/* ------------------------------------------------------------------ *
 * Algorithm 3: eco score (0-100)
 * ratio = average daily emission / personal daily goal.
 *   ratio <= 0.5  -> 100 (half the goal or better)
 *   ratio >= 2.0  -> 0   (double the goal or worse)
 *   in between    -> linear interpolation
 * ------------------------------------------------------------------ */

function ecoScore(avgDaily, dailyGoal) {
  if (avgDaily == null || !dailyGoal) return null;
  const ratio = avgDaily / dailyGoal;
  const score = 100 * (1 - (ratio - 0.5) / 1.5);
  return Math.round(Math.min(100, Math.max(0, score)));
}

function scoreLabel(score) {
  if (score == null) return 'No data yet';
  if (score >= 85) return 'Planet hero';
  if (score >= 65) return 'Green mover';
  if (score >= 40) return 'On the way';
  return 'Room to grow';
}

/* ------------------------------------------------------------------ *
 * Algorithm 4: green streak
 * Consecutive days (ending today, or yesterday if nothing logged today
 * yet) on which the user logged something AND stayed within their goal.
 * ------------------------------------------------------------------ */

function greenStreak(activities, today, dailyGoal, lookbackDays = 365) {
  const daily = dailyTotals(activities, today, lookbackDays);
  let i = daily.length - 1;
  if (!daily[i].logged) i -= 1; // today not logged yet: don't break the streak
  let streak = 0;
  for (; i >= 0; i--) {
    const d = daily[i];
    if (d.logged && d.total <= dailyGoal) streak += 1;
    else break;
  }
  return streak;
}

/* ------------------------------------------------------------------ *
 * Algorithm 5: trend forecast (ordinary least squares)
 * Fits y = a + b*x on logged days only (x = day index) and projects the
 * next `ahead` days. Needs >= 3 logged points. Predictions are clamped
 * to >= 0.
 * ------------------------------------------------------------------ */

function linearRegression(points) {
  const n = points.length;
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function forecast(daily, ahead = 7) {
  const points = [];
  daily.forEach((d, i) => {
    if (d.logged) points.push({ x: i, y: d.total });
  });
  if (points.length < 3) return null;
  const { slope, intercept } = linearRegression(points);
  const lastDate = daily[daily.length - 1].date;
  const predictions = [];
  for (let k = 1; k <= ahead; k++) {
    const x = daily.length - 1 + k;
    predictions.push({
      date: addDays(lastDate, k),
      total: round(Math.max(0, intercept + slope * x)),
    });
  }
  return {
    slopePerDay: round(slope, 3),
    direction: slope < -0.05 ? 'falling' : slope > 0.05 ? 'rising' : 'flat',
    predictions,
    projectedMonthKg: round(predictions.reduce((s, p) => s + p.total, 0) / ahead * 30),
  };
}

/* ------------------------------------------------------------------ *
 * Algorithm 6: recommendation engine (rule based, personalised)
 * Each rule looks at the user's own recent activity, proposes a
 * realistic swap, and computes the kg CO2e that swap would have saved
 * per week. Rules are ranked by estimated saving.
 * ------------------------------------------------------------------ */

function sumQuantity(activities, category, types) {
  return activities
    .filter((a) => a.category === category && types.includes(a.type))
    .reduce((s, a) => s + a.quantity, 0);
}

function generateTips(weekActivities, weeklyScale = 1) {
  const f = (cat, type) => lookup(cat, type).factor;
  const tips = [];

  const carTypes = ['car_petrol', 'car_diesel', 'motorbike'];
  const carKm = sumQuantity(weekActivities, 'transport', carTypes);
  if (carKm > 0) {
    const weightedFactor =
      weekActivities
        .filter((a) => a.category === 'transport' && carTypes.includes(a.type))
        .reduce((s, a) => s + a.emission, 0) / carKm;
    const saving = carKm * 0.3 * (weightedFactor - f('transport', 'metro_train'));
    tips.push({
      category: 'transport',
      title: 'Swap 30% of your car trips for metro or train',
      detail: `You drove about ${round(carKm, 0)} km this week. Moving a third of it to public transport adds up.`,
      weeklySavingKg: round(saving),
    });
  }

  const flightKm = sumQuantity(weekActivities, 'transport', ['flight_short']);
  if (flightKm > 0) {
    const saving = flightKm * 0.8 * (f('transport', 'flight_short') - f('transport', 'metro_train'));
    tips.push({
      category: 'transport',
      title: 'Take the train for short-haul journeys',
      detail: 'Flights are the most carbon-intensive way to travel. Rail covers many routes with a fraction of the footprint.',
      weeklySavingKg: round(saving),
    });
  }

  const beefMeals = sumQuantity(weekActivities, 'food', ['beef_meal']);
  if (beefMeals > 0) {
    const saving = beefMeals * 0.5 * (f('food', 'beef_meal') - f('food', 'vegetarian_meal'));
    tips.push({
      category: 'food',
      title: 'Make half of your red-meat meals vegetarian',
      detail: `${round(beefMeals, 0)} red-meat meals logged. Beef and mutton have the highest food footprint by far.`,
      weeklySavingKg: round(saving),
    });
  }

  const chickenMeals = sumQuantity(weekActivities, 'food', ['chicken_meal', 'pork_meal']);
  if (chickenMeals >= 3) {
    const saving = chickenMeals * 0.4 * (f('food', 'chicken_meal') - f('food', 'vegetarian_meal'));
    tips.push({
      category: 'food',
      title: 'Try plant-based protein a few more times',
      detail: 'Lentils, chickpeas and tofu are cheap, filling and carry a much smaller footprint.',
      weeklySavingKg: round(saving),
    });
  }

  const kwh = sumQuantity(weekActivities, 'energy', ['electricity_kwh']);
  if (kwh > 0) {
    const saving = kwh * 0.15 * f('energy', 'electricity_kwh');
    tips.push({
      category: 'energy',
      title: 'Cut electricity use by 15%',
      detail: 'Set the AC to 24-26 C, switch off standby devices and use LED lighting.',
      weeklySavingKg: round(saving),
    });
  }

  const landfill = sumQuantity(weekActivities, 'waste', ['general_waste_kg']);
  if (landfill > 0) {
    const saving = landfill * 0.4 * (f('waste', 'general_waste_kg') - f('waste', 'compost_kg'));
    tips.push({
      category: 'waste',
      title: 'Compost or recycle 40% of your landfill waste',
      detail: `${round(landfill, 1)} kg went to landfill this week. Food scraps and paper are the easiest to divert.`,
      weeklySavingKg: round(saving),
    });
  }

  tips.sort((a, b) => b.weeklySavingKg - a.weeklySavingKg);
  const top = tips.filter((t) => t.weeklySavingKg > 0).slice(0, 3);

  if (!top.length) {
    return [
      {
        category: 'general',
        title: 'Log a few days of activity to unlock personalised tips',
        detail: 'Add your commute, meals and electricity use. EcoTrack finds your biggest savings from your own data.',
        weeklySavingKg: 0,
      },
    ];
  }
  return top.map((t) => ({ ...t, weeklySavingKg: round(t.weeklySavingKg * weeklyScale) }));
}

/* ------------------------------------------------------------------ *
 * Algorithm 7: what-if simulator
 * Saving from replacing `quantity` units of one activity type with
 * another in the same category.
 * ------------------------------------------------------------------ */

function simulateSwap(category, fromType, toType, quantity) {
  const from = lookup(category, fromType);
  const to = lookup(category, toType);
  if (!from || !to || !Number.isFinite(quantity) || quantity < 0) return null;
  const before = from.factor * quantity;
  const after = to.factor * quantity;
  return {
    beforeKg: round(before),
    afterKg: round(after),
    savingKg: round(before - after),
    // approx. mature tree absorbs ~21 kg CO2 per year
    treeYearsEquivalent: round(Math.max(0, before - after) / 21, 2),
  };
}

module.exports = {
  toDateStr,
  addDays,
  lastNDays,
  dailyTotals,
  categoryBreakdown,
  averageDaily,
  ecoScore,
  scoreLabel,
  greenStreak,
  linearRegression,
  forecast,
  generateTips,
  simulateSwap,
};
