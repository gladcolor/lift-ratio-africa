/* Interactive explorer: settings (model lift-ratio, larval concentration, survey size, target) drive
   1. synthetic surveys run in the browser (Theory.Bench): habitats needed in the ideal, model and random orders;
   2. a per-city prediction of field time fit on the 158,840 synthetic surveys (window.SURR):
        hours saved s = 1 - (1 - h) * r, h = habitats a priority route skips, r = 1 + a_city * B(L, p+, T);
   3. the map, the city panel and the results strip. The simulated surveys at lift-ratio 0.357 stay as a reference. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const CITIES = window.CITIES || [], SURR = window.SURR, Th = window.Theory;
  const BY_ID = new Map(CITIES.map(c => [c.id, c]));
  const PRESETS = { jigjiga: { pi: 0.2033, mu: 149.65, k: 0.8987, n: 743 }, semera: { pi: 0.6455, mu: 52.18, k: 0.3978, n: 484 },
                    logiya: { pi: 0.8534, mu: 44.06, k: 0.8811, n: 176 } };
  const REF = { j: 'Jigjiga survey', h: 'Jigjiga, strong hot spots', s: 'Semera survey', l: 'Logiya survey' };
  const PRESET_REF = { jigjiga: 'j', semera: 's', logiya: 'l' };
  const SIM_DIST = { j: 'jigjiga', h: 'jigjiga_hot', s: 'semera', l: 'logiya' };
  const S = { L: 0.35, pi: 0.2033, mu: 149.65, k: 0.8987, n: 743, T: 0.5, metric: 'saving', status: 'all', city: null, ref: 'j', stretch: false };
  const pct = v => (v * 100).toFixed(0) + '%';
  const pct1 = v => (v * 100).toFixed(1) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const fmtInt = v => Math.round(v).toLocaleString('en-US');
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const isDark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && darkQuery && darkQuery.matches);

  // ------------------------------------------------------------------ settings panel
  const SLIDERS = {
    L: { out: v => (+v).toFixed(2) },
    site: { out: v => (v * 100).toFixed(0) + '%' },
    k: { out: v => (+v).toFixed(2) },
    mu: { out: v => (+v).toFixed(0) },
    n: { out: v => String(Math.round(v)) },
    T: { out: v => Math.round(v * 100) + '%' },
  };
  function toControls() {
    $('L').value = S.L; $('site').value = 1 - S.pi; $('k').value = S.k; $('mu').value = S.mu; $('n').value = S.n; $('T').value = S.T;
    $('preset').value = presetName() || 'custom';
    $('metric').value = S.metric; $('status').value = S.status; $('stretch').checked = S.stretch;
    showOutputs();
  }
  function showOutputs() { for (const id in SLIDERS) $(id + 'Out').textContent = SLIDERS[id].out($(id).value); }
  function presetName() {
    for (const [name, p] of Object.entries(PRESETS)) if (Math.abs(p.pi - S.pi) < 1e-4 && Math.abs(p.mu - S.mu) < 1e-3 && Math.abs(p.k - S.k) < 1e-4 && p.n === S.n) return name;
    return null;
  }
  function fromControls() {
    S.L = +$('L').value; S.pi = Math.max(0, Math.min(0.95, 1 - +$('site').value)); S.k = +$('k').value; S.mu = +$('mu').value;
    S.n = Math.round(+$('n').value); S.T = +$('T').value;
  }
  $('preset').addEventListener('change', () => {
    const p = PRESETS[$('preset').value];
    if (p) { S.pi = p.pi; S.mu = p.mu; S.k = p.k; S.n = p.n; S.ref = PRESET_REF[$('preset').value]; toControls(); }
    queue();
  });
  for (const id in SLIDERS) $(id).addEventListener('input', () => { fromControls(); showOutputs(); if (id !== 'L' && id !== 'T') $('preset').value = presetName() || 'custom'; queue(); });
  $('metric').addEventListener('change', () => { S.metric = $('metric').value; paint(); writeHash(); });
  $('status').addEventListener('change', () => { S.status = $('status').value; paint(); writeHash(); });
  $('stretch').addEventListener('change', () => { S.stretch = $('stretch').checked; paint(); writeHash(); });

  // ------------------------------------------------------------------ computation
  let bench = null, benchN = 0, M = null, distKey = '', randCache = {}, R = null;
  const fidelity = (L, f357) => (L <= 0 ? f357 : 1 - (1 - f357) * Math.pow(Math.min(1, 0.357 / L), SURR.eta));
  function cT(T) {
    const c = SURR.B.c, t = Math.min(0.8, Math.max(0.3, T));
    return t <= 0.5 ? c['30'] + (c['50'] - c['30']) * (t - 0.3) / 0.2 : c['50'] + (c['80'] - c['50']) * (t - 0.5) / 0.3;
  }
  function compute() {
    const nRep = Math.max(40, Math.min(800, Math.round(120000 / S.n)));
    if (!bench || benchN !== S.n) { bench = new Th.Bench(S.n, nRep, 7); benchN = S.n; distKey = ''; }
    const key = [S.pi, S.mu, S.k].join('|');
    if (key !== distKey) { M = Th.model(S.pi, S.mu, S.k); bench.setModel(M); distKey = key; randCache = {}; }
    const T = S.T, L = S.L, grid = Array.from({ length: 41 }, (_, i) => i / 40);
    if (!randCache[T]) randCache[T] = { random: Th.meanOf(bench.need('random', 0, T).need), ideal: bench.need('ideal', 0, T, grid) };
    const o = { G: M.G, pPlus: M.pPlus, randomNeed: randCache[T].random, idealNeed: Th.meanOf(randCache[T].ideal.need), idealCurve: randCache[T].ideal.curve, grid };
    if (L > 0) {
      const rho = bench.rhoFor(L, M.rhoFor(L)), lf = bench.lift(rho), mod = bench.need('model', rho, T, grid);
      o.modelNeed = Th.meanOf(mod.need); o.modelCurve = mod.curve; o.liftSD = lf.sd;
      o.fbar = fidelity(L, SURR.f357); o.Lr = L * o.fbar;
      const rr = bench.rhoFor(o.Lr, M.rhoFor(o.Lr)), l1 = bench.lift(rr).mean;
      o.h0 = 1 - Th.meanOf(bench.need('model', rr, T).need) / o.randomNeed;
      const rr2 = Math.min(0.9999, rr + 0.03), l2 = bench.lift(rr2).mean;
      const h2 = 1 - Th.meanOf(bench.need('model', rr2, T).need) / o.randomNeed;
      o.slope = l2 > l1 ? (h2 - o.h0) / (l2 - l1) : 0;
    } else {
      o.modelNeed = o.randomNeed; o.modelCurve = Float64Array.from(grid); o.liftSD = bench.lift(0).sd; o.fbar = SURR.f357; o.Lr = 0; o.h0 = 0; o.slope = 0;
    }
    const B = L > 0 ? cT(T) * Math.pow(L, SURR.B.g) * Math.pow(Math.max(1e-6, o.pPlus), -SURR.B.d) : 0;
    o.city = new Map();
    for (const c of CITIES) {
      const p = SURR.cities[c.id];
      if (!p) continue;
      const [a, f357, u, v] = p, fc = fidelity(L, f357);
      const h = L > 0 ? Math.min(1, Math.max(0, o.h0 + o.slope * L * (fc - o.fbar))) : 0;
      const r = 1 + a * B, s = 1 - (1 - h) * r, daysNN = o.randomNeed * (u + v / Math.sqrt(S.n)) / 480;
      o.city.set(c.id, { saving: s, daysNN, daysRoute: daysNN * (1 - s), travel: r - 1, h, fc, a });
    }
    const all = [...o.city.values()];
    const sorted = k => all.map(x => x[k]).sort((x, y) => x - y);
    o.q = k => { const s = sorted(k); return [quant(s, 0.05), quant(s, 0.5), quant(s, 0.95)]; };
    R = o;
  }
  function quant(s, q) {
    if (!s.length) return NaN;
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  let queued = false;
  function queue() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; run(); }); } }
  function run() {
    compute();
    paint();
    strip();
    if (S.city && window.CITY_DETAIL[S.city]) renderCity(BY_ID.get(S.city), window.CITY_DETAIL[S.city]);
    writeHash();
  }

  // ------------------------------------------------------------------ map
  const map = L.map('map', { preferCanvas: true, minZoom: 2, zoomSnap: 0.5 });
  map.fitBounds([[-35, -18], [37.5, 52]], { animate: false });
  const ATTR = 'Base map &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community';
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 450;
  map.getPane('labels').style.pointerEvents = 'none';
  let base = null, labels = null;
  function setBase() {
    if (base) map.removeLayer(base);
    if (labels) map.removeLayer(labels);
    const tone = isDark() ? 'Dark' : 'Light';
    base = L.tileLayer(`${ESRI}World_${tone}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { attribution: ATTR, maxZoom: 16 }).addTo(map);
    labels = L.tileLayer(`${ESRI}World_${tone}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { pane: 'labels', maxZoom: 16 }).addTo(map);
  }
  setBase();
  const renderer = L.canvas({ padding: 0.5 });
  const cityLayer = L.layerGroup().addTo(map), outlineLayer = L.layerGroup().addTo(map);
  const markers = new Map();
  const radius = c => 3 + 4 * Math.max(0, Math.log(c.pop / 5e4) / Math.log(20));
  for (const c of [...CITIES].sort((a, b) => b.pop - a.pop)) {
    const mk = L.circleMarker([c.lat, c.lon], { renderer, radius: radius(c), weight: 1, fillOpacity: 0.92 });
    mk.on('click', () => selectCity(c.id));
    mk.bindTooltip(() => tipText(c), { className: 'city-tip', direction: 'top', offset: [0, -4] });
    markers.set(c.id, mk);
  }
  const METRICS = {
    saving: { name: 'Team hours saved, priority route against nearest neighbor', fmt: pct, tick: pct, dom: () => [0, 0.6] },
    daysRoute: { name: 'Team-days to the target, priority route', fmt: v => v.toFixed(1) + ' team-days', tick: v => v.toFixed(1), dom: () => [0, R.q('daysNN')[2] * 1.05] },
    daysNN: { name: 'Team-days to the target, nearest neighbor', fmt: v => v.toFixed(1) + ' team-days', tick: v => v.toFixed(1), dom: () => [0, R.q('daysNN')[2] * 1.05] },
    travel: { name: 'Extra driving per habitat on a priority route', fmt: v => '+' + pct(v), tick: pct, dom: () => [0, 0.4] },
  };
  const value = c => { const x = R && R.city.get(c.id); return x ? x[S.metric] : null; };
  function tipText(c) {
    const v = value(c), m = METRICS[S.metric];
    return `<b>${esc(c.name)}</b>, ${esc(c.country)}<br>${c.pop.toLocaleString('en-US')} people<br>${m.name}: <b>${v == null ? 'n/a' : m.fmt(v)}</b>`;
  }
  const visible = c => S.status === 'all' || (S.status === 'cases' ? /indigenous cases in 2024/.test(c.status || '') : /^malaria-free/.test(c.status || ''));
  function hexRgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
  function rampColor(t) {
    const stops = ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5'].map(n => hexRgb(css(n)));
    const x = Math.min(1, Math.max(0, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function paint() {
    if (!R) return;
    const shown = CITIES.filter(visible), m = METRICS[S.metric];
    const vals = shown.map(value).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
    let [lo, hi] = m.dom();
    if (S.stretch && vals.length) { lo = quant(vals, 0.02); hi = quant(vals, 0.98); }
    if (!(hi > lo)) hi = lo + 1e-6;
    const ring = css('--surface'), sel = css('--ink');
    cityLayer.clearLayers();
    for (const c of shown) {
      const v = value(c), mk = markers.get(c.id), on = c.id === S.city;
      mk.setStyle({ fillColor: v == null ? css('--muted') : rampColor((v - lo) / (hi - lo)), color: on ? sel : ring, weight: on ? 2.5 : 1 });
      cityLayer.addLayer(mk);
    }
    if (S.city && markers.has(S.city)) markers.get(S.city).bringToFront();
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => lo + t * (hi - lo));
    $('legend').innerHTML = `<div class="cap">${esc(m.name)}, predicted for the settings above${S.stretch ? '; colors stretched to the cities shown' : ''}.</div>` +
      `<div class="ramp grad" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(rampColor).join(',')})"></div>` +
      `<div class="ticks">${ticks.map(v => `<span>${m.tick(v)}</span>`).join('')}</div>`;
    $('mapCount').textContent = `${shown.length.toLocaleString('en-US')} cities shown. Median: ${vals.length ? m.fmt(quant(vals, 0.5)) : 'n/a'}; 5th to 95th percentile ${vals.length ? m.fmt(quant(vals, 0.05)) + ' to ' + m.fmt(quant(vals, 0.95)) : 'n/a'}. Dot size shows population.`;
  }

  // ------------------------------------------------------------------ results strip (one survey with these settings)
  function tile(v, k) { return `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`; }
  function strip() {
    const o = R, N = S.n, T = S.T;
    const sv = o.q('saving'), dn = o.q('daysNN'), dr = o.q('daysRoute');
    $('tTiles').innerHTML =
      tile(o.G.toFixed(2), `Gini coefficient of the counts: how concentrated the larvae are (${pct(o.pPlus)} of habitats hold larvae)`) +
      tile(`${fmtInt(o.modelNeed)}`, `habitats to reach ${pct(T)} of the larvae in the model's order, of ${fmtInt(N)} (ideal ${fmtInt(o.idealNeed)}, random ${fmtInt(o.randomNeed)})`) +
      tile(pct(o.h0), `of the visits a blind route needs are skipped by a priority route (route lift-ratio ${o.Lr.toFixed(2)})`) +
      tile(pct(sv[1]), `team hours saved, median city (5th to 95th percentile ${pct(sv[0])} to ${pct(sv[2])})`) +
      tile(`${dr[1].toFixed(1)} / ${dn[1].toFixed(1)}`, `team-days to the target, priority route / nearest neighbor (median city)`) +
      tile('± ' + o.liftSD.toFixed(3), `SD of the lift-ratio measured in one survey of ${fmtInt(N)} habitats`);
    const xs = Array.from(o.grid);
    Charts.coverage($('tChart'), {
      series: [{ name: 'Ideal order', color: 'var(--ideal)', xs, ys: Array.from(o.idealCurve) },
               { name: "Model's order", color: 'var(--blue)', xs, ys: Array.from(o.modelCurve) },
               { name: 'Random order', color: 'var(--random)', dash: '5 4', xs: [0, 1], ys: [0, 1] }],
      target: T, label: 'Share of larvae reached against share of habitats visited',
      marks: (() => {
        const below = T >= 0.35, x = v => v / N;
        return [{ x: x(o.idealNeed), series: 0, label: 'ideal ' + fmtInt(o.idealNeed), row: below ? 0 : -2.6 },
                { x: x(o.modelNeed), series: 1, label: 'model ' + fmtInt(o.modelNeed), row: below ? 1 : -1.6 },
                { x: x(o.randomNeed), series: 2, label: 'random ' + fmtInt(o.randomNeed), row: below ? 2 : -0.6 }];
      })() });
    const nPos = N * o.pPlus;
    $('tText').textContent = `Averaged over ${bench.R} synthetic surveys of ${fmtInt(N)} habitats made in this browser. ` +
      `A model with lift-ratio ${S.L.toFixed(2)} reaches ${pct(T)} of the larvae after ${fmtInt(o.modelNeed)} visits instead of ${fmtInt(o.randomNeed)} in random order. ` +
      `On the roads, a priority route keeps about ${pct(o.fbar)} of that lift-ratio and drives a little more per habitat, so the team hours saved (${pct(sv[1])} in the median city) are less than the visits skipped (${pct(o.h0)}). ` +
      (nPos < 60 ? `With only about ${Math.round(nPos)} habitats holding larvae, single surveys scatter widely around these averages.` : '');
  }

  // ------------------------------------------------------------------ city panel
  window.CITY_DETAIL = window.CITY_DETAIL || {};
  function loadDetail(id) {
    if (window.CITY_DETAIL[id]) return Promise.resolve(window.CITY_DETAIL[id]);
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = `data/city/${id}.js`;
      tag.onload = () => (window.CITY_DETAIL[id] ? resolve(window.CITY_DETAIL[id]) : reject(new Error('empty')));
      tag.onerror = () => reject(new Error('missing'));
      document.head.appendChild(tag);
    });
  }
  const mean = a => { const v = a.filter(x => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const sd = a => { const v = a.filter(x => x != null && isFinite(x)), m = mean(v); return v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : null; };
  const qt = (a, q) => { const v = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return v.length ? quant(v, q) : null; };
  const fmt = (v, f) => (v == null || !isFinite(v) ? 'n/a' : f(v));
  const PLACE_TYPES = { city: 'OpenStreetMap city', town: 'OpenStreetMap town', village10k: 'large OpenStreetMap village', geonames: 'GeoNames place',
    geonames500: 'GeoNames place', gnall15000: 'GeoNames place', gnall500: 'GeoNames place', gnm49b500: 'GeoNames place', gnucdb: 'GeoNames place in the urban centre',
    gnfocus: 'GeoNames place in the urban centre', gntile: 'tile of the urban centre', gntile2: 'tile of the urban centre' };

  async function selectCity(id) {
    const c = BY_ID.get(id);
    if (!c) return;
    S.city = id;
    const pane = $('cityPane');
    pane.hidden = false;
    pane.innerHTML = `<div class="city-head"><h3>${esc(c.name)}</h3><button class="btn" type="button" id="closeCity">Close</button></div><p class="note">Loading the results of this city…</p>`;
    $('closeCity').addEventListener('click', closeCity);
    paint();
    writeHash();
    let d;
    try { d = await loadDetail(id); } catch (err) { pane.querySelector('.note').textContent = 'The results of this city could not be loaded.'; return; }
    if (S.city !== id) return;
    const poly = drawOutline(d);
    map.fitBounds(poly.getBounds(), { padding: [30, 30], maxZoom: 13 });
    renderCity(c, d);
    if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) pane.scrollIntoView({ block: 'start' });
    else $('rail').scrollTop = pane.offsetTop - 8;
  }
  function drawOutline(d) {
    outlineLayer.clearLayers();
    const ink = css('--ink');
    const poly = L.polygon(d.outline, { color: ink, weight: 1.5, fillColor: css('--blue'), fillOpacity: 0.08, interactive: false }).addTo(outlineLayer);
    for (const p of d.places) {
      if (p.half_km == null) continue;
      const dl = p.half_km / 110.54, dn = p.half_km / (111.32 * Math.cos(p.lat * Math.PI / 180));
      L.rectangle([[p.lat - dl, p.lon - dn], [p.lat + dl, p.lon + dn]], { color: ink, weight: 1, dashArray: '4 3', fill: false, interactive: false }).addTo(outlineLayer);
    }
    return poly;
  }
  function closeCity() {
    S.city = null;
    outlineLayer.clearLayers();
    $('cityPane').hidden = true;
    $('cityPane').innerHTML = '';
    paint();
    writeHash();
  }
  function simLink(d) {
    const p = new URLSearchParams({ place: d.main, name: d.name + ', ' + d.country });
    const name = presetName();
    if (name) p.set('dist', name); else { p.set('pi', S.pi.toFixed(4)); p.set('mu', S.mu.toFixed(2)); p.set('k', S.k.toFixed(4)); p.set('n', String(S.n)); }
    p.set('skill', S.L.toFixed(2));
    p.set('back', hashString());
    return 'sim/index.html?' + p.toString();
  }
  function renderCity(c, d) {
    const pane = $('cityPane'), P = R.city.get(d.id), r = d.results[S.ref + '0.357'];
    const sv = R.q('saving'), tr = R.q('travel');
    const rank = (() => { const all = [...R.city.values()].map(x => x.saving); return all.filter(x => x < P.saving).length / all.length; })();
    let html = `<div class="city-head"><h3>${esc(d.name)}</h3><button class="btn" type="button" id="closeCity">Close</button></div>` +
      `<p class="facts">${esc(d.country)}; ${d.population.toLocaleString('en-US')} people (2025); ${d.area_km2 == null ? '' : Math.round(d.area_km2) + ' km²; '}malaria: ${esc(d.malaria_status || 'n/a')}.</p>` +
      `<h4 class="sub">With the settings above (predicted)</h4><dl class="kv">` +
      `<dt>Team hours saved, priority route against nearest neighbor</dt><dd>${fmt(P.saving, pct)}</dd>` +
      `<dt>Cities with a smaller saving</dt><dd>${pct(rank)}</dd>` +
      `<dt>Team-days to ${pct(S.T)} of the larvae: priority route, nearest neighbor</dt><dd>${P.daysRoute.toFixed(1)}, ${P.daysNN.toFixed(1)}</dd>` +
      `<dt>Extra driving per habitat on a priority route (median city ${pct(tr[1])})</dt><dd>+${pct(P.travel)}</dd>` +
      `<dt>Route fidelity here at lift-ratio 0.357 (simulated)</dt><dd>${P.fc ? fidelityText(d.id) : 'n/a'}</dd>` +
      `</dl><p style="margin:0 0 6px"><a class="btn primary" href="${esc(simLink(d))}">Simulate these settings on its roads</a></p>` +
      `<p class="note" style="margin:0 0 14px">The simulator makes new habitats on the roads of this city and plays the field days of each visit plan.</p>` +
      `<h4 class="sub">Simulated reference: model lift-ratio 0.357</h4>` +
      `<div class="field"><span>Count distribution of the simulated surveys</span><select id="refDesign">${Object.entries(REF).map(([k, v]) => `<option value="${k}"${k === S.ref ? ' selected' : ''}>${v}</option>`).join('')}</select></div>`;
    if (!r) {
      pane.innerHTML = html + '<p class="note">No surveys for this setting.</p>';
    } else {
      const saving = 1 - (mean(r.days_route) || 0) / (mean(r.days_nn) || 1);
      const detect = mean(r.p_50.map(p => (p == null ? null : p <= 0.05 ? 1 : 0)));
      html += `<p class="note" style="margin:0 0 4px">${r.surveys} synthetic surveys of ${r.N} habitats, target 50% of the larvae.</p><dl class="kv">` +
        `<dt>Team hours saved, priority route against nearest neighbor</dt><dd>${fmt(saving, pct)}</dd>` +
        `<dt>Measured lift-ratio, mean (SD)</dt><dd>${fmt(mean(r.lift), v => v.toFixed(3))} (${fmt(sd(r.lift), v => v.toFixed(3))})</dd>` +
        `<dt>Route lift-ratio, mean</dt><dd>${fmt(mean(r.route_lift), v => v.toFixed(3))}</dd>` +
        `<dt>Habitats visited for half the larvae: ideal, model, random</dt><dd>${fmt(qt(r.share_ideal_50, 0.5), pct)}, ${fmt(qt(r.share_score_50, 0.5), pct)}, ${fmt(qt(r.share_random_50, 0.5), pct)}</dd>` +
        `<dt>Random-order test detects the ranking</dt><dd>${fmt(detect, pct)}</dd>` +
        `<dt>False alarms at lift-ratio 0</dt><dd>${fmt(r.false_alarm_rate, pct1)}</dd>` +
        `</dl>` +
        `<div class="chart-title">Team-days to reach half the larvae</div><div class="chart-sub">Dot: median; bar: 10th to 90th percentile of the ${r.surveys} surveys.</div><div class="chart" id="cRanges"></div>` +
        `<div class="chart-title">Measured lift-ratio in each survey</div><div class="chart-sub">Dashed line: the model's true lift-ratio. The spread is what one field survey of this size would show.</div><div class="chart" id="cHist"></div>`;
      html += `<div class="chart-title">Survey areas (${d.places.length})</div><ul class="places">` +
        d.places.map(p => `<li><b>${esc(p.name || 'unnamed')}</b>, ${esc(PLACE_TYPES[p.type] || p.type)}: window ${p.half_km == null ? 'n/a' : (2 * p.half_km).toFixed(1) + ' km'} wide; ${fmt(p.road_km_per_km2, v => v.toFixed(1))} km of road per km²; ${fmt(p.minutes_between, v => v.toFixed(1))} min between habitats (median)${p.reused_road_points ? '; road points reused' : ''}${p.no_roads ? '; no roads, straight-line travel' : ''}</li>`).join('') +
        `</ul><p class="note">Dashed squares on the map are the survey areas; the outline is the urban centre. The simulator uses the roads in the central square, up to 5 km wide, of the first area${d.places.length > 1 ? ' (' + esc(d.places[0].name || '') + ')' : ''}.</p>`;
      pane.innerHTML = html;
      const row = (name, color, arr) => ({ name, color, lo: qt(arr, 0.1), mid: qt(arr, 0.5), hi: qt(arr, 0.9) });
      Charts.ranges($('cRanges'), { unit: 'team-days', label: 'Team-days to reach half the larvae by visit plan', rows: [
        row('Priority route', css('--blue'), r.days_route), row('Strict score order', css('--magenta'), r.days_strict), row('Nearest neighbor', css('--orange'), r.days_nn)] });
      Charts.histogram($('cHist'), { values: r.lift, ref: 0.357, refLabel: 'true 0.357', unit: 'measured lift-ratio', fmt: v => v.toFixed(2), label: 'Measured lift-ratio across surveys' });
    }
    $('closeCity').addEventListener('click', closeCity);
    const sel = $('refDesign');
    if (sel) sel.addEventListener('change', () => { S.ref = sel.value; renderCity(c, d); writeHash(); });
  }
  function fidelityText(id) { const p = SURR.cities[id]; return p ? p[1].toFixed(3) : 'n/a'; }

  // ------------------------------------------------------------------ search
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const INDEX = CITIES.map(c => ({ c, key: fold(c.name + ' ' + c.country) }));
  $('citySearch').addEventListener('input', () => {
    const q = fold($('citySearch').value.trim()), list = $('cityResults');
    list.innerHTML = '';
    if (q.length < 2) return;
    const hits = INDEX.filter(e => e.key.includes(q)).sort((a, b) => b.c.pop - a.c.pop).slice(0, 12);
    for (const { c } of hits) {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${c.name}, ${c.country} (${c.pop.toLocaleString('en-US')})`;
      b.addEventListener('click', () => { list.innerHTML = ''; $('citySearch').value = ''; selectCity(c.id); });
      li.appendChild(b); list.appendChild(li);
    }
    if (!hits.length) list.innerHTML = '<li class="note" style="padding:5px 8px">No city of 50,000 to 1 million people matches.</li>';
  });

  // ------------------------------------------------------------------ state in the address
  function hashString() {
    const h = new URLSearchParams();
    if (S.city) h.set('city', S.city);
    h.set('L', S.L.toFixed(2));
    const name = presetName();
    if (name) h.set('dist', name); else { h.set('pi', S.pi.toFixed(4)); h.set('mu', S.mu.toFixed(2)); h.set('k', S.k.toFixed(4)); h.set('n', S.n); }
    h.set('T', S.T.toFixed(2)); h.set('m', S.metric);
    if (S.status !== 'all') h.set('s', S.status);
    if (S.ref !== 'j') h.set('ref', S.ref);
    if (S.stretch) h.set('stretch', '1');
    return h.toString();
  }
  function writeHash() { history.replaceState(null, '', '#' + hashString()); }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1)), num = (k, lo, hi) => { const v = parseFloat(h.get(k)); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
    const p = PRESETS[h.get('dist')];
    if (p) { S.pi = p.pi; S.mu = p.mu; S.k = p.k; S.n = p.n; S.ref = PRESET_REF[h.get('dist')]; }
    const pi = num('pi', 0, 0.95), mu = num('mu', 10, 400), k = num('k', 0.2, 3), n = num('n', 50, 1500), Lv = num('L', 0, 0.6), T = num('T', 0.3, 0.8);
    if (pi != null) S.pi = pi; if (mu != null) S.mu = mu; if (k != null) S.k = k; if (n != null) S.n = Math.round(n); if (Lv != null) S.L = Lv; if (T != null) S.T = T;
    if (METRICS[h.get('m')]) S.metric = h.get('m');
    if (['cases', 'free'].includes(h.get('s'))) S.status = h.get('s');
    if (REF[h.get('ref')]) S.ref = h.get('ref');
    S.stretch = h.get('stretch') === '1';
    const id = +h.get('city');
    return BY_ID.has(id) ? id : null;
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => {
    setBase(); paint(); strip();
    if (S.city && window.CITY_DETAIL[S.city]) { drawOutline(window.CITY_DETAIL[S.city]); renderCity(BY_ID.get(S.city), window.CITY_DETAIL[S.city]); }
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { strip(); if (S.city && window.CITY_DETAIL[S.city]) renderCity(BY_ID.get(S.city), window.CITY_DETAIL[S.city]); }, 200); });

  const start = readHash();
  toControls();
  run();
  if (start) {
    selectCity(start);
    document.getElementById('explore').scrollIntoView();
  }
})();
