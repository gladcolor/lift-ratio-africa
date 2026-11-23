/* Precision LSM explorer: the page. All calculations are in core.js. */
(function () {
  'use strict';
  const F = window.FRRT, $ = id => document.getElementById(id);

  const CITIES = F.CITIES, boxAround = F.boxAround;
  const MAX_AREA_KM2 = 80, MAX_HABITATS = 3000, DETOUR = 1.3;
  // One fixed color and line pattern per strategy, so a strategy looks the same everywhere.
  const STRATEGIES = [
    { key: 'priority', group: 'Use the map and the scores', name: 'Priority per minute', color: '#2a78d6', dash: '', on: true, hint: 'highest score per minute of driving and service' },
    { key: 'cluster', group: 'Use the map and the scores', name: 'Team zones + priority per minute', color: '#6250d6', dash: '8 3', on: true, hint: 'each team keeps to its own part of the area, and picks by score per minute there' },
    { key: 'nearby', group: 'Use the map and the scores', name: 'Nearby priority', color: '#1baf7a', dash: '6 5', on: false, hint: 'the best score per minute among the closest habitats' },
    { key: 'rank', group: 'Use the map and the scores', name: 'Highest score first', color: '#e87ba4', dash: '10 4 2 4', on: false, hint: 'strict score order; ignores travel' },
    { key: 'nearest', group: 'Use the map only', name: 'Nearest neighbor', color: '#eb6834', dash: '', on: true, hint: 'the closest habitat next; ignores the scores' },
    { key: 'zigzag', group: 'Use the map only', name: 'Zigzag sweep', color: '#eda100', dash: '2 4', on: true, hint: 'sweeps the area band by band; ignores the scores' },
    { key: 'street', group: 'No map', name: 'Street search', color: '#008300', dash: '3 3', on: true, hint: 'drives every street and treats the habitats it passes; needs road data' },
  ];
  const TEAM_COLORS = ['#eb6834', '#1baf7a', '#6250d6', '#eda100', '#e87ba4', '#008300'];
  const SCORE_RAMP = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
  const GRAY = '#898781';

  const S = { box: null, roadCache: {}, graph: null, P: null, H: null, basis: null, start: null, pts: null, D: null, M: 0,
              sims: {}, measure: 'score', mapStrategy: 'priority', source: null, busy: false, note: '', upload: null, noStored: {} };

  // ------------------------------------------------------------ small helpers
  const pct = (v, d) => (100 * v).toFixed(d === undefined ? 1 : d) + '%';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const days = n => n + (n === 1 ? ' day' : ' days');
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function setStatus(text, o) {
    o = o || {};
    $('statusText').textContent = text;
    $('status').classList.toggle('warn', !!o.warn);
    const bar = $('progress');
    bar.hidden = o.progress === undefined;
    if (o.progress !== undefined) bar.value = o.progress;
  }
  // The campaign plays by itself after a build, unless the link says play=0. The playback is the content of this
  // page, not decoration, so it does not wait for the system's motion setting (Windows reports "reduce motion"
  // whenever its animation effects are off). Pause is on the map and in the bar under it.
  const AUTOPLAY = new URLSearchParams(location.search).get('play') !== '0';
  const params = () => ({ teams: +$('teams').value, speedKmh: +$('speed').value, serviceMin: +$('service').value, hours: +$('hours').value,
                          k: +$('kNear').value, band: +$('band').value, target: +$('target').value / 100 });
  const hasObserved = () => !!(S.H && S.H.observed);
  const measure = () => (S.measure === 'observed' && hasObserved() ? 'observed' : 'score');
  const valuesOf = m => (m === 'observed' ? S.H.observed : S.H.score);
  const larvaeWord = () => (S.H && S.H.synthetic ? 'synthetic larvae' : 'observed larvae');

  // ------------------------------------------------------------ map
  if (!window.L) { setStatus('The map library could not be loaded. Check the internet connection and reload the page.', { warn: true }); return; }
  const map = L.map('map', { preferCanvas: true }).setView([CITIES[0].lat, CITIES[0].lon], 13);
  // Background maps, as in the project's routing simulator: CARTO styles (with that page's CARTO key) and
  // Esri satellite imagery. The Humanitarian style needs no key and is kept as a spare.
  const CARTO_KEY = 'cb1_3hz0_1_6edd0f4ed3a54f45ad217495';
  const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const carto = style => L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, { subdomains: 'abcd', maxZoom: 20,
    attribution: OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>' });
  const baseMaps = {
    Streets: carto('rastertiles/voyager'),
    Dark: carto('dark_all'),
    Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri and its data providers' }),
    Humanitarian: L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, attribution: OSM + '. Tiles: Humanitarian OpenStreetMap Team, hosted by OpenStreetMap France' }),
  };
  (baseMaps[new URLSearchParams(location.search).get('map')] || baseMaps.Streets).addTo(map);
  L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
  const boxLayer = L.layerGroup().addTo(map), routeLayer = L.layerGroup().addTo(map), habitatLayer = L.layerGroup().addTo(map), startLayer = L.layerGroup().addTo(map);
  const startIcon = L.divIcon({ className: 'start-pin', iconSize: [22, 22], iconAnchor: [11, 11],
    html: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 1.8l3.1 6.6 7.1.9-5.2 5 1.3 7.1L12 17.9 5.7 21.4 7 14.3l-5.2-5 7.1-.9z" fill="#12202a" stroke="#fff" stroke-width="1.5"/></svg>' });
  const key = L.control({ position: 'bottomleft' });
  key.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-key');
    div.innerHTML = 'Predicted score: low' + SCORE_RAMP.map(c => `<i style="background:${c}"></i>`).join('') + ' high<br>Filled: visited so far, outlined in its team\'s color. Hollow: not yet.<br>★ start. Numbered markers and lines: the teams on the day shown.';
    return div;
  };
  key.addTo(map);

  function boxArea(b) {
    return (b.n - b.s) * 111.2 * (b.e - b.w) * 111.2 * Math.cos((b.s + b.n) / 2 * Math.PI / 180);
  }
  // city: the key of an example city when the box is that city's own box, so stored roads can be used
  function setBox(b, fit, city) {
    S.box = b;
    S.boxCity = city || null;
    boxLayer.clearLayers();
    L.rectangle([[b.s, b.w], [b.n, b.e]], { color: '#12202a', weight: 1.5, dashArray: '5 4', fill: false, interactive: false }).addTo(boxLayer);
    if (fit) map.fitBounds([[b.s, b.w], [b.n, b.e]], { padding: [20, 20] });
  }

  // ------------------------------------------------------------ roads (OpenStreetMap, through the Overpass API)
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
                    'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const inside = (inner, outer) => inner.s >= outer.s - 1e-9 && inner.n <= outer.n + 1e-9 && inner.w >= outer.w - 1e-9 && inner.e <= outer.e + 1e-9;

  // 1. Roads stored with the app: roads/<city>.js, written by tools/fetch_city_roads.js. They are loaded as a
  //    script, which also works when the page is opened as a file.
  function storedRoads(b) {
    const own = S.placeKey && (window.FRRT_ROADS || {})[S.placeKey];
    if (own && inside(b, own.box)) return Promise.resolve(own);
    const city = CITIES.find(c => inside(b, boxAround(c.lat, c.lon)));
    if (!city) return Promise.resolve(null);
    const have = () => (window.FRRT_ROADS || {})[city.key] || null;
    if (have() || S.noStored[city.key]) return Promise.resolve(have());
    return new Promise(resolve => {
      const tag = document.createElement('script');
      tag.src = `roads/${city.key}.js`;
      tag.onload = () => resolve(have());
      tag.onerror = () => { S.noStored[city.key] = true; resolve(null); };
      document.head.appendChild(tag);
    });
  }
  // 2. Roads kept in this browser after an earlier successful fetch (the three most recent areas).
  const KEPT = 'frrt-roads-kept';
  function keptRoads(b) {
    try {
      for (const item of JSON.parse(localStorage.getItem(KEPT) || '[]')) if (inside(b, item.box)) return item;
    } catch (err) { /* storage is not available: carry on without it */ }
    return null;
  }
  function keepRoads(b, ways) {
    try {
      const list = JSON.parse(localStorage.getItem(KEPT) || '[]').filter(item => !inside(item.box, b));
      list.unshift({ box: b, ways: F.packRoads(ways) });
      localStorage.setItem(KEPT, JSON.stringify(list.slice(0, 3)));
    } catch (err) { try { localStorage.removeItem(KEPT); } catch (e) { /* ignore */ } }
  }
  // 3. The public road servers, one after another.
  async function fetchRoads(b) {
    const where = [b.s, b.w, b.n, b.e].map(v => v.toFixed(5)).join(','), center = { lat: (b.s + b.n) / 2, lon: (b.w + b.e) / 2 };
    if (S.roadCache.where === where) return S.roadCache.graph;
    const use = (ways, source) => {
      const graph = F.buildGraph(ways, center);
      if (!graph || graph.n < 2) return null;
      S.roadCache = { where, graph, source };
      return graph;
    };
    const stored = await storedRoads(b);
    if (stored) { const graph = use(F.unpackRoads(stored), 'stored with this page'); if (graph) return graph; }
    const kept = keptRoads(b);
    if (kept) { const graph = use(F.unpackRoads(kept), 'kept in this browser from an earlier visit'); if (graph) return graph; }
    const query = `[out:json][timeout:60];way["highway"](${where});out geom qt;`;
    let problem = new Error('no answer');
    for (let i = 0; i < OVERPASS.length; i++) {
      setStatus(`Loading roads from OpenStreetMap (road server ${i + 1} of ${OVERPASS.length}). The public servers can take up to a minute…`, { progress: 0 });
      const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 45000);
      try {
        const res = await fetch(OVERPASS[i], { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: stop.signal });
        if (!res.ok) throw new Error('the road server answered ' + res.status);
        const ways = (await res.json()).elements.filter(e => e.type === 'way');
        const graph = use(ways, 'just loaded');
        if (!graph) { problem = new Error('OpenStreetMap has no roads in this area'); break; }
        keepRoads(b, ways);
        return graph;
      } catch (err) {
        problem = err.name === 'AbortError' ? new Error('the road servers took too long') : err.name === 'TypeError' ? new Error('the road servers could not be reached') : err;
      } finally { clearTimeout(timer); }
    }
    throw problem;
  }

  // ------------------------------------------------------------ building a dataset
  function point(x, y) {
    if (!S.graph) return { x, y, node: -1, access: 0 };
    const s = F.snap(S.graph, x, y);
    return { x, y, node: s.node, access: s.dist };
  }
  async function buildMatrix() {
    const H = S.H, P = S.P, pts = [];
    for (let i = 0; i < H.n; i++) pts.push(point(H.x[i], H.y[i]));
    pts.push(point(P.x(S.start.lon), P.y(S.start.lat)));
    S.pts = pts; S.M = pts.length;
    S.legCache = new Map();
    if (S.graph) {
      setStatus('Measuring road distances between habitats…', { progress: 0 });
      S.D = await F.roadMatrix(S.graph, pts, p => setStatus('Measuring road distances between habitats…', { progress: p }));
      S.dijkstra = F.makeDijkstra(S.graph);
    } else S.D = F.straightMatrix(pts, DETOUR);
  }
  // The no-map baseline: one drive along every street of the area that holds the habitats.
  function planStreetSearch() {
    S.walk = null;
    if (!S.graph) return;
    const H = S.H, pad = 150, x0 = Math.min(...H.x) - pad, x1 = Math.max(...H.x) + pad, y0 = Math.min(...H.y) - pad, y1 = Math.max(...H.y) + pad;
    S.walk = F.streetWalk(S.graph, S.pts[S.M - 1].node, (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1, S.pts.slice(0, H.n).map(p => p.node));
  }
  function demoData(box) {
    const P = S.P, rand = F.makeRandom(+$('seed').value || 1);
    const made = F.synthesize({ rand, n: +$('nHabitats').value, graph: S.graph, zeroShare: +$('zeroShare').value, mean: +$('meanCount').value,
                                k: +$('kShape').value, clustering: +$('clustering').value,
                                box: { x0: P.x(box.w), x1: P.x(box.e), y0: P.y(box.s), y1: P.y(box.n) } });
    const n = made.x.length;
    S.basis = F.skillBasis(made.count, rand);
    return { n, synthetic: true, id: made.x.map((_, i) => 'D' + String(i + 1).padStart(4, '0')), x: made.x, y: made.y,
             lat: made.y.map(P.lat), lon: made.x.map(P.lon), observed: made.count, score: F.scoresForSkill(made.count, S.basis, +$('skill').value).score };
  }
  function uploadData(rows, observed) {
    const P = S.P;
    return { n: rows.length, synthetic: false, id: rows.map(r => r.id), lat: rows.map(r => r.lat), lon: rows.map(r => r.lon),
             x: rows.map(r => P.x(r.lon)), y: rows.map(r => P.y(r.lat)), score: rows.map(r => r.score), observed: observed ? rows.map(r => r.observed) : null };
  }
  async function build(source) {
    if (S.busy) return;
    if (source === 'demo' && !S.box) return;
    S.busy = true;
    $('demoGo').disabled = true; $('file').disabled = true;
    try {
      let box = S.box;
      if (source === 'upload') {
        const rows = S.upload.rows, lat = rows.map(r => r.lat), lon = rows.map(r => r.lon), pad = 0.004;
        box = { s: Math.min(...lat) - pad, n: Math.max(...lat) + pad, w: Math.min(...lon) - pad, e: Math.max(...lon) + pad };
        setBox(box, true);
      }
      let graph = null, why = '';
      if ($('distanceModel').value === 'roads') {
        const area = boxArea(box);
        if (area > MAX_AREA_KM2) why = `The area covers ${area.toFixed(0)} km², more than the ${MAX_AREA_KM2} km² this tool can route on roads.`;
        else {
          stopPlay();
          setStatus('Loading roads…', { progress: 0 });
          try { graph = await fetchRoads(box); } catch (err) { why = `Roads could not be loaded: ${err.message}. Build again to retry.`; }
        }
      }
      S.graph = graph;
      S.P = graph ? graph.P : F.projector((box.s + box.n) / 2, (box.w + box.e) / 2);
      S.H = source === 'demo' ? demoData(box) : uploadData(S.upload.rows, S.upload.hasObserved);
      S.source = source;
      const H = S.H, mean = a => a.reduce((s, v) => s + v, 0) / a.length;
      S.start = { lat: mean(H.lat), lon: mean(H.lon) };
      await buildMatrix();
      planStreetSearch();
      S.dayFresh = true;
      S.note = why ? why + ` Distances are straight lines × ${DETOUR} instead.` : '';
      if (!hasObserved()) S.measure = 'score';
      simulateAll();
      renderAll();
      showPlaying(false);
      if (AUTOPLAY) startPlay(true);   // show the campaign at once
    } catch (err) {
      console.error(err);
      setStatus('That did not work: ' + err.message, { warn: true });
    } finally {
      S.busy = false;
      if (S.rebuild) { S.rebuild = false; setTimeout(() => build('demo'), 0); }
      $('demoGo').disabled = false; $('file').disabled = false;
    }
  }
  function moveStart(latlng) {
    if (!S.H) return;
    S.start = { lat: latlng.lat, lon: latlng.lng };
    const i = S.M - 1, M = S.M;
    S.pts[i] = point(S.P.x(S.start.lon), S.P.y(S.start.lat));
    S.legCache = new Map();
    if (S.graph) F.updatePoint(S.graph, S.D, S.pts, i);
    else for (let j = 0; j < M; j++) {
      const d = j === i ? 0 : DETOUR * Math.hypot(S.pts[i].x - S.pts[j].x, S.pts[i].y - S.pts[j].y);
      S.D[i * M + j] = d; S.D[j * M + i] = d;
    }
    planStreetSearch();
    simulateAll();
    renderAll();
  }

  // ------------------------------------------------------------ simulation
  function simulateAll() {
    const H = S.H;
    if (!H) return;
    const p = params(), daySeconds = p.hours * 3600, daily = $('dailyReturn').checked;
    S.sims = {};
    for (const st of STRATEGIES) {
      if (!st.on) continue;
      const o = { D: S.D, M: S.M, score: H.score, teams: p.teams, speedKmh: p.speedKmh, serviceMin: p.serviceMin, k: p.k, rule: st.key, hoursPerDay: p.hours, daily };
      if (st.key === 'cluster') { o.rule = 'priority'; o.zone = F.teamZones(H.x, H.y, p.teams); }
      if (st.key === 'zigzag') { o.rule = 'sequence'; o.sequence = F.zigzagOrder(H.x, H.y, p.band); }
      if (st.key === 'rank') { o.rule = 'sequence'; o.sequence = F.rankOrder(H.score); }
      if (st.key === 'street' && !S.walk) continue;
      const sim = st.key === 'street' ? F.simulateStreetSearch({ g: S.graph, pts: S.pts, walk: S.walk, teams: p.teams, speedKmh: p.speedKmh, serviceMin: p.serviceMin, hoursPerDay: p.hours, daily }) : F.simulate(o), out = { sim, by: {} };
      for (const m of hasObserved() ? ['score', 'observed'] : ['score']) {
        const values = valuesOf(m), visit = F.coverageCurve(sim.order, values), byDay = F.coverageByDay(sim, values, daySeconds);
        out.by[m] = { visit, byDay, lift: F.liftOfCurve(visit, values), days: F.daysToTarget(byDay, p.target), after10: byDay[Math.min(10, byDay.length - 1)] };
        out.totalDays = byDay.length - 1;
      }
      S.sims[st.key] = out;
    }
    if (!S.sims[S.mapStrategy]) S.mapStrategy = Object.keys(S.sims)[0] || 'priority';
  }

  // ------------------------------------------------------------ charts (plain SVG)
  // c: {xMax, xTitle, yTitle, xTicks, series: [{name, color, dash, width, ys (percent), dx}], fill, hline, vline, dots, fmtX}
  function drawChart(host, c) {
    const W = Math.max(260, Math.round(host.clientWidth || 320)), Ht = c.height || Math.round(Math.min(310, Math.max(200, W * 0.6)));
    const m = { l: 42, r: 14, t: 10, b: 38 }, iw = W - m.l - m.r, ih = Ht - m.t - m.b;
    const X = v => m.l + v / c.xMax * iw, Y = v => m.t + ih - v / 100 * ih;
    const line = s => {
      const n = s.ys.length, stride = Math.max(1, Math.floor(n / 500));
      let d = '';
      for (let i = 0; i < n; i += stride) d += (d ? 'L' : 'M') + X(i * s.dx).toFixed(1) + ' ' + Y(s.ys[i]).toFixed(1);
      if ((n - 1) % stride) d += 'L' + X((n - 1) * s.dx).toFixed(1) + ' ' + Y(s.ys[n - 1]).toFixed(1);
      return d;
    };
    let g = `<svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${esc(c.label)}">`;
    for (const y of [0, 25, 50, 75, 100]) {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="${y ? '#e4e8eb' : '#c3ccd2'}" stroke-width="1"/><text x="${m.l - 7}" y="${Y(y) + 4}" text-anchor="end">${y}</text>`;
    }
    for (const x of c.xTicks) g += `<text x="${X(x)}" y="${Ht - m.b + 16}" text-anchor="middle">${x}</text>`;
    g += `<text class="axis-title" x="${m.l + iw / 2}" y="${Ht - 4}" text-anchor="middle">${esc(c.xTitle)}</text>`;
    g += `<text class="axis-title" transform="translate(11 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">${esc(c.yTitle)}</text>`;
    if (c.fill) g += `<path d="${line(c.fill)}L${X(c.xMax)} ${Y(100)}L${X(0)} ${Y(0)}Z" fill="${c.fill.color}" opacity=".13"/>`;
    if (c.hline !== undefined) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(c.hline)}" y2="${Y(c.hline)}" stroke="#77858e" stroke-width="1" stroke-dasharray="3 3"/><text x="${W - m.r}" y="${Y(c.hline) - 5}" text-anchor="end">target ${c.hline}%</text>`;
    if (c.vline !== undefined) g += `<line x1="${X(c.vline)}" x2="${X(c.vline)}" y1="${m.t}" y2="${m.t + ih}" stroke="#77858e" stroke-width="1" stroke-dasharray="3 3"/>`;
    for (const s of c.series) g += `<path d="${line(s)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-opacity="${s.opacity || 1}" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : 'stroke-linecap="round"'}/>`;
    for (const d of c.dots || []) g += `<circle cx="${X(d.x)}" cy="${Y(d.y)}" r="4.5" fill="${d.color}" stroke="#fff" stroke-width="2"/>`;
    g += `<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="#12202a" stroke-width="1" visibility="hidden"/>`;
    g += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg><div class="tip"></div>`;
    host.innerHTML = g;
    const svg = host.querySelector('svg'), cross = host.querySelector('.cross'), tip = host.querySelector('.tip');
    const move = ev => {
      const box = svg.getBoundingClientRect(), scale = W / box.width;
      const xv = Math.min(c.xMax, Math.max(0, ((ev.clientX - box.left) * scale - m.l) / iw * c.xMax));
      const rows = c.series.filter(s => !s.quiet).map(s => {
        const i = Math.min(s.ys.length - 1, Math.max(0, Math.round(xv / s.dx)));
        return `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${s.ys[i].toFixed(1)}%</b></div>`;
      });
      tip.innerHTML = `<div>${esc(c.fmtX(xv))}</div>` + rows.join('');
      tip.style.display = 'block';
      cross.setAttribute('x1', X(xv)); cross.setAttribute('x2', X(xv)); cross.setAttribute('visibility', 'visible');
      const px = X(xv) / scale, right = px > box.width * 0.55;
      tip.style.left = right ? '' : px + 12 + 'px';
      tip.style.right = right ? box.width - px + 12 + 'px' : '';
      tip.style.top = '8px';
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
  }
  function legend(host, items) {
    host.innerHTML = items.map(s => `<span><svg width="24" height="8" aria-hidden="true"><line x1="1" x2="23" y1="4" y2="4" stroke="${s.color}" stroke-width="${s.width || 2.5}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/></svg>${esc(s.name)}</span>`).join('');
  }
  const toPct = curve => Array.from(curve, v => 100 * v);
  const diagonal = xMax => ({ name: 'Random order', color: GRAY, dash: '4 4', width: 1.5, ys: [0, 100], dx: xMax, quiet: true });

  // ------------------------------------------------------------ step 2: rank
  function renderRank() {
    const H = S.H;
    if (!H) return;
    const n = H.n, dx = 100 / n, budget = +$('budget').value, at = Math.round(budget / 100 * n), scored = hasObserved();
    const truth = scored ? H.observed : H.score, ideal = F.idealCurve(truth);
    const series = [diagonal(100)];
    let text;
    if (scored) {
      const curve = F.rankingCurve(H.score, H.observed), lift = F.liftOfCurve(curve, H.observed);
      series.unshift({ name: 'Ideal order', color: GRAY, width: 1.5, ys: toPct(ideal), dx });
      series.push({ name: 'Ranking by score', color: '#2a78d6', width: 2.5, ys: toPct(curve), dx });
      $('liftNum').textContent = isFinite(lift) ? lift.toFixed(3) : '–';
      $('liftBar').style.width = (isFinite(lift) ? Math.max(0, Math.min(1, lift)) * 100 : 0) + '%';
      $('liftCap').textContent = 'lift-ratio of the ranking, against ' + larvaeWord();
      text = `Visiting the top ${budget}% of habitats by score reaches ${pct(curve[at])} of the ${larvaeWord()}. Random order would reach about ${budget}%, and a perfect ranking ${pct(ideal[at])}.`;
      if (isFinite(lift)) text += ` The ranking captures ${pct(lift, 0)} of the possible gain over random order.`;
    } else {
      series.push({ name: 'Habitats in score order', color: '#2a78d6', width: 2.5, ys: toPct(ideal), dx });
      $('liftNum').textContent = '–';
      $('liftBar').style.width = '0';
      $('liftCap').textContent = 'needs field counts to measure the ranking';
      text = `The top ${budget}% of habitats hold ${pct(ideal[at])} of the total score. To measure how good the ranking is, add an observed column with field counts to your file.`;
    }
    const shown = series[series.length - 1];
    legend($('rankLegend'), series.filter(s => !s.quiet).concat([{ name: 'Random order', color: GRAY, dash: '4 4', width: 1.5 }]));
    drawChart($('rankChart'), { label: 'Coverage as habitats are taken in score order', xMax: 100, xTicks: [0, 25, 50, 75, 100], height: 230,
      xTitle: 'Habitats selected (%)', yTitle: scored ? 'Larvae reached (%)' : 'Score reached (%)', series, fill: scored ? shown : null, vline: budget,
      dots: [{ x: budget, y: shown.ys[at], color: '#2a78d6' }], fmtX: v => `Top ${v.toFixed(0)}% of habitats` });
    $('rankText').textContent = text;
    $('skillRow').hidden = !H.synthetic;
  }

  // ------------------------------------------------------------ step 3 and 4: routes, results
  function renderRoutes() {
    const H = S.H;
    if (!H) return;
    const m = measure(), values = valuesOf(m), p = params(), n = H.n, dx = 100 / n, on = STRATEGIES.filter(st => S.sims[st.key]);
    const slider = $('day'), total = S.sims[S.mapStrategy] ? S.sims[S.mapStrategy].totalDays : 1, daySec = p.hours * 3600;
    slider.max = total;
    // a new dataset opens at the end of the day on which the chosen strategy reaches the target
    if (S.dayFresh) { S.t = ((S.sims[S.mapStrategy] && S.sims[S.mapStrategy].by[m].days) || 1) * daySec; S.dayFresh = false; }
    S.t = Math.min(S.t || 0, total * daySec);
    slider.value = Math.max(0, Math.ceil(S.t / daySec - 1e-9));
    const what = m === 'observed' ? larvaeWord() : 'predicted score', yTitle = (m === 'observed' ? 'Larvae' : 'Score') + ' reached (%)';
    const visit = [{ name: 'Ideal order', color: GRAY, width: 1.5, ys: toPct(F.idealCurve(values)), dx }, diagonal(100)];
    const byDay = [], dots = [];
    let maxDays = 1;
    // the chosen strategy is drawn last, so that it lies on top where lines coincide
    for (const st of on.filter(s => s.key !== S.mapStrategy).concat(on.filter(s => s.key === S.mapStrategy))) {
      const r = S.sims[st.key].by[m];
      const look = st.key === S.mapStrategy ? { width: 3.2 } : { width: 1.6, opacity: 0.7 };
      visit.push({ name: st.name, color: st.color, dash: st.dash, ys: toPct(r.visit), dx, ...look });
      byDay.push({ name: st.name, color: st.color, dash: st.dash, ys: toPct(r.byDay), dx: 1, ...look });
      if (r.days !== null) dots.push({ x: r.days, y: 100 * r.byDay[r.days], color: st.color });
      maxDays = Math.max(maxDays, r.byDay.length - 1);
    }
    const step = [1, 2, 5, 10, 20, 50, 100, 200].find(s => maxDays / s <= 8) || 500, ticks = [];
    for (let d = 0; d <= maxDays; d += step) ticks.push(d);
    const items = on.map(st => ({ name: st.name, color: st.color, dash: st.dash }));
    legend($('visitLegend'), [{ name: 'Ideal order', color: GRAY, width: 1.5 }].concat(items, [{ name: 'Random order', color: GRAY, dash: '4 4', width: 1.5 }]));
    legend($('dayLegend'), items);
    drawChart($('visitChart'), { label: 'Coverage by habitats visited', xMax: 100, xTicks: [0, 25, 50, 75, 100], xTitle: 'Habitats visited (%)', yTitle, series: visit, fmtX: v => `${v.toFixed(0)}% of habitats visited` });
    drawChart($('dayChart'), { label: 'Coverage by working day', xMax: maxDays, xTicks: ticks, xTitle: `Working day (${p.teams} ${p.teams === 1 ? 'team' : 'teams'})`, yTitle, series: byDay,
      hline: Math.round(p.target * 100), vline: S.t / daySec, dots, fmtX: v => `End of day ${Math.round(v)}` });
    $('dayCaption').textContent = 'The bold line is the strategy shown on the map. Dots mark the first day at or above the target; the vertical line is the day shown.';

    $('thTarget').textContent = `Days to ${Math.round(p.target * 100)}%`;
    $('resultTable').querySelector('tbody').innerHTML = on.map(st => {
      const out = S.sims[st.key], r = out.by[m];
      return `<tr data-key="${st.key}" aria-selected="${st.key === S.mapStrategy}"><td><span class="swatch" style="border-color:${st.color}"></span>${esc(st.name)}</td>` +
        `<td>${isFinite(r.lift) ? r.lift.toFixed(3) : '–'}</td><td>${r.days === null ? 'not reached' : r.days}</td><td>${pct(r.after10)}</td><td>${out.totalDays}</td><td>${Math.round(out.sim.driveKm).toLocaleString('en-US')}</td></tr>`;
    }).join('');

    // the plain-language result
    const ranked = on.filter(st => S.sims[st.key].by[m].days !== null).sort((a, b) => S.sims[a.key].by[m].days - S.sims[b.key].by[m].days || S.sims[b.key].by[m].lift - S.sims[a.key].by[m].lift);
    let text = 'No strategy is switched on.';
    if (ranked.length) {
      const best = ranked[0], r = S.sims[best.key].by[m], teams = p.teams === 1 ? 'one team' : p.teams + ' teams';
      text = `${best.name} reaches ${Math.round(p.target * 100)}% of the ${what} in ${days(r.days)} with ${teams}.`;
      const base = on.find(st => st.key === 'nearest');
      if (base && base !== best && S.sims.nearest.by[m].days !== null) {
        const gap = S.sims.nearest.by[m].days - r.days;
        text += gap > 0 ? ` Nearest neighbor, which uses the map but not the scores, needs ${days(S.sims.nearest.by[m].days)}: ${days(gap)} more.` : ' Nearest neighbor is just as fast here.';
      }
    } else if (on.length) text = 'No strategy reaches the target.';
    $('treatText').textContent = text;
    $('caveat').textContent = (H.synthetic ? 'The habitats and larval counts are synthetic, and the routes are simulated. Nothing here is a field result. ' : 'Routes are simulated. They show what a plan would schedule, not larvae treated or malaria prevented. ') +
      (m === 'score' ? 'Coverage is a share of the total predicted score. A route lift-ratio compares the visit order with the scores, so it says how closely the route follows the ranking, not how good the ranking is.' : `Coverage is a share of the ${larvaeWord()}.`);

    const sel = $('mapStrategy');
    sel.innerHTML = on.map(st => `<option value="${st.key}">${esc(st.name)}</option>`).join('');
    sel.value = S.mapStrategy;
    for (const b of $('measure').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', b.dataset.measure === m);
      if (b.dataset.measure === 'observed') { b.hidden = !hasObserved(); b.textContent = 'Judge by ' + larvaeWord(); }
    }
    $('planBtn').disabled = $('dataBtn').disabled = false;
  }

  function renderMap() {
    const H = S.H;
    habitatLayer.clearLayers(); startLayer.clearLayers();
    S.markers = [];
    if (!H) return;
    const sorted = Array.from(H.score).sort((a, b) => a - b), cut = [0.2, 0.4, 0.6, 0.8].map(q => sorted[Math.floor(q * (H.n - 1))]);
    for (let i = 0; i < H.n; i++) {
      const bin = cut.filter(c => H.score[i] > c).length;
      const label = `Habitat ${esc(H.id[i])}<br>Score ${H.score[i]}` + (H.observed ? `<br>${H.synthetic ? 'Synthetic larvae' : 'Observed'}: ${H.observed[i]}` : '');
      S.markers.push(L.circleMarker([H.lat[i], H.lon[i]], { radius: 4.5, weight: 1, color: '#fff', fillColor: SCORE_RAMP[bin], fillOpacity: 0.95, scoreColor: SCORE_RAMP[bin] }).bindTooltip(label).addTo(habitatLayer));
    }
    L.marker([S.start.lat, S.start.lon], { icon: startIcon, interactive: false, keyboard: false }).addTo(startLayer);
  }
  // ------------------------------------------------------------ the map at one moment of the campaign
  // S.t is working time in seconds since the campaign began: day d runs from (d - 1) to d day lengths.
  // Road points between two points of S.pts, with the distance along the way.
  function legPath(a, b) {
    const key = a + '>' + b;
    let leg = S.legCache.get(key);
    if (leg) return leg;
    const P = S.P, g = S.graph, here = i => [P.lat(S.pts[i].y), P.lon(S.pts[i].x)], pts = [here(a)];
    if (g && S.pts[a].node !== S.pts[b].node) for (const v of S.dijkstra.path(S.pts[a].node, S.pts[b].node)) pts.push([P.lat(g.y[v]), P.lon(g.x[v])]);
    pts.push(here(b));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], (pts[i][1] - pts[i - 1][1]) * Math.cos(pts[i][0] * Math.PI / 180)));
    leg = { pts, cum };
    S.legCache.set(key, leg);
    return leg;
  }
  // The first part of a path, up to a share of its length.
  function partOf(leg, share) {
    const want = share * leg.cum[leg.cum.length - 1], out = [leg.pts[0]];
    for (let i = 1; i < leg.pts.length; i++) {
      if (leg.cum[i] <= want) { out.push(leg.pts[i]); continue; }
      const a = leg.pts[i - 1], b = leg.pts[i], r = (want - leg.cum[i - 1]) / ((leg.cum[i] - leg.cum[i - 1]) || 1);
      out.push([a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r]);
      break;
    }
    return out;
  }
  // index of the first item for which test is true, in a list where false items come before true ones
  function firstWhere(list, test) {
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (test(list[mid])) hi = mid; else lo = mid + 1; }
    return lo;
  }
  // Where team q has driven on the current day up to time t. The last point is where the team is now.
  function trailOf(out, q, dayStart, t, p) {
    const sim = out.sim, P = S.P, g = S.graph, startAt = [S.start.lat, S.start.lon];
    if (sim.tracks) {   // street search: positions along the drive through every street
      const tr = sim.tracks[q];
      if (!tr || !tr.times.length || t < tr.times[0]) return [startAt];
      const at = k => { const v = S.walk.nodes[tr.begin + k]; return [P.lat(g.y[v]), P.lon(g.x[v])]; };
      const a = Math.max(0, firstWhere(tr.times, v => v > dayStart) - 1), b = firstWhere(tr.times, v => v > t) - 1, pts = [];
      for (let k = a; k <= b; k++) pts.push(at(k));
      if (b + 1 < tr.times.length) {
        const u = at(b), w = at(b + 1), r = (t - tr.times[b]) / Math.max(tr.times[b + 1] - tr.times[b], 1e-9);
        pts.push([u[0] + (w[0] - u[0]) * r, u[1] + (w[1] - u[1]) * r]);
      }
      return pts;
    }
    if (!out.byTeam) { out.byTeam = Array.from({ length: p.teams }, () => []); sim.team.forEach((team, i) => out.byTeam[team].push(i)); }
    const list = out.byTeam[q] || [], service = p.serviceMin * 60, pts = [];
    const lo = firstWhere(list, i => sim.finish[i] > dayStart);
    for (let k = lo; k < list.length; k++) {
      const i = list[k];
      if (sim.leave[i] >= t) break;
      const leg = legPath(sim.from[i], sim.order[i]), arrive = sim.finish[i] - service;
      const part = t >= arrive ? leg.pts : partOf(leg, (t - sim.leave[i]) / Math.max(arrive - sim.leave[i], 1e-9));
      for (let j = pts.length ? 1 : 0; j < part.length; j++) pts.push(part[j]);
      if (t < arrive) break;
    }
    if (!pts.length) {
      // not under way yet today: at the start (first day, or daily return), or at the last habitat visited
      const prev = lo > 0 ? list[lo - 1] : -1;
      pts.push(prev >= 0 && !$('dailyReturn').checked ? [S.H.lat[sim.order[prev]], S.H.lon[sim.order[prev]]] : startAt);
    }
    return pts;
  }
  // Draw the campaign at time S.t. full: start again from an empty map (needed after any change but the clock moving on).
  function drawFrame(full) {
    const out = S.sims[S.mapStrategy];
    if (!S.H || !out) { routeLayer.clearLayers(); S.frame = null; return; }
    const sim = out.sim, p = params(), daySec = p.hours * 3600, m = measure(), r = out.by[m];
    const t = Math.max(0, Math.min(S.t || 0, out.totalDays * daySec)), day = Math.max(1, Math.ceil(t / daySec - 1e-9)), dayStart = (day - 1) * daySec;
    if (full || !S.frame || t < S.frame.t) {
      routeLayer.clearLayers();
      S.markers.forEach(mk => mk.setStyle({ radius: 3.5, weight: 1, color: '#5d6b75', fillColor: '#fff', fillOpacity: 0.55 }));
      S.frame = { shown: 0, lines: [], dots: [] };
    }
    const f = S.frame;
    // a habitat is filled once visited, and outlined in the color of the team that visited it
    while (f.shown < sim.order.length && sim.finish[f.shown] <= t + 1e-6) {
      const i = f.shown++, mk = S.markers[sim.order[i]];
      mk.setStyle({ radius: 4.5, weight: 1.5, color: TEAM_COLORS[sim.team[i] % TEAM_COLORS.length], fillColor: mk.options.scoreColor, fillOpacity: 0.95 });
    }
    f.t = t;
    for (let q = 0; q < p.teams; q++) {
      const color = TEAM_COLORS[q % TEAM_COLORS.length], trail = t > 0 ? trailOf(out, q, dayStart, t, p) : [[S.start.lat, S.start.lon]];
      if (!f.lines[q]) {
        f.lines[q] = L.polyline(trail, { color, weight: 4, opacity: 0.9, interactive: false }).addTo(routeLayer);
        // a numbered marker for the team, drawn above the habitats
        f.dots[q] = L.marker(trail[trail.length - 1], { interactive: false, keyboard: false, zIndexOffset: 1000,
          icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="team-dot" style="background:${color}">${q + 1}</div>` }) }).addTo(routeLayer);
      } else { f.lines[q].setLatLngs(trail); f.dots[q].setLatLng(trail[trail.length - 1]); }
    }
    $('dayOut').textContent = t <= 0 ? 'before the first day' : `day ${day} of ${out.totalDays}, hour ${((t - dayStart) / 3600).toFixed(1)}`;
    $('kpiCov').textContent = pct(r.visit[f.shown]);
    $('kpiCovLabel').textContent = (m === 'observed' ? larvaeWord() : 'predicted score') + ' reached';
    $('kpiSeen').textContent = f.shown.toLocaleString('en-US') + ' of ' + S.H.n.toLocaleString('en-US');
    $('kpiTarget').textContent = r.days === null ? 'not reached' : r.days;
    $('kpiTargetLabel').textContent = `days to ${Math.round(p.target * 100)}%`;
    $('kpiFinish').textContent = out.totalDays;
    $('kpiDrive').textContent = Math.round(sim.driveKm).toLocaleString('en-US');
  }
  function renderAll() {
    renderMap(); renderRank(); renderRoutes(); drawFrame(true);
    const H = S.H;
    $('dataTag').textContent = (H.synthetic ? 'Synthetic demo: ' : 'Your list: ') + H.n.toLocaleString('en-US') + ' habitats, ' + (S.graph ? 'road distances' : 'straight-line distances');
    document.querySelector('#strategyChecks input[data-key="street"]').disabled = !S.walk;
    setStatus(S.note || (S.graph ? `Ready. Roads: ${S.graph.n.toLocaleString('en-US')} road points from OpenStreetMap (${S.roadCache.source}).` : 'Ready.'), { warn: !!S.note });
  }

  // ------------------------------------------------------------ controls
  // distribution presets: the zero-inflated negative binomial fitted to each survey (share of habitats that cannot produce,
  // mean count where larvae occur, dispersion k) and the survey's number of habitats
  const DIST_PRESETS = { jigjiga: { zeroShare: 0.2033, meanCount: 149.65, kShape: 0.8987, nHabitats: 743, clustering: 0.4 },
                         jigjiga_hot: { zeroShare: 0.2033, meanCount: 149.65, kShape: 0.8987, nHabitats: 743, clustering: 1.0 },
                         semera: { zeroShare: 0.6455, meanCount: 52.18, kShape: 0.3978, nHabitats: 484, clustering: 0.2 },
                         logiya: { zeroShare: 0.8534, meanCount: 44.06, kShape: 0.8811, nHabitats: 176, clustering: 0 } };
  function applyPreset(name) {
    const p = DIST_PRESETS[name];
    if (!p) return;
    for (const id of Object.keys(p)) $(id).value = p[id];
    $('distPreset').value = name;
    showOutputs();
  }
  $('distPreset').addEventListener('change', () => applyPreset($('distPreset').value));
  ['zeroShare', 'meanCount', 'kShape', 'nHabitats'].forEach(id => $(id).addEventListener('input', () => { $('distPreset').value = 'custom'; }));
  const OUTPUTS = { nHabitats: ['nOut', v => v], zeroShare: ['zeroOut', v => pct(+v, 1)], meanCount: ['meanOut', v => (+v).toFixed(1)], kShape: ['kOut', v => (+v).toFixed(2)],
    clustering: ['clusterOut', v => (+v === 0 ? 'none' : (+v).toFixed(1))], skill: ['skillOut', v => 'lift-ratio ' + (+v).toFixed(2)], budget: ['budgetOut', v => 'top ' + v + '%'],
    teams: ['teamsOut', v => v], speed: ['speedOut', v => v + ' km/h'], service: ['serviceOut', v => v + ' min'], hours: ['hoursOut', v => v + ' h'],
    kNear: ['kNearOut', v => v], band: ['bandOut', v => v + ' m'], target: ['targetOut', v => v + '%'] };
  const showOutputs = () => { for (const id in OUTPUTS) $(OUTPUTS[id][0]).textContent = OUTPUTS[id][1]($(id).value); };
  const resimulate = debounce(() => { if (S.H && !S.busy) { simulateAll(); renderRoutes(); drawFrame(true); } }, 60);
  const rescore = debounce(() => {
    if (!S.H || !S.H.synthetic || S.busy) return;
    S.H.score = F.scoresForSkill(S.H.observed, S.basis, +$('skill').value).score;
    simulateAll(); renderAll();
  }, 80);
  document.addEventListener('input', ev => {
    const id = ev.target.id;
    if (OUTPUTS[id]) showOutputs();
    if (['teams', 'speed', 'service', 'hours', 'kNear', 'band', 'target'].includes(id)) resimulate();
    if (id === 'skill') rescore();
    if (id === 'budget') renderRank();
    if (id === 'day') { stopPlay(); S.t = +ev.target.value * params().hours * 3600; drawFrame(true); renderRoutesSoon(); }
  });
  const renderRoutesSoon = debounce(() => renderRoutes(), 120);
  // play the campaign: the clock runs, teams move along the roads, and habitats fill as they are visited
  let raf = 0, lastTick = 0, lastDay = -1;
  function showPlaying(on) {
    $('playBtn').textContent = on ? 'Pause' : 'Play'; $('playBtn').setAttribute('aria-pressed', on);
    $('mapPlay').textContent = on ? '❚❚ Pause' : '▶ Play the campaign'; $('mapPlay').hidden = !S.H;
  }
  function stopPlay() {
    if (!raf) return;
    cancelAnimationFrame(raf); raf = 0;
    showPlaying(false);
    renderRoutes();
  }
  function tick(now) {
    const out = S.sims[S.mapStrategy];
    if (!out) { raf = 0; showPlaying(false); return; }
    const daySec = params().hours * 3600, end = out.totalDays * daySec;
    // at 1x, one working day plays in about five seconds
    S.t = Math.min(end, (S.t || 0) + Math.min(0.1, (now - lastTick) / 1000) * daySec / 5 * +$('playSpeed').value);
    lastTick = now;
    const day = Math.ceil(S.t / daySec - 1e-9);
    $('day').value = day;
    drawFrame(false);
    if (day !== lastDay) { lastDay = day; renderRoutes(); }
    if (S.t >= end) { stopPlay(); return; }
    raf = requestAnimationFrame(tick);
  }
  // fromStart: begin at day 0; otherwise go on from the moment shown (or from day 0 when the campaign is over)
  function startPlay(fromStart) {
    const out = S.sims[S.mapStrategy];
    if (raf || !S.H || !out) return;
    if (fromStart || (S.t || 0) >= out.totalDays * params().hours * 3600) { S.t = 0; drawFrame(true); }
    showPlaying(true);
    lastTick = performance.now(); lastDay = -1;
    raf = requestAnimationFrame(tick);
  }
  const togglePlay = () => (raf ? stopPlay() : startPlay(false));
  $('playBtn').addEventListener('click', togglePlay);
  $('mapPlay').addEventListener('click', togglePlay);
  $('dailyReturn').addEventListener('change', () => resimulate());

  $('city').innerHTML = CITIES.map(c => `<option value="${c.key}">${esc(c.name)}</option>`).join('');
  $('city').addEventListener('change', () => {
    if ($('city').value === '__place') { const st = window.FRRT_ROADS[S.placeKey]; setBox(st.box, true, null); autoBuild(); return; }
    S.placeKey = null;
    const c = CITIES.find(x => x.key === $('city').value); setBox(boxAround(c.lat, c.lon), true, c.key);
    autoBuild();
  });
  // a new city starts its demo at once (after the build in progress, if any)
  function autoBuild() {
    if ($('tabDemo').getAttribute('aria-selected') !== 'true') return;
    if (S.busy) { S.rebuild = true; return; }
    build('demo');
  }
  $('strategyChecks').innerHTML = STRATEGIES.map((st, i) => (i === 0 || STRATEGIES[i - 1].group !== st.group ? `<div class="group">${esc(st.group)}</div>` : '') + `<label title="${esc(st.hint)}"><input type="checkbox" data-key="${st.key}"${st.on ? ' checked' : ''}><span class="swatch" style="border-color:${st.color}"></span>${esc(st.name)}</label>`).join('');
  $('strategyChecks').addEventListener('change', ev => { STRATEGIES.find(st => st.key === ev.target.dataset.key).on = ev.target.checked; resimulate(); });
  $('mapStrategy').addEventListener('change', ev => { S.mapStrategy = ev.target.value; renderRoutes(); drawFrame(true); });
  $('resultTable').addEventListener('click', ev => { const row = ev.target.closest('tr[data-key]'); if (row) { S.mapStrategy = row.dataset.key; renderRoutes(); drawFrame(true); } });
  $('measure').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) { S.measure = b.dataset.measure; renderRoutes(); } });
  $('demoGo').addEventListener('click', () => build('demo'));
  $('distanceModel').addEventListener('change', () => { if (S.source) build(S.source); });

  // tabs
  function showPane(demo) {
    $('tabDemo').setAttribute('aria-selected', demo); $('tabUpload').setAttribute('aria-selected', !demo);
    $('paneDemo').hidden = !demo; $('paneUpload').hidden = demo;
  }
  $('tabDemo').addEventListener('click', () => showPane(true));
  $('tabUpload').addEventListener('click', () => showPane(false));

  // your own list
  async function loadList(text) {
    const read = F.readHabitats(text);
    if (read.error) { setStatus(read.error, { warn: true }); return; }
    const notes = [];
    if (read.rows.length > MAX_HABITATS) { notes.push(`the list has ${read.rows.length.toLocaleString('en-US')} habitats and only the first ${MAX_HABITATS.toLocaleString('en-US')} are used`); read.rows.length = MAX_HABITATS; }
    if (read.skipped) notes.push(`${read.skipped} rows without a valid location or score were skipped`);
    if (read.clipped) notes.push(`${read.clipped} negative scores were set to 0`);
    if (read.partlyObserved) notes.push('observed counts were ignored because some rows have none');
    S.upload = read;
    await build('upload');
    if (notes.length && S.H) setStatus('Loaded, with notes: ' + notes.join('; ') + '.' + (S.note ? ' ' + S.note : ''), { warn: true });
  }
  $('file').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (file) await loadList(await file.text());
  });
  // A synthetic example list in the upload format: made-up habitats in Jigjiga.
  function exampleCsv() {
    const c = CITIES[0], b = boxAround(c.lat, c.lon), P = F.projector(c.lat, c.lon), rand = F.makeRandom(7);
    const made = F.synthesize({ rand, n: 300, graph: null, zeroShare: 0.2, mean: 150, k: 0.9, clustering: 0.5, box: { x0: P.x(b.w), x1: P.x(b.e), y0: P.y(b.s), y1: P.y(b.n) } });
    const score = F.scoresForSkill(made.count, F.skillBasis(made.count, rand), 0.35).score;
    return 'id,lat,lon,score,observed\n' + made.x.map((x, i) => `EX${String(i + 1).padStart(3, '0')},${P.lat(made.y[i]).toFixed(6)},${P.lon(x).toFixed(6)},${score[i]},${made.count[i]}`).join('\n') + '\n';
  }
  $('sampleBtn').addEventListener('click', () => download('example_habitats_synthetic.csv', exampleCsv()));
  $('exampleBtn').addEventListener('click', () => loadList(exampleCsv()));

  // downloads
  $('dataBtn').addEventListener('click', () => {
    const H = S.H, obs = H.observed ? (H.synthetic ? ',synthetic_larvae' : ',observed') : '';
    download(H.synthetic ? 'demo_habitats_synthetic.csv' : 'habitats.csv', 'id,lat,lon,score' + obs + '\n' +
      H.id.map((id, i) => `"${String(id).replace(/"/g, '""')}",${H.lat[i].toFixed(6)},${H.lon[i].toFixed(6)},${H.score[i]}${H.observed ? ',' + H.observed[i] : ''}`).join('\n') + '\n');
  });
  $('planBtn').addEventListener('click', () => {
    const H = S.H, out = S.sims[S.mapStrategy], sim = out.sim, daySeconds = params().hours * 3600;
    const rows = sim.order.map((j, i) => [i + 1, `"${String(H.id[j]).replace(/"/g, '""')}"`, H.lat[j].toFixed(6), H.lon[j].toFixed(6), H.score[j], sim.team[i] + 1,
      Math.max(1, Math.ceil(sim.finish[i] / daySeconds - 1e-9)), (sim.finish[i] / 3600).toFixed(2), (sim.leg[i] / 1000).toFixed(3)].join(','));
    download(`visit_plan_${S.mapStrategy}.csv`, 'visit,id,lat,lon,score,team,working_day,team_hours_worked,drive_km_to_here\n' + rows.join('\n') + '\n');
  });

  // drawing an area, and moving the start
  $('drawBtn').addEventListener('click', () => {
    const btn = $('drawBtn');
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = 'Drag on the map to draw a box';
    $('map').classList.add('drawing');
    map.dragging.disable();
    map.once('mousedown', down => {
      const rect = L.rectangle([down.latlng, down.latlng], { color: '#2a78d6', weight: 2, fillOpacity: 0.08 }).addTo(map);
      const move = ev => rect.setBounds(L.latLngBounds(down.latlng, ev.latlng));
      map.on('mousemove', move);
      map.once('mouseup', up => {
        map.off('mousemove', move);
        map.dragging.enable();
        rect.remove();
        $('map').classList.remove('drawing');
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = 'Draw an area on the map';
        const b = L.latLngBounds(down.latlng, up.latlng), box = { s: b.getSouth(), n: b.getNorth(), w: b.getWest(), e: b.getEast() };
        if (boxArea(box) < 0.05) { setStatus('That box is very small. Drag a larger one.', { warn: true }); return; }
        setBox(box, false);
        setStatus(`Area set: ${boxArea(box).toFixed(1)} km². Build the demo to fill it with habitats.`);
      });
    });
  });
  $('startBtn').addEventListener('click', () => {
    if (!S.H) { setStatus('Build the demo or load a list first.', { warn: true }); return; }
    const btn = $('startBtn');
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = 'Click the map to place the start';
    $('map').classList.add('picking');
    map.once('click', ev => {
      $('map').classList.remove('picking');
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Move the start point';
      moveStart(ev.latlng);
    });
  });

  // place search (Nominatim)
  async function searchPlace() {
    const q = $('placeQuery').value.trim(), list = $('placeResults');
    if (!q) return;
    list.innerHTML = '<li class="note">Searching…</li>';
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' + encodeURIComponent(q));
      const found = await res.json();
      list.innerHTML = found.length ? '' : '<li class="note">No place found. Try another name.</li>';
      for (const f of found) {
        const li = document.createElement('li'), b = document.createElement('button');
        b.type = 'button'; b.textContent = f.display_name;
        b.addEventListener('click', () => { setBox(boxAround(+f.lat, +f.lon), true); list.innerHTML = ''; setStatus('Area set around ' + f.display_name.split(',')[0] + '. Build the demo to fill it with habitats.'); });
        li.appendChild(b); list.appendChild(li);
      }
    } catch (err) { list.innerHTML = '<li class="note">The place search did not answer. Pick a city or draw an area instead.</li>'; }
  }
  $('placeGo').addEventListener('click', searchPlace);
  $('placeQuery').addEventListener('keydown', ev => { if (ev.key === 'Enter') searchPlace(); });

  $('aboutBtn').addEventListener('click', () => $('about').showModal());
  $('aboutClose').addEventListener('click', () => $('about').close());
  new ResizeObserver(debounce(() => { if (S.H) { renderRank(); renderRoutes(); } }, 150)).observe($('visitChart'));

  // ------------------------------------------------------------ start-up; a link can preset the demo:
  // ?city=jigjiga&n=800&seed=2026&skill=0.35&teams=2&auto=1   (?example=1 loads the example list, ?roads=0 uses straight lines)
  const q = new URLSearchParams(location.search);
  const preset = (name, id) => { if (q.has(name) && isFinite(+q.get(name))) $(id).value = q.get(name); };
  preset('n', 'nHabitats'); preset('seed', 'seed'); preset('skill', 'skill'); preset('teams', 'teams');
  if (q.get('roads') === '0') $('distanceModel').value = 'straight';
  if (DIST_PRESETS[q.get('dist')]) applyPreset(q.get('dist')); else if (!q.has('n')) applyPreset('jigjiga');
  preset('n', 'nHabitats'); preset('skill', 'skill');
  if (['pi', 'mu', 'k'].some(x => q.has(x))) { preset('pi', 'zeroShare'); preset('mu', 'meanCount'); preset('k', 'kShape'); $('distPreset').value = 'custom'; showOutputs(); }
  // back to the explorer with the same settings (the explorer passes its own address state)
  if (q.get('back') && /^[A-Za-z0-9=&._%-]+$/.test(q.get('back'))) $('backLink').href = '../index.html#' + q.get('back');
  const placeKey = q.get('place');
  if (placeKey && /^[A-Za-z0-9_-]+$/.test(placeKey)) {
    const tag = document.createElement('script');
    tag.src = '../data/roads/' + placeKey + '.js';
    tag.onload = () => {
      const st = (window.FRRT_ROADS || {})[placeKey];
      if (!st) { setStatus('No stored roads for this city.'); return; }
      S.placeKey = placeKey;
      const opt = document.createElement('option');
      opt.value = '__place'; opt.textContent = q.get('name') || placeKey;
      $('city').insertBefore(opt, $('city').firstChild);
      $('city').value = '__place';
      showOutputs();
      setBox(st.box, true, null);
      if (q.get('auto') !== '0') build('demo');
    };
    tag.onerror = () => setStatus('The roads of this city could not be loaded.');
    document.head.appendChild(tag);
  } else {
    const first = CITIES.find(c => c.key === q.get('city')) || CITIES[0];
    $('city').value = first.key;
    showOutputs();
    setBox(boxAround(first.lat, first.lon), true, first.key);
    if (q.get('example') === '1') { showPane(false); loadList(exampleCsv()); }
    else if (q.get('auto') !== '0') build('demo');
  }
})();
