# 🌱 EcoTrack

A personal **carbon footprint tracker** for the sustainability track of a hackathon. Log your travel, food, home energy and waste, and EcoTrack turns it into an eco score, a trend forecast and personalised swaps that save the most CO₂.

## Additional hackathon features

- **Individual and business profile option:** choose a personal or business/entrepreneur workspace during onboarding.
- **Visual dashboard:** local SVG illustrations and Chart.js graphs for activity trends, category breakdown and solar bill scenarios.
- **Solar savings planner:** estimates a simple bill offset, installed-cost scenario, payback period and potential grid-emissions avoidance from user-provided assumptions. Results are illustrative and exclude financing, maintenance, subsidies, export compensation and site-specific generation.
- **Carbon-credit education:** explains the difference between direct reductions and offsets, and encourages verification, registry checks, retirement checks and avoiding double counting. EcoTrack does not issue or certify credits.
- **Personalized report action plan:** recommends next steps based on logged categories, provides solar and efficiency ideas, and adds business-focused guidance for business profiles. Included in browser print / PDF reports.

Solar planning uses simplified assumptions (including 1,400 kWh per installed kW per year and 0.82 kg CO₂e/kWh for illustrative avoided-emissions estimates). Replace these with local, current, site-specific data before making decisions or claims.

## Features

- **Activity logging** across transport, food, energy and waste, with a live CO₂e preview
- **Dashboard**: today's total, 7-day average, eco score, green streak
- **Charts**: 14-day trend with a 7-day forecast, category breakdown
- **Smart tips**: ranked by the kg CO₂e *your own* habits would save per week
- **What-if simulator**: compare travel/food/waste alternatives and estimated CO₂e savings
- **Live pollution intelligence**: search a city, view OpenWeather AQI (1–5), supported pollutant readings, timestamp, map and practical suggestions
- **Air-pollution forecast**: fetch forecast intervals from OpenWeather, graph AQI (1–5) and PM2.5 for the next 24 forecast intervals, and display the provider caveat
- **Personalized Eco-Coach**: activity-aware, rule-based ideas with transparent estimated weekly savings
- **Energy & cost simulator**: estimate kWh, rupee and CO₂e savings for a chosen electricity reduction
- **Weekly challenges**: five practical challenges with browser-saved progress per profile
- **Impact exports**: download recent activity as CSV or print/save a report as PDF
- **Leaderboard** and an adjustable daily goal
- Light and dark mode, keyboard accessible, mobile friendly

## Tech stack

| Layer    | Choice |
|----------|--------|
| Backend  | Node.js (20+), Express |
| Database | SQLite via `better-sqlite3` |
| Frontend | Vanilla HTML/CSS/JS, Chart.js (CDN) |
| Tests    | Node's built-in test runner |

No build step. One `npm install` and it runs.

## Quick start

```bash
npm install
npm run seed     # optional: demo users + 3 weeks of data
npm start        # http://localhost:3000
npm test
```

Environment variables: `PORT` (default `3000`), `DB_FILE` (default `data/ecotrack.db`), and `OPENWEATHER_API_KEY` (required for live pollution search). Copy `.env.example` to `.env` and add your key. EcoTrack reads the key only on the server; never put it in frontend JavaScript or commit `.env`.

## Project structure

```
server.js              entry point
src/
  app.js               Express app factory and REST API
  db.js                SQLite schema
  emissions.js         emission factors + CO2e calculation
  algorithms.js        scoring, streak, forecast, tips, simulator
public/                frontend (index.html, styles.css, app.js)
scripts/seed.js        demo data
tests/                 algorithm and API tests
```

## The algorithms

All live in `src/algorithms.js` and are unit-tested.

