'use strict';

/**
 * Emission factors in kg CO2e per unit.
 *
 * These are rounded, approximate values based on publicly available
 * averages (e.g. UK DEFRA conversion factors, IPCC/Our World in Data food
 * footprints, India CEA grid factor). They are good enough for awareness and
 * relative comparison, not for official carbon accounting.
 * Edit this file to localise the numbers for your region.
 */
const FACTORS = {
  transport: {
    unit: 'km',
    label: 'Transport',
    items: {
      car_petrol: { label: 'Car (petrol)', factor: 0.192 },
      car_diesel: { label: 'Car (diesel)', factor: 0.171 },
      car_electric: { label: 'Car (electric)', factor: 0.053 },
      motorbike: { label: 'Motorbike / scooter', factor: 0.114 },
      bus: { label: 'Bus', factor: 0.105 },
      metro_train: { label: 'Metro / train', factor: 0.041 },
      flight_short: { label: 'Flight', factor: 0.255 },
      bicycle: { label: 'Bicycle', factor: 0 },
      walking: { label: 'Walking', factor: 0 },
    },
  },
  food: {
    unit: 'meals',
    label: 'Food',
    items: {
      beef_meal: { label: 'Beef / mutton meal', factor: 6.0 },
      pork_meal: { label: 'Pork meal', factor: 2.4 },
      chicken_meal: { label: 'Chicken meal', factor: 1.8 },
      fish_meal: { label: 'Fish meal', factor: 1.5 },
      vegetarian_meal: { label: 'Vegetarian meal', factor: 0.9 },
      vegan_meal: { label: 'Vegan meal', factor: 0.6 },
    },
  },
  energy: {
    unit: 'units',
    label: 'Home energy',
    items: {
      electricity_kwh: { label: 'Electricity (kWh)', factor: 0.82 },
      lpg_kg: { label: 'LPG cooking gas (kg)', factor: 2.98 },
    },
  },
  waste: {
    unit: 'kg',
    label: 'Waste',
    items: {
      general_waste_kg: { label: 'General waste (landfill)', factor: 0.45 },
      recycled_kg: { label: 'Recycled waste', factor: 0.02 },
      compost_kg: { label: 'Composted waste', factor: 0.01 },
    },
  },
};

const CATEGORIES = Object.keys(FACTORS);

function lookup(category, type) {
  const cat = FACTORS[category];
  if (!cat) return null;
  const item = cat.items[type];
  if (!item) return null;
  return { ...item, unit: unitFor(category, type) };
}

function unitFor(category, type) {
  if (category === 'energy') return type === 'lpg_kg' ? 'kg' : 'kWh';
  return FACTORS[category].unit;
}

/** kg CO2e for a given activity. Returns null if category/type is unknown. */
function calcEmission(category, type, quantity) {
  const item = lookup(category, type);
  if (!item || !Number.isFinite(quantity) || quantity < 0) return null;
  return round(item.factor * quantity, 3);
}

function round(n, digits = 2) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

/** Shape sent to the frontend so dropdowns are built from one source of truth. */
function publicFactors() {
  const out = {};
  for (const [cat, def] of Object.entries(FACTORS)) {
    out[cat] = {
      label: def.label,
      items: Object.entries(def.items).map(([key, v]) => ({
        key,
        label: v.label,
        factor: v.factor,
        unit: unitFor(cat, key),
      })),
    };
  }
  return out;
}

module.exports = { FACTORS, CATEGORIES, lookup, calcEmission, publicFactors, round };
