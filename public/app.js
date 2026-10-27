'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'ecotrack.userId';
  const CAT_COLORS = { transport: '#2f7fd1', food: '#e0892b', energy: '#d6b21f', waste: '#8a6bbf' };

  let factors = {};
  let userId = null;
  let trendChart = null;
  let catChart = null;
  let solarChart = null;
  let pollutionForecastChart = null;
  let incomeChart = null;
  let profileMode = localStorage.getItem('ecotrack.profileType') || 'individual';
  let businessName = localStorage.getItem('ecotrack.businessName') || '';
  let latestDashboard = null;
  let latestSolarEstimate = null;

  /* ---------------- helpers ---------------- */

  const localToday = () => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  const fmt = (n, d = 1) => (n == null ? '–' : Number(n).toFixed(d));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function fillSelect(select, items, keepValue) {
    const prev = select.value;
    select.replaceChildren();
    for (const it of items) {
      const o = el('option', null, it.label);
      o.value = it.key;
      select.appendChild(o);
    }
    if (keepValue && items.some((i) => i.key === prev)) select.value = prev;
  }

  const itemOf = (cat, key) => factors[cat].items.find((i) => i.key === key);

  function applyProfileMode() {
    const isBusiness = profileMode === 'business';
    document.body.classList.toggle('business-mode', isBusiness);
    $('profileBanner').hidden = !isBusiness;
    $('profileHeading').textContent = businessName ? `${businessName} · sustainability planner` : 'Business sustainability planner';
    $('userName').textContent = '';
  }

  /* ---------------- onboarding ---------------- */

  function showWelcome() {
    $('welcome').hidden = false;
    $('app').hidden = true;
    $('switchUser').hidden = true;
    $('userName').textContent = '';
    $('profileType').value = profileMode;
    $('businessName').value = businessName;
    $('businessName').hidden = profileMode !== 'business';
  }

  async function showApp() {
    $('welcome').hidden = true;
    $('app').hidden = false;
    $('switchUser').hidden = false;
    applyProfileMode();
    await refresh();
  }

  $('profileType').value = profileMode;
  $('businessName').value = businessName;
  $('businessName').hidden = profileMode !== 'business';
  $('profileType').addEventListener('change', () => {
    $('businessName').hidden = $('profileType').value !== 'business';
    if ($('profileType').value === 'business') $('businessName').focus();
  });

  $('welcomeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('welcomeError').textContent = '';
    try {
      const user = await api('/api/users', { method: 'POST', body: { name: $('nameInput').value } });
      userId = user.id;
      profileMode = $('profileType').value;
      businessName = $('businessName').value.trim();
      localStorage.setItem('ecotrack.profileType', profileMode);
      localStorage.setItem('ecotrack.businessName', businessName);
      localStorage.setItem(STORAGE_KEY, String(user.id));
      await showApp();
    } catch (err) {
      $('welcomeError').textContent = err.message;
    }
  });

  $('switchUser').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    userId = null;
    $('nameInput').value = '';
    showWelcome();
  });

  /* ---------------- log form ---------------- */

  function setupCategoryControls() {
    const cats = Object.entries(factors).map(([key, v]) => ({ key, label: v.label }));
    fillSelect($('category'), cats);
    fillSelect($('simCategory'), cats);
    onCategoryChange();
    onSimCategoryChange();
  }

  function onCategoryChange() {
    const cat = $('category').value;
    fillSelect($('type'), factors[cat].items);
    updatePreview();
  }

  function updatePreview() {
    const cat = $('category').value;
    const item = itemOf(cat, $('type').value);
    if (!item) return;
    $('qtyLabel').textContent = `Quantity (${item.unit})`;
    const qty = Number($('quantity').value);
    const kg = Number.isFinite(qty) ? item.factor * qty : 0;
    $('preview').textContent = `≈ ${kg.toFixed(2)} kg CO₂e`;
  }

  $('category').addEventListener('change', onCategoryChange);
  $('type').addEventListener('change', updatePreview);
  $('quantity').addEventListener('input', updatePreview);

  $('logForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('logError').textContent = '';
    try {
      await api('/api/activities', {
        method: 'POST',
        body: {
          userId,
          category: $('category').value,
          type: $('type').value,
          quantity: Number($('quantity').value),
          date: $('date').value,
        },
      });
      await refresh();
    } catch (err) {
      $('logError').textContent = err.message;
    }
  });

  /* ---------------- simulator ---------------- */

  function onSimCategoryChange() {
    const cat = $('simCategory').value;
    const items = factors[cat].items;
    fillSelect($('simFrom'), items);
    fillSelect($('simTo'), items);
    if (items.length > 1) $('simTo').selectedIndex = items.length - 1;
    $('simQtyLabel').textContent = `Amount (${items[0].unit})`;
    $('simResult').textContent = '';
  }
  $('simCategory').addEventListener('change', onSimCategoryChange);

  $('simForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/simulate', {
        method: 'POST',
        body: {
          category: $('simCategory').value,
          fromType: $('simFrom').value,
          toType: $('simTo').value,
          quantity: Number($('simQty').value),
        },
      });
      const from = itemOf($('simCategory').value, $('simFrom').value).label;
      const to = itemOf($('simCategory').value, $('simTo').value).label;
      $('simResult').textContent =
        r.savingKg >= 0
          ? `Switching from ${from} to ${to} saves ${r.savingKg} kg CO₂e, roughly what ${r.treeYearsEquivalent} trees absorb in a year.`
          : `That swap would add ${Math.abs(r.savingKg)} kg CO₂e. Try the other way round.`;
    } catch (err) {
      $('simResult').textContent = err.message;
    }
  });

  /* ---------------- goal ---------------- */

  $('goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/users/${userId}/goal`, { method: 'PUT', body: { dailyGoal: Number($('goalInput').value) } });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  /* ---------------- rendering ---------------- */

  function renderStats(d) {
    $('userName').textContent = profileMode === 'business' ? `${d.user.name} · Business` : d.user.name;
    $('statToday').textContent = fmt(d.todayTotal);
    $('statAvg').textContent = fmt(d.avgDaily7);
    $('statGoal').textContent = `kg CO₂e / day (goal ${d.user.dailyGoal})`;
    $('statScore').textContent = d.score == null ? '–' : d.score;
    $('statScoreLabel').textContent = d.scoreLabel;
    $('statStreak').textContent = d.streak;
    $('goalInput').value = d.user.dailyGoal;
  }

  function renderTrend(d) {
    const labels = d.daily.map((x) => x.date.slice(5));
    const actual = d.daily.map((x) => (x.logged ? x.total : null));
    const pred = d.forecast ? d.forecast.predictions : [];
    const allLabels = labels.concat(pred.map((p) => p.date.slice(5)));
    const lastIdx = d.daily.length - 1;

    const forecastData = new Array(allLabels.length).fill(null);
    if (pred.length) {
      forecastData[lastIdx] = d.daily[lastIdx].logged ? d.daily[lastIdx].total : pred[0].total;
      pred.forEach((p, i) => (forecastData[lastIdx + 1 + i] = p.total));
    }
    const goalLine = new Array(allLabels.length).fill(d.user.dailyGoal);

    const text = cssVar('--muted');
    const grid = cssVar('--line');
    const green = cssVar('--green');

    const data = {
      labels: allLabels,
      datasets: [
        { label: 'Logged', data: actual, borderColor: green, backgroundColor: green, tension: 0.3, spanGaps: true, pointRadius: 3 },
        { label: 'Forecast', data: forecastData, borderColor: green, borderDash: [6, 6], pointRadius: 0, tension: 0.2 },
        { label: 'Goal', data: goalLine, borderColor: cssVar('--warn'), borderWidth: 1, pointRadius: 0 },
      ],
    };

    if (trendChart) trendChart.destroy();
    trendChart = new Chart($('trendChart'), {
      type: 'line',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: text, boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: text, maxTicksLimit: 8 }, grid: { color: grid } },
          y: { beginAtZero: true, title: { display: true, text: 'kg CO₂e', color: text }, ticks: { color: text }, grid: { color: grid } },
        },
      },
    });

    $('forecastNote').textContent = d.forecast
      ? `Trend is ${d.forecast.direction}. At this pace you would emit about ${fmt(d.forecast.projectedMonthKg, 0)} kg CO₂e over a month.`
      : 'Log at least 3 days to see your forecast.';
  }

  function renderCategories(d) {
    const entries = Object.entries(d.categories).filter(([, v]) => v > 0);
    $('catEmpty').hidden = entries.length > 0;
    $('catChart').parentElement.hidden = entries.length === 0;
    if (catChart) catChart.destroy();
    if (!entries.length) return;
    catChart = new Chart($('catChart'), {
      type: 'doughnut',
      data: {
        labels: entries.map(([k]) => factors[k].label),
        datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([k]) => CAT_COLORS[k]), borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: { legend: { position: 'right', labels: { color: cssVar('--muted'), boxWidth: 12 } } },
      },
    });
  }

  /* ---------------- impact dashboard widgets ---------------- */

  const moneyFmt = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

  function renderIncomeComparison() {
    const before = Math.max(0, Number($('incomeBefore').value) || 0);
    const after = Math.max(0, Number($('incomeAfter').value) || 0);
    localStorage.setItem('ecotrack.incomeBefore', String(before));
    localStorage.setItem('ecotrack.incomeAfter', String(after));
    if (incomeChart) incomeChart.destroy();
    incomeChart = new Chart($('incomeChart'), {
      type: 'bar',
      data: {
        labels: ['Before EcoTrack', 'After EcoTrack'],
        datasets: [{ label: 'Monthly income (₹)', data: [before, after], backgroundColor: ['#94a3b8', '#22a06b'], borderRadius: 9, maxBarThickness: 64 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => moneyFmt(ctx.parsed.y) } } },
        scales: {
          x: { ticks: { color: cssVar('--muted') }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: cssVar('--muted'), callback: (v) => `₹${Number(v).toLocaleString('en-IN')}` }, grid: { color: cssVar('--line') } },
        },
      },
    });
    const difference = after - before;
    const pct = before > 0 ? (difference / before) * 100 : null;
    $('incomeDelta').textContent = difference > 0
      ? `Entered figures show ${moneyFmt(difference)} more per month${pct == null ? '' : ` (+${pct.toFixed(1)}%)`}.`
      : difference < 0 ? `Entered figures show ${moneyFmt(Math.abs(difference))} less per month${pct == null ? '' : ` (${pct.toFixed(1)}%)`}.`
      : 'Entered monthly income is unchanged.';
  }

  function renderSectorCircles(d) {
    const container = $('sectorCircles');
    container.replaceChildren();
    const categories = d?.categories || {};
    const entries = Object.entries(categories).filter(([, value]) => Number(value) > 0);
    const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
    if (!total) {
      container.appendChild(el('p', 'empty', 'Log a few activities to see your sector breakdown.'));
      $('sectorSummary').textContent = 'No emissions logged in the last 7 days yet.';
      return;
    }
    const labels = { transport: 'Transport', food: 'Food', energy: 'Electricity', waste: 'Waste' };
    entries.sort((a, b) => Number(b[1]) - Number(a[1]));
    for (const [key, value] of entries) {
      const share = Math.round((Number(value) / total) * 100);
      const color = CAT_COLORS[key] || '#64748b';
      const item = el('div', 'sector-item');
      const ring = el('div', 'sector-ring');
      ring.style.setProperty('--ring-color', color);
      ring.style.setProperty('--ring-value', `${share}%`);
      ring.setAttribute('role', 'img');
      ring.setAttribute('aria-label', `${labels[key] || key}: ${share}% of logged emissions`);
      const center = el('span', 'sector-ring-value', `${share}%`);
      ring.appendChild(center);
      item.append(ring, el('strong', 'sector-label', labels[key] || key), el('span', 'sector-amount', `${Number(value).toFixed(1)} kg CO₂e`));
      container.appendChild(item);
    }
    const largest = entries[0];
    $('sectorSummary').textContent = `${labels[largest[0]] || largest[0]} is your largest logged source at ${Math.round((Number(largest[1]) / total) * 100)}% of recent emissions.`;
  }

  function renderEnergyMix() {
    const clean = Math.min(100, Math.max(0, Number($('cleanEnergyShare').value) || 0));
    const dirty = 100 - clean;
    $('energyMixRing').style.setProperty('--clean-share', `${clean}%`);
    $('cleanPercentLabel').textContent = `${clean}%`;
    $('cleanLegendLabel').textContent = `${clean}%`;
    $('dirtyPercentLabel').textContent = `${dirty}%`;
    $('cleanSliderLabel').textContent = `${clean}%`;
    localStorage.setItem('ecotrack.cleanEnergyShare', String(clean));
  }

  function renderImpactDashboard(d) {
    renderSectorCircles(d);
    renderIncomeComparison();
    renderEnergyMix();
  }

  $('incomeBefore').value = localStorage.getItem('ecotrack.incomeBefore') ?? '30000';
  $('incomeAfter').value = localStorage.getItem('ecotrack.incomeAfter') ?? '33000';
  $('cleanEnergyShare').value = localStorage.getItem('ecotrack.cleanEnergyShare') ?? '30';
  $('incomeBefore').addEventListener('input', renderIncomeComparison);
  $('incomeAfter').addEventListener('input', renderIncomeComparison);
  $('cleanEnergyShare').addEventListener('input', renderEnergyMix);

  function renderTips(d) {
    const ul = $('tips');
    ul.replaceChildren();
    for (const t of d.tips) {
      const li = el('li', 'tip');
      li.appendChild(el('strong', null, t.title));
      li.appendChild(el('p', null, t.detail));
      if (t.weeklySavingKg > 0) li.appendChild(el('span', 'saving', `Saves ≈ ${t.weeklySavingKg} kg CO₂e / week`));
      ul.appendChild(li);
    }
  }

  function renderBoard(rows) {
    const ol = $('board');
    ol.replaceChildren();
    if (!rows.length) {
      ol.appendChild(el('li', 'empty', 'No one yet.'));
      return;
    }
    rows.forEach((r, i) => {
      const li = el('li', r.id === userId ? 'me' : '');
      li.appendChild(el('span', 'rank', String(i + 1)));
      li.appendChild(el('span', 'name', r.name));
      li.appendChild(el('span', 'pts', r.score == null ? '–' : `${r.score} pts`));
      ol.appendChild(li);
    });
  }

  function renderRecent(rows) {
    const ul = $('recent');
    ul.replaceChildren();
    if (!rows.length) {
      ul.appendChild(el('li', 'empty', 'Nothing logged yet. Add your first activity above.'));
      return;
    }
    for (const a of rows) {
      const item = itemOf(a.category, a.type);
      const li = el('li');
      li.appendChild(el('span', 'date', a.date));
      li.appendChild(el('span', 'desc', `${item ? item.label : a.type}: ${a.quantity} ${item ? item.unit : ''}`));
      li.appendChild(el('span', 'kg', `${a.emission.toFixed(2)} kg`));
      const del = el('button', 'del', '✕');
      del.type = 'button';
      del.title = 'Delete';
      del.setAttribute('aria-label', 'Delete activity');
      del.addEventListener('click', async () => {
        await api(`/api/activities/${a.id}?userId=${userId}`, { method: 'DELETE' });
        await refresh();
      });
      li.appendChild(del);
      ul.appendChild(li);
    }
  }

  function renderReportActions(d) {
    const list = $('reportActions');
    list.replaceChildren();
    const actions = [];
    const categories = d.categories || {};
    const largest = Object.entries(categories).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0)[0];
    if (largest) {
      const names = { transport: 'travel', food: 'food choices', energy: 'electricity use', waste: 'waste' };
      const suggestions = {
        transport: 'Combine errands, carpool, or compare public transport for practical trips. Recalculate the same distance in the What-if simulator before choosing an alternative.',
        food: 'Plan meals to avoid food waste and try a few lower-impact meals that fit your preferences. Track changes consistently rather than relying on one-day estimates.',
        energy: 'Start with no-cost efficiency actions: switch off unused devices, use efficient lighting, and check appliance settings. Then compare energy-saving scenarios.',
        waste: 'Separate recyclable materials according to local collection rules, reuse items where possible, and prevent waste before focusing on disposal.'
      };
      actions.push({ title: `Start with ${names[largest[0]]}`, detail: suggestions[largest[0]], saving: `Largest logged category: ${Number(largest[1]).toFixed(1)} kg CO₂e in the recent dashboard period.` });
    } else {
      actions.push({ title: 'Log a representative week', detail: 'Add travel, food, electricity and waste activities. A more complete activity log makes the recommendations more useful.', saving: 'Baseline first; then compare changes.' });
    }
    actions.push({ title: 'Reduce electricity demand before investing', detail: 'Review monthly kWh, improve efficiency, and use the energy simulator. Savings depend on your tariff, usage and local electricity emissions factor.', saving: 'Low-cost efficiency measures can be evaluated before buying equipment.' });
    actions.push({ title: 'Explore rooftop solar with real quotes', detail: 'Use the solar planner as a first-pass scenario, then compare installer quotations, roof suitability, shading, net-metering rules, maintenance and available subsidies with official sources.', saving: latestSolarEstimate ? `Your current scenario estimates about ₹${Math.round(latestSolarEstimate.annualSavings).toLocaleString('en-IN')}/year in bill savings before maintenance and financing.` : 'Run the solar savings planner to estimate a scenario.' });
    if (profileMode === 'business') {
      actions.push({ title: 'Create a business emissions action plan', detail: 'Gather utility bills, fuel and travel records, and supplier information. Assign owners and targets; use a qualified professional for formal GHG inventory or regulatory reporting.', saving: 'Do not present EcoTrack estimates as audited emissions data.' });
    }
    actions.push({ title: 'Learn about offsets only after reducing emissions', detail: 'Carbon credits may support climate projects but do not replace direct reductions. If considering credits, check independent verification, registry records, project quality, retirement status and double-counting safeguards.', saving: 'One credit commonly represents 1 tonne CO₂e under a specific program; eligibility and quality vary.' });
    actions.forEach((action) => {
      const li = el('li', 'tip');
      li.appendChild(el('strong', null, action.title));
      li.appendChild(el('p', null, action.detail));
      li.appendChild(el('span', 'saving', action.saving));
      list.appendChild(li);
    });
  }

  async function refresh() {
    const today = localToday();
    const [dash, board, recent] = await Promise.all([
      api(`/api/dashboard?userId=${userId}&today=${today}`),
      api(`/api/leaderboard?today=${today}`),
      api(`/api/activities?userId=${userId}&limit=15`),
    ]);
    latestDashboard = dash;
    renderStats(dash);
    renderTrend(dash);
    renderCategories(dash);
    renderImpactDashboard(dash);
    renderTips(dash);
    renderBoard(board);
    renderRecent(recent);
    renderReportActions(dash);
    await Promise.all([loadCoach(), Promise.resolve(renderChallenges())]);
  }

  /* ---------------- pollution intelligence ---------------- */

  const pollutantLabels = [
    ['pm2_5', 'PM2.5'], ['pm10', 'PM10'], ['no2', 'NO₂'], ['o3', 'O₃'],
    ['co', 'CO'], ['so2', 'SO₂'], ['no', 'NO'], ['nh3', 'NH₃'],
  ];

  $('pollutionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('pollutionError').textContent = '';
    const result = $('pollutionResult');
    result.hidden = true;
    try {
      const data = await api(`/api/pollution?city=${encodeURIComponent($('cityInput').value.trim())}`);
      result.replaceChildren();
      const heading = el('div', 'pollution-heading');
      heading.appendChild(el('h3', null, `${data.location.name}${data.location.state ? ', ' + data.location.state : ''}, ${data.location.country}`));
      heading.appendChild(el('span', `aqi-badge aqi-${data.aqi}`, `AQI ${data.aqi}: ${data.aqiLabel}`));
      result.appendChild(heading);
      const meta = el('p', 'hint', `Provider reading${data.observedAt ? ' · observed ' + new Date(data.observedAt).toLocaleString() : ''}`);
      result.appendChild(meta);
      const grid = el('div', 'pollutant-grid');
      for (const [key, label] of pollutantLabels) {
        const card = el('div', 'pollutant');
        card.appendChild(el('span', null, label));
        card.appendChild(el('strong', null, data.components[key] == null ? '—' : `${Number(data.components[key]).toLocaleString(undefined, { maximumFractionDigits: 1 })} µg/m³`));
        grid.appendChild(card);
      }
      result.appendChild(grid);
      result.appendChild(el('h3', null, 'Suggested next steps'));
      const ul = el('ul', 'pollution-suggestions');
      data.suggestions.forEach((tip) => ul.appendChild(el('li', null, tip)));
      result.appendChild(ul);
      result.appendChild(el('p', 'hint', data.note));
      const mapTitle = el('h3', null, 'Area map');
      result.appendChild(mapTitle);
      const map = document.createElement('iframe');
      const lat = Number(data.location.lat), lon = Number(data.location.lon);
      const delta = 0.08;
      map.src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(`${lon-delta},${lat-delta},${lon+delta},${lat+delta}`)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
      map.title = `Map of ${data.location.name}`;
      map.loading = 'lazy';
      map.referrerPolicy = 'no-referrer-when-downgrade';
      map.className = 'pollution-map';
      result.appendChild(map);
      result.appendChild(el('p', 'hint', `Source: ${data.source}. Air quality is not the same as a personal carbon footprint.`));
      result.hidden = false;
    } catch (err) {
      $('pollutionError').textContent = err.message;
    }
  });

  $('pollutionForecastBtn').addEventListener('click', async () => {
    $('pollutionError').textContent = '';
    const city = $('cityInput').value.trim();
    if (city.length < 2) {
      $('pollutionError').textContent = 'Enter a city or area name first.';
      $('cityInput').focus();
      return;
    }
    const section = $('pollutionForecastResult');
    const button = $('pollutionForecastBtn');
    button.disabled = true;
    button.textContent = 'Loading forecast…';
    section.hidden = true;
    try {
      const data = await api(`/api/pollution/forecast?city=${encodeURIComponent(city)}`);
      const points = data.points.slice(0, 24);
      const labels = points.map((point) => point.timestamp
        ? new Date(point.timestamp).toLocaleString([], { weekday: 'short', hour: 'numeric' })
        : '—');
      $('forecastTitle').textContent = `${data.location.name}${data.location.state ? ', ' + data.location.state : ''} · air-pollution forecast`;
      $('forecastMeta').textContent = `Showing the next ${points.length} forecast intervals from ${data.points.length} available points. AQI uses OpenWeather's 1–5 scale.`;
      $('forecastNote').textContent = data.note;
      if (pollutionForecastChart) pollutionForecastChart.destroy();
      pollutionForecastChart = new Chart($('pollutionForecastChart'), {
        type: 'line',
        data: { labels, datasets: [
          { label: 'OpenWeather AQI (1–5)', data: points.map((point) => point.aqi), yAxisID: 'y', borderColor: '#2f7fd1', backgroundColor: 'rgba(47,127,209,.12)', fill: true, tension: 0.25, spanGaps: true },
          { label: 'PM2.5 (µg/m³)', data: points.map((point) => point.components.pm2_5), yAxisID: 'y1', borderColor: '#e0892b', backgroundColor: 'rgba(224,137,43,.08)', tension: 0.25, spanGaps: true },
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: {
          y: { type: 'linear', position: 'left', min: 1, max: 5, ticks: { stepSize: 1 }, title: { display: true, text: 'AQI (1–5)' } },
          y1: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'PM2.5 (µg/m³)' } },
          x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
        } }
      });
      section.hidden = false;
    } catch (err) {
      $('pollutionError').textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = 'View 5-day forecast';
    }
  });

  /* ---------------- personalized eco-coach ---------------- */

  async function loadCoach() {
    if (!userId) return;
    const list = $('coachIdeas');
    list.replaceChildren();
    try {
      const data = await api(`/api/eco-coach?userId=${userId}`);
      data.ideas.forEach((idea) => {
        const li = el('li', 'tip');
        li.appendChild(el('strong', null, idea.title));
        li.appendChild(el('p', null, idea.detail));
        li.appendChild(el('span', 'saving', `Estimated saving: ${idea.estimatedWeeklySavingKg} kg CO₂e/week · ${idea.difficulty}`));
        li.appendChild(el('p', 'hint', idea.costNote));
        list.appendChild(li);
      });
      if (!data.ideas.length) list.appendChild(el('li', 'empty', 'Log some activities to unlock more tailored ideas.'));
    } catch (err) {
      list.appendChild(el('li', 'empty', err.message));
    }
  }
  $('refreshCoach').addEventListener('click', loadCoach);

  /* ---------------- energy and cost simulator ---------------- */

  $('energyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const kwh = Number($('energyKwh').value);
    const percent = Number($('energyPercent').value);
    const rate = Number($('energyRate').value);
    if (![kwh, percent, rate].every(Number.isFinite) || kwh < 0 || percent <= 0 || percent > 90 || rate < 0) {
      $('energyResult').textContent = 'Please enter valid non-negative values and a reduction target up to 90%.';
      return;
    }
    const savedKwh = kwh * percent / 100;
    const savedKg = savedKwh * 0.82;
    const savedMoney = savedKwh * rate;
    $('energyResult').textContent = `Estimated monthly saving: ${savedKwh.toFixed(1)} kWh · ₹${savedMoney.toFixed(0)} · ${savedKg.toFixed(1)} kg CO₂e. Annualized: ₹${(savedMoney * 12).toFixed(0)} and ${(savedKg * 12).toFixed(1)} kg CO₂e, if the same reduction continues. Uses an illustrative 0.82 kg CO₂e/kWh factor; replace it with a current local factor for better accuracy.`;
  });

  /* ---------------- solar savings planner ---------------- */

  $('solarForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const bill = Number($('solarBill').value);
    const kw = Number($('solarKw').value);
    const costPerKw = Number($('solarCost').value);
    const offset = Number($('solarOffset').value);
    if (![bill, kw, costPerKw, offset].every(Number.isFinite) || bill < 0 || kw <= 0 || costPerKw <= 0 || offset <= 0 || offset > 100) {
      $('solarResult').textContent = 'Please enter valid values. Bill must be non-negative, system size and installed cost must be positive, and offset must be 1–100%.';
      return;
    }
    const monthlySavings = bill * offset / 100;
    const annualSavings = monthlySavings * 12;
    const systemCost = kw * costPerKw;
    const paybackYears = annualSavings > 0 ? systemCost / annualSavings : null;
    // Approximate only: assumes 1,400 kWh/kW/year generation and grid factor 0.82 kg CO2e/kWh.
    const annualGeneration = kw * 1400;
    const annualAvoidedKg = annualGeneration * 0.82;
    latestSolarEstimate = { monthlySavings, annualSavings, systemCost, paybackYears, annualAvoidedKg, kw, offset };
    $('solarResult').textContent = `Illustrative scenario: estimated bill savings ₹${Math.round(monthlySavings).toLocaleString('en-IN')}/month (₹${Math.round(annualSavings).toLocaleString('en-IN')}/year); assumed installed cost ₹${Math.round(systemCost).toLocaleString('en-IN')}; simple payback about ${paybackYears == null ? 'not available' : paybackYears.toFixed(1) + ' years'}; potential avoided grid emissions ≈ ${(annualAvoidedKg / 1000).toFixed(2)} tonnes CO₂e/year. These estimates can differ substantially from real output and savings; they exclude subsidies, financing, maintenance, degradation, export compensation, roof shading and local tariffs.`;
    if (solarChart) solarChart.destroy();
    solarChart = new Chart($('solarChart'), {
      type: 'bar',
      data: { labels: ['Before solar', 'After estimated offset'], datasets: [{ label: 'Monthly bill (₹)', data: [bill, bill - monthlySavings], backgroundColor: ['#9db9a6', '#278557'], borderRadius: 8 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `₹${Number(ctx.raw).toLocaleString('en-IN')}` } } }, scales: { x: { ticks: { color: cssVar('--muted') }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: cssVar('--muted'), callback: (v) => `₹${v}` }, grid: { color: cssVar('--line') } } } }
    });
    if (latestDashboard) renderReportActions(latestDashboard);
  });

  /* ---------------- weekly challenges ---------------- */

  const CHALLENGES = [
    { id: 'bottle', title: 'Carry a reusable bottle for five days', detail: 'Avoid disposable bottles where safe refill options exist.' },
    { id: 'transit', title: 'Choose a lower-carbon trip twice', detail: 'Walk, cycle, use transit or share a ride when practical.' },
    { id: 'standby', title: 'Switch off unused devices for a week', detail: 'Avoid wasting electricity when devices are not needed.' },
    { id: 'waste', title: 'Sort recyclable waste correctly', detail: 'Follow the collection rules in your area.' },
    { id: 'meal', title: 'Try two lower-impact meals', detail: 'Choose meals you enjoy with a lower estimated footprint.' },
  ];
  function challengeKey() { return `ecotrack.challenges.${userId}`; }
  function renderChallenges() {
    const container = $('challenges');
    if (!container || !userId) return;
    let done = {};
    try { done = JSON.parse(localStorage.getItem(challengeKey()) || '{}'); } catch { done = {}; }
    container.replaceChildren();
    CHALLENGES.forEach((challenge) => {
      const label = el('label', 'challenge');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = Boolean(done[challenge.id]);
      checkbox.addEventListener('change', () => {
        done[challenge.id] = checkbox.checked;
        localStorage.setItem(challengeKey(), JSON.stringify(done));
        updateChallengeSummary(done);
      });
      const textWrap = el('span', 'challenge-copy');
      textWrap.appendChild(el('strong', null, challenge.title));
      textWrap.appendChild(el('small', null, challenge.detail));
      label.append(checkbox, textWrap);
      container.appendChild(label);
    });
    updateChallengeSummary(done);
  }
  function updateChallengeSummary(done) {
    const count = CHALLENGES.filter((c) => done[c.id]).length;
    $('challengeSummary').textContent = `${count} of ${CHALLENGES.length} challenges completed · progress is saved in this browser for this profile.`;
  }

  /* ---------------- report exports ---------------- */

  $('exportCsv').addEventListener('click', async () => {
    try {
      const rows = await api(`/api/activities?userId=${userId}&limit=100`);
      const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['Date', 'Category', 'Activity', 'Quantity', 'Emission kg CO2e'], ...rows.map((a) => [a.date, a.category, itemOf(a.category, a.type)?.label || a.type, a.quantity, a.emission])];
      const blob = new Blob([lines.map((r) => r.map(escapeCsv).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'ecotrack-activity-report.csv'; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert(err.message); }
  });
  $('printReport').addEventListener('click', () => window.print());

  /* ---------------- boot ---------------- */

  async function init() {
    $('date').value = localToday();
    $('date').max = localToday();
    factors = await api('/api/factors');
    setupCategoryControls();

    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      try {
        await api(`/api/users/${saved}`);
        userId = saved;
        profileMode = localStorage.getItem('ecotrack.profileType') || 'individual';
        businessName = localStorage.getItem('ecotrack.businessName') || '';
        await showApp();
        return;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    showWelcome();
  }

  init().catch((err) => {
    document.querySelector('.container').textContent = `Could not start EcoTrack: ${err.message}`;
  });
})();