1. **Emission calculation**: `kg CO2e = quantity × emission factor` (`src/emissions.js`).
2. **Eco score (0-100)**: with `ratio = 7-day average ÷ daily goal`, the score is 100 at ratio ≤ 0.5, 0 at ratio ≥ 2, and linear in between.
3. **Green streak**: consecutive days that were logged *and* within the daily goal. An unlogged today does not break the streak.
4. **Trend forecast**: ordinary least-squares linear regression over logged days, projected 7 days ahead (clamped at 0), plus a projected monthly total. Needs at least 3 logged days.
5. **Recommendation engine**: rule-based. Each rule inspects the last 7 days (e.g. km driven, beef meals, kWh, landfill kg), proposes a realistic swap, computes the weekly saving from the user's real numbers, and the top 3 are shown.
6. **What-if simulator**: `saving = quantity × (factor_from − factor_to)`, shown as tree-years of absorption (≈ 21 kg CO₂ per tree per year).

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/factors` | Categories, activity types, factors |
| GET | `/api/pollution?city=Ghaziabad%2C%20IN` | Geocode a location and return current OpenWeather Air Pollution data (requires `OPENWEATHER_API_KEY`) |
| GET | `/api/pollution/forecast?city=Ghaziabad%2C%20IN` | Return OpenWeather forecast intervals for a location (requires `OPENWEATHER_API_KEY`) |
| GET | `/api/eco-coach?userId=` | Activity-aware sustainability ideas and estimated savings |
| POST | `/api/users` | Create user `{ name }` |
| GET | `/api/users/:id` | Get user |
| PUT | `/api/users/:id/goal` | Set daily goal `{ dailyGoal }` |
| POST | `/api/activities` | Log `{ userId, category, type, quantity, date }` |
| GET | `/api/activities?userId=&limit=` | Recent activities |
| DELETE | `/api/activities/:id?userId=` | Delete an activity |
| GET | `/api/dashboard?userId=&today=` | Stats, charts data, forecast, tips |
| POST | `/api/simulate` | `{ category, fromType, toType, quantity }` |
| GET | `/api/leaderboard` | Top 10 by eco score |

## Notes and limitations

- Emission factors are rounded public averages (DEFRA, IPCC and Our World in Data style figures; India grid factor for electricity). They are for awareness, not official carbon accounting. Localise them in `src/emissions.js`.
- Users are name-only profiles stored in the browser, with no passwords. Add real authentication before any public deployment.

## Important limitations and next steps

- User profiles are name-only, not authenticated accounts. Do not use sensitive personal data; add proper authentication and authorization before a public production launch.
- Weekly challenge completion is stored in the current browser, not synced across devices or verified.
- Pollution results are provider readings and may not represent street-level conditions. The provider AQI is 1–5 and is not a personal carbon score.
- Energy savings use an illustrative 0.82 kg CO₂e/kWh factor and user-entered electricity price; localize both for better estimates.
- Emission factors are rounded public averages for awareness, not official carbon accounting.
- Add real authentication, server-side challenge persistence, region-specific emission factors, and broader integration tests before a public production launch.

## Credits

All application code in this repository was written from scratch for this project. Third-party packages: [Express](https://expressjs.com), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) and [Chart.js](https://www.chartjs.org), each under its own open-source license.

## License

MIT

## OpenWeather setup

1. Create an API key in your OpenWeather account with access to Geocoding API and Air Pollution API.
2. Copy `.env.example` to `.env` in the project root.
3. Set `OPENWEATHER_API_KEY=your_real_key` in `.env` (do not include quotes unless needed).
4. Run `npm install`, then `npm start`, and search for a city in Pollution intelligence.
5. For Render, add `OPENWEATHER_API_KEY` under the service's Environment settings; do not upload the `.env` file.
6. Use **View 5-day forecast** in Pollution intelligence to chart the next 24 forecast intervals (the API may return more).

The app deliberately returns a setup message if the key is absent. Never expose the API key in `public/app.js` or client-side HTML.

## Added feature behavior

- The Eco-Coach is deterministic and explainable, rather than a generative AI service; it ranks rule-based ideas using logged activity quantities.
- The what-if and energy tools produce estimates, not verified offsets. The energy simulator uses an illustrative grid factor of 0.82 kg CO₂e/kWh.
- Challenge completion is stored in browser local storage. It is not shared between devices and is not proof of verified action.
- CSV exports up to the 100 most recent activity records. Print / PDF opens the browser print dialog; choose “Save as PDF” there.
