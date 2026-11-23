/* Precision LSM explorer: calculations.
   Lift-ratio, synthetic demo data, the road graph and the route simulation.
   No dependencies. Runs in a browser (window.FRRT) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FRRT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- random numbers
  // Seeded, so the same seed always gives the same demo.
  function makeRandom(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }
  function gamma(rand, shape) {
    if (shape < 1) {
      let u = 0;
      while (u === 0) u = rand();
      return gamma(rand, shape + 1) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = normal(rand); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = rand();
      if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function poisson(rand, lambda) {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      const limit = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= rand(); } while (p > limit);
      return k - 1;
    }
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rand)));
  }

  // ---------------------------------------------------------------- lift-ratio
  // Indices from the highest value to the lowest; ties keep their input order.
  function rankOrder(values) {
    const idx = Array.from(values, (_, i) => i);
    idx.sort((a, b) => values[b] - values[a] || a - b);
    return idx;
  }
  // Cumulative share of `values` reached after each visit, starting at 0. Length n + 1.
  function coverageCurve(order, values) {
    const n = order.length, out = new Float64Array(n + 1);
    let total = 0, run = 0;
    for (let i = 0; i < n; i++) total += values[order[i]];
    for (let i = 0; i < n; i++) { run += values[order[i]]; out[i + 1] = total > 0 ? run / total : 0; }
    return out;
  }
  // Area under a coverage curve, with the share of habitats on the horizontal axis (trapezoid rule).
  function area(curve) {
    const n = curve.length - 1;
    let s = 0;
    for (let i = 0; i < n; i++) s += (curve[i] + curve[i + 1]) / 2;
    return n > 0 ? s / n : 0;
  }
  function idealCurve(values) { return coverageCurve(rankOrder(values), values); }
  // Lift-ratio of a curve: 0 for random order, 1 for the ideal order.
  function liftOfCurve(curve, values) {
    const ideal = area(idealCurve(values));
    return ideal > 0.5 ? (area(curve) - 0.5) / (ideal - 0.5) : NaN;
  }
  function liftRatio(order, values) { return liftOfCurve(coverageCurve(order, values), values); }
  // Coverage of `truth` when habitats are taken in score order. Habitats with equal scores share
  // their group's mean, which is the expected result when ties are broken at random.
  function rankingCurve(score, truth) {
    const order = rankOrder(score), n = order.length, shared = new Float64Array(n);
    for (let i = 0; i < n;) {
      let j = i, sum = 0;
      while (j < n && score[order[j]] === score[order[i]]) sum += truth[order[j++]];
      for (let k = i; k < j; k++) shared[k] = sum / (j - i);
      i = j;
    }
    const out = new Float64Array(n + 1);
    let total = 0, run = 0;
    for (let i = 0; i < n; i++) total += shared[i];
    for (let i = 0; i < n; i++) { run += shared[i]; out[i + 1] = total > 0 ? run / total : 0; }
    return out;
  }

  // ---------------------------------------------------------------- geography
  const EARTH = 6371008.8, RAD = Math.PI / 180;
  function haversine(lat1, lon1, lat2, lon2) {
    const a = Math.sin((lat2 - lat1) * RAD / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.sqrt(a));
  }
  // Flat local coordinates in meters around a center. Accurate to well under 1% across a city.
  function projector(lat0, lon0) {
    const kx = Math.cos(lat0 * RAD) * EARTH * RAD, ky = EARTH * RAD;
    return { x: lon => (lon - lon0) * kx, y: lat => (lat - lat0) * ky, lon: x => lon0 + x / kx, lat: y => lat0 + y / ky };
  }

  // ---------------------------------------------------------------- road graph
  const NOT_DRIVABLE = /^(footway|steps|cycleway|corridor|bridleway|construction|proposed|platform|elevator|raceway|bus_guideway|rest_area|services)$/;
  const MAJOR = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;
  const drivable = kind => !!kind && !NOT_DRIVABLE.test(kind);

  // Example cities for the demo. The demo area is a box of about 3.5 km on each side around the point.
  const CITIES = [
    { key: 'jigjiga', name: 'Jigjiga, Ethiopia', lat: 9.352, lon: 42.797 },
    { key: 'diredawa', name: 'Dire Dawa, Ethiopia', lat: 9.595, lon: 41.862 },
    { key: 'addis', name: 'Addis Ababa, Ethiopia', lat: 9.012, lon: 38.761 },
    { key: 'djibouti', name: 'Djibouti City, Djibouti', lat: 11.572, lon: 43.145 },
    { key: 'hargeisa', name: 'Hargeisa', lat: 9.562, lon: 44.065 },
    { key: 'mombasa', name: 'Mombasa, Kenya', lat: -4.055, lon: 39.666 },
    { key: 'accra', name: 'Accra, Ghana', lat: 5.556, lon: -0.203 },
    { key: 'lagos', name: 'Lagos, Nigeria', lat: 6.497, lon: 3.356 },
  ];
  function boxAround(lat, lon) {
    const half = 0.016, dLon = half / Math.cos(lat * RAD);
    return { s: lat - half, n: lat + half, w: lon - dLon, e: lon + dLon };
  }
  // Roads stored with the app (roads/<city>.json, written by tools/fetch_city_roads.js) -> ways for buildGraph.
  function unpackRoads(stored) {
    return stored.ways.map(w => {
      const geometry = [];
      for (let i = 0; i < w.g.length; i += 2) geometry.push({ lat: w.g[i], lon: w.g[i + 1] });
      return { tags: { highway: w.k }, nodes: w.n, geometry };
    });
  }
  // The reverse: Overpass ways -> a compact form, keeping only roads that the graph uses.
  function packRoads(ways) {
    const ids = new Map(), small = id => { if (!ids.has(id)) ids.set(id, ids.size); return ids.get(id); };
    return ways.filter(w => w.tags && drivable(w.tags.highway) && w.nodes && w.geometry && w.geometry.every(Boolean)).map(w => ({
      k: w.tags.highway, n: w.nodes.map(small), g: w.geometry.flatMap(p => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]) }));
  }

  // ways: OpenStreetMap ways as returned by Overpass "out geom" ({nodes, geometry, tags}).
  // Roads are treated as two-way. Long segments are split so that habitats snap to a nearby point.
  function buildGraph(ways, center, split) {
    split = split || 50;
    const P = projector(center.lat, center.lon), index = new Map();
    const xs = [], ys = [], ea = [], eb = [], el = [], em = [];
    const node = (id, p) => {
      let i = index.get(id);
      if (i === undefined) { i = xs.length; index.set(id, i); xs.push(P.x(p.lon)); ys.push(P.y(p.lat)); }
      return i;
    };
    for (const way of ways) {
      const kind = way.tags && way.tags.highway;
      if (!drivable(kind) || !way.nodes || !way.geometry) continue;
      const minor = MAJOR.test(kind) ? 0 : 1;
      for (let i = 0; i + 1 < way.nodes.length; i++) {
        const a = way.geometry[i], b = way.geometry[i + 1];
        if (!a || !b) continue;
        const u = node(way.nodes[i], a), v = node(way.nodes[i + 1], b);
        const d = Math.hypot(xs[v] - xs[u], ys[v] - ys[u]);
        if (!(d > 0)) continue;
        const parts = Math.max(1, Math.ceil(d / split));
        let prev = u;
        for (let p = 1; p <= parts; p++) {
          let next = v;
          if (p < parts) {
            next = xs.length;
            xs.push(xs[u] + (xs[v] - xs[u]) * p / parts);
            ys.push(ys[u] + (ys[v] - ys[u]) * p / parts);
          }
          ea.push(prev); eb.push(next); el.push(d / parts); em.push(minor);
          prev = next;
        }
      }
    }
    const total = xs.length;
    if (!total) return null;
    // keep the largest connected part, so that every pair of points has a route
    const parent = new Int32Array(total).map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let e = 0; e < ea.length; e++) { const a = find(ea[e]), b = find(eb[e]); if (a !== b) parent[a] = b; }
    const sizes = new Map();
    for (let i = 0; i < total; i++) { const r = find(i); sizes.set(r, (sizes.get(r) || 0) + 1); }
    let keep = -1, best = 0;
    for (const [r, s] of sizes) if (s > best) { best = s; keep = r; }
    const remap = new Int32Array(total).fill(-1);
    let n = 0;
    for (let i = 0; i < total; i++) if (find(i) === keep) remap[i] = n++;
    const g = { n, x: new Float64Array(n), y: new Float64Array(n), P, center, edges: { a: [], b: [], len: [], minor: [] } };
    for (let i = 0; i < total; i++) if (remap[i] >= 0) { g.x[remap[i]] = xs[i]; g.y[remap[i]] = ys[i]; }
    const degree = new Int32Array(n + 1);
    for (let e = 0; e < ea.length; e++) {
      const a = remap[ea[e]], b = remap[eb[e]];
      if (a < 0 || b < 0) continue;
      g.edges.a.push(a); g.edges.b.push(b); g.edges.len.push(el[e]); g.edges.minor.push(em[e]);
      degree[a + 1]++; degree[b + 1]++;
    }
    for (let i = 0; i < n; i++) degree[i + 1] += degree[i];
    g.off = degree;
    g.to = new Int32Array(degree[n]);
    g.w = new Float32Array(degree[n]);
    const fill = new Int32Array(n);
    for (let e = 0; e < g.edges.a.length; e++) {
      const a = g.edges.a[e], b = g.edges.b[e], w = g.edges.len[e];
      let k = g.off[a] + fill[a]++; g.to[k] = b; g.w[k] = w;
      k = g.off[b] + fill[b]++; g.to[k] = a; g.w[k] = w;
    }
    g.dropped = total - n;
    // grid of 100 m cells for finding the nearest road point
    g.cell = 100;
    g.grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(g.x[i] / g.cell) + ',' + Math.floor(g.y[i] / g.cell);
      const list = g.grid.get(key);
      if (list) list.push(i); else g.grid.set(key, [i]);
    }
    return g;
  }

  // Nearest road point to (x, y) in meters: {node, dist}.
  function snap(g, x, y) {
    const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r < 400; r++) {
      if (best >= 0 && (r - 1) * g.cell > bestD) break;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const list = g.grid.get((cx + dx) + ',' + (cy + dy));
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(g.x[i] - x, g.y[i] - y);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    return { node: best, dist: bestD };
  }

  // Shortest road distances from one point (Dijkstra with a binary heap). The returned function
  // reuses its buffers: read the result before calling it again.
  function makeDijkstra(g) {
    const n = g.n, dist = new Float64Array(n), done = new Uint8Array(n), prev = new Int32Array(n);
    let keys = new Float64Array(4096), vals = new Int32Array(4096), size = 0, hit = -1;
    function push(k, v) {
      if (size === keys.length) {
        const k2 = new Float64Array(size * 2), v2 = new Int32Array(size * 2);
        k2.set(keys); v2.set(vals); keys = k2; vals = v2;
      }
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= k) break;
        keys[i] = keys[p]; vals[i] = vals[p]; i = p;
      }
      keys[i] = k; vals[i] = v;
    }
    function pop() {
      const top = vals[0], k = keys[--size], v = vals[size];
      if (size === 0) return top;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c]; vals[i] = vals[c]; i = c;
      }
      keys[i] = k; vals[i] = v;
      return top;
    }
    // isTarget (optional): stop once `targets` flagged nodes have their final distance.
    function run(src, isTarget, targets) {
      dist.fill(Infinity); done.fill(0); size = 0; hit = -1;
      dist[src] = 0; prev[src] = -1; push(0, src);
      let left = targets || 0;
      while (size > 0) {
        const key = keys[0], u = pop();
        if (done[u]) continue;
        done[u] = 1;
        if (isTarget && isTarget[u] && --left === 0) { hit = u; break; }
        for (let e = g.off[u]; e < g.off[u + 1]; e++) {
          const v = g.to[e], nd = key + g.w[e];
          if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
        }
      }
      return dist;
    }
    // Road points from the last source to v, after a run.
    function trace(v) {
      const out = [];
      for (; v >= 0; v = prev[v]) out.push(v);
      return out.reverse();
    }
    // Road points along the shortest route from src to dst.
    function path(src, dst) {
      if (src === dst) return [src];
      const flag = new Uint8Array(n);
      flag[dst] = 1;
      run(src, flag, 1);
      return trace(dst);
    }
    // hit(): the flagged point at which the last run stopped, or -1.
    return { run, path, trace, hit: () => hit };
  }

  // Road distance in meters between every pair of points: the walk from each point to its road
  // point is added at both ends. pts: [{x, y, node, access}]. Pauses now and then so the page stays responsive.
  async function roadMatrix(g, pts, onProgress) {
    const M = pts.length, D = new Float32Array(M * M), byNode = new Map();
    pts.forEach((p, i) => { const list = byNode.get(p.node); if (list) list.push(i); else byNode.set(p.node, [i]); });
    const nodes = Array.from(byNode.keys()), isTarget = new Uint8Array(g.n);
    for (const v of nodes) isTarget[v] = 1;
    const dijkstra = makeDijkstra(g);
    let last = Date.now();
    for (let s = 0; s < nodes.length; s++) {
      const dist = dijkstra.run(nodes[s], isTarget, nodes.length);
      for (const i of byNode.get(nodes[s])) fillRow(D, M, pts, i, dist);
      if (Date.now() - last > 40) {
        if (onProgress) onProgress((s + 1) / nodes.length);
        await new Promise(resolve => setTimeout(resolve, 0));
        last = Date.now();
      }
    }
    return D;
  }
  function fillRow(D, M, pts, i, dist) {
    const pi = pts[i];
    for (let j = 0; j < M; j++) {
      if (i === j) continue;
      const pj = pts[j];
      D[i * M + j] = pj.node === pi.node ? Math.hypot(pi.x - pj.x, pi.y - pj.y) : pi.access + dist[pj.node] + pj.access;
    }
  }
  // Replace the distances of one point (used when the start moves).
  function updatePoint(g, D, pts, i) {
    const M = pts.length, isTarget = new Uint8Array(g.n);
    let count = 0;
    for (const p of pts) if (!isTarget[p.node]) { isTarget[p.node] = 1; count++; }
    fillRow(D, M, pts, i, makeDijkstra(g).run(pts[i].node, isTarget, count));
    for (let j = 0; j < M; j++) D[j * M + i] = D[i * M + j];
  }
  // Straight-line distance times a detour factor, for when no road data are used.
  function straightMatrix(pts, detour) {
    const M = pts.length, D = new Float32Array(M * M);
    for (let i = 0; i < M; i++) for (let j = i + 1; j < M; j++) {
      const d = detour * Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      D[i * M + j] = d; D[j * M + i] = d;
    }
    return D;
  }

  // ---------------------------------------------------------------- route simulation
  // D holds distances between M points: habitats 0 .. M-2, and the start at M-1.
  // Each team works on its own clock. The team that is free first picks its next habitat by the rule:
  //   'priority'  highest score per minute of driving plus service (the paper's priority per minute)
  //   'nearest'   the closest habitat
  //   'nearby'    among the k closest habitats, the highest score per minute
  //   'sequence'  a fixed order given in o.sequence (zigzag sweep, score order ...)
  // Teams do not return to the start at night; the clock simply runs on, as in the paper's simulations.
  // Options: o.zone gives each habitat a team; a team works in its own zone while habitats remain there.
  // o.daily makes teams return to the start each day: a visit is begun only if the team can finish it and
  // still drive back within the working day (o.hoursPerDay), and the next day begins at the start.
  // Result: visits in the order they are completed, with for each one the team, the time it is finished,
  // the point the team came from (a habitat, or M - 1 for the start) and the time it left that point.
  function simulate(o) {
    const D = o.D, M = o.M, n = M - 1, score = o.score, teams = Math.max(1, o.teams | 0);
    const speed = o.speedKmh / 3.6, service = o.serviceMin * 60, k = Math.max(1, o.k | 0);
    const daySeconds = (o.hoursPerDay || 8) * 3600, daily = !!o.daily, zone = o.zone || null;
    const visited = new Uint8Array(n), pos = new Int32Array(teams).fill(n), clock = new Float64Array(teams), today = new Int32Array(teams), left = new Int32Array(teams);
    const order = [], team = [], finish = [], leg = [], from = [], leave = [];
    const nearI = new Int32Array(k), nearD = new Float64Array(k);
    const perMinute = (j, d) => score[j] / Math.max(d / speed + service, 1e-9);
    if (zone) for (let j = 0; j < n; j++) left[zone[j]]++;
    let pointer = 0, remaining = n, drive = 0;
    while (remaining > 0) {
      let t = 0;
      for (let q = 1; q < teams; q++) if (clock[q] < clock[t]) t = q;
      const row = pos[t] * M, own = zone !== null && left[t] > 0;
      const open = j => !visited[j] && (!own || zone[j] === t);
      let next = -1;
      if (o.rule === 'sequence') next = o.sequence[pointer];
      else if (o.rule === 'nearest') {
        let best = Infinity;
        for (let j = 0; j < n; j++) if (open(j) && D[row + j] < best) { best = D[row + j]; next = j; }
      } else if (o.rule === 'nearby') {
        let count = 0;
        for (let j = 0; j < n; j++) {
          if (!open(j)) continue;
          const d = D[row + j];
          if (count === k && d >= nearD[k - 1]) continue;
          let p = count < k ? count++ : k - 1;
          while (p > 0 && nearD[p - 1] > d) { nearD[p] = nearD[p - 1]; nearI[p] = nearI[p - 1]; p--; }
          nearD[p] = d; nearI[p] = j;
        }
        let best = -1;
        for (let p = 0; p < count; p++) { const v = perMinute(nearI[p], nearD[p]); if (v > best) { best = v; next = nearI[p]; } }
      } else {
        let best = -1, bestD = Infinity;
        for (let j = 0; j < n; j++) {
          if (!open(j)) continue;
          const d = D[row + j], v = perMinute(j, d);
          if (v > best || (v === best && d < bestD)) { best = v; bestD = d; next = j; }
        }
      }
      const d = D[row + next], work = d / speed + service;
      if (daily && today[t] > 0 && clock[t] % daySeconds + work + D[next * M + n] / speed > daySeconds) {
        // not enough time left today: drive back, and begin tomorrow at the start
        drive += D[row + n];
        clock[t] = (Math.floor(clock[t] / daySeconds) + 1) * daySeconds;
        pos[t] = n; today[t] = 0;
        continue;
      }
      from.push(pos[t]); leave.push(clock[t]);
      clock[t] += work; visited[next] = 1; pos[t] = next; remaining--; today[t]++; drive += d;
      if (zone) left[zone[next]]--;
      if (o.rule === 'sequence') pointer++;
      order.push(next); team.push(t); finish.push(clock[t]); leg.push(d);
    }
    const by = order.map((_, i) => i).sort((a, b) => finish[a] - finish[b] || a - b), pick = list => by.map(i => list[i]);
    return { order: pick(order), team: pick(team), finish: pick(finish), leg: pick(leg), from: pick(from), leave: pick(leave), driveKm: drive / 1000 };
  }

  // One compact zone per team: k-means on habitat locations, started from points that lie far apart.
  function teamZones(x, y, teams) {
    const n = x.length, zone = new Int32Array(n);
    if (teams <= 1 || n === 0) return zone;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i] / n; my += y[i] / n; }
    const cx = [], cy = [], near = new Float64Array(n).fill(Infinity);
    let far = 0, best = -1;
    for (let i = 0; i < n; i++) { const d = Math.hypot(x[i] - mx, y[i] - my); if (d > best) { best = d; far = i; } }
    while (cx.length < teams) {
      cx.push(x[far]); cy.push(y[far]);
      best = -1;
      for (let i = 0; i < n; i++) {
        near[i] = Math.min(near[i], Math.hypot(x[i] - x[far], y[i] - y[far]));
        if (near[i] > best) { best = near[i]; far = i; }
      }
    }
    for (let round = 0; round < 40; round++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        let c = 0, d = Infinity;
        for (let q = 0; q < teams; q++) { const v = (x[i] - cx[q]) ** 2 + (y[i] - cy[q]) ** 2; if (v < d) { d = v; c = q; } }
        if (zone[i] !== c) { zone[i] = c; moved++; }
      }
      if (!moved && round) break;
      const sx = new Float64Array(teams), sy = new Float64Array(teams), count = new Int32Array(teams);
      for (let i = 0; i < n; i++) { sx[zone[i]] += x[i]; sy[zone[i]] += y[i]; count[zone[i]]++; }
      for (let q = 0; q < teams; q++) if (count[q]) { cx[q] = sx[q] / count[q]; cy[q] = sy[q] / count[q]; }
    }
    return zone;
  }

  // ---------------------------------------------------------------- street search (no map)
  // A team without a map must drive every street to find the habitats. The walk takes, at each road
  // point, the shortest street not yet driven; when none is left there, it drives to the nearest point
  // that still has one. (The same rule as the project's routing simulator, a greedy street-covering tour.)
  //   inArea(x, y): which streets count, by their midpoint. mustReach: road points that must be passed.
  function streetWalk(g, start, inArea, mustReach) {
    const E = g.edges, m = E.a.length, n = g.n, cover = new Uint8Array(m), must = new Uint8Array(n);
    for (const v of mustReach || []) must[v] = 1;
    const off = new Int32Array(n + 1);
    for (let e = 0; e < m; e++) { off[E.a[e] + 1]++; off[E.b[e] + 1]++; }
    for (let i = 0; i < n; i++) off[i + 1] += off[i];
    const other = new Int32Array(2 * m), edge = new Int32Array(2 * m), fill = new Int32Array(n), open = new Int32Array(n), flag = new Uint8Array(n);
    let need = 0;
    for (let e = 0; e < m; e++) {
      const a = E.a[e], b = E.b[e];
      let k = off[a] + fill[a]++; other[k] = b; edge[k] = e;
      k = off[b] + fill[b]++; other[k] = a; edge[k] = e;
      if (must[a] || must[b] || inArea((g.x[a] + g.x[b]) / 2, (g.y[a] + g.y[b]) / 2)) { cover[e] = 1; need++; open[a]++; open[b]++; }
    }
    for (let i = 0; i < n; i++) flag[i] = open[i] > 0 ? 1 : 0;
    const dijkstra = makeDijkstra(g), nodes = [start], cum = [0];
    let loc = start, done = 0, length = 0;
    while (done < need) {
      let next = -1, best = Infinity, be = -1;
      for (let k = off[loc]; k < off[loc + 1]; k++) {
        const e = edge[k];
        if (cover[e] === 1 && (E.len[e] < best || (E.len[e] === best && e < be))) { best = E.len[e]; be = e; next = other[k]; }
      }
      if (next >= 0) {
        cover[be] = 2; done++;
        if (--open[loc] === 0) flag[loc] = 0;
        if (--open[next] === 0) flag[next] = 0;
        length += best; nodes.push(next); cum.push(length); loc = next;
        continue;
      }
      const dist = dijkstra.run(loc, flag, 1), target = dijkstra.hit();
      if (target < 0) break;
      const way = dijkstra.trace(target);
      for (let i = 1; i < way.length; i++) { nodes.push(way[i]); cum.push(length + dist[way[i]]); }
      length += dist[target]; loc = target;
    }
    return { nodes, cum };
  }
  // The street search as a campaign: the walk is cut into one stretch per team; each team drives from the
  // start to its stretch, then treats every habitat it passes. Same result shape as simulate().
  //   o: {g, pts (habitats, then the start), walk, teams, speedKmh, serviceMin}
  function simulateStreetSearch(o) {
    const g = o.g, pts = o.pts, n = pts.length - 1, walk = o.walk, teams = Math.max(1, o.teams | 0);
    const speed = o.speedKmh / 3.6, service = o.serviceMin * 60, last = walk.nodes.length - 1, total = walk.cum[last];
    const daySeconds = (o.hoursPerDay || 8) * 3600, daily = !!o.daily;
    const at = new Map();
    for (let i = 0; i < n; i++) { const list = at.get(pts[i].node); if (list) list.push(i); else at.set(pts[i].node, [i]); }
    const fromStart = Float64Array.from(makeDijkstra(g).run(pts[n].node)), found = new Uint8Array(n), visits = [], starts = [], tracks = [];
    const home = v => pts[n].access + fromStart[v];   // road distance between the start and a road point
    let drive = 0, i = 0;
    for (let t = 0; t < teams; t++) {
      const end = t === teams - 1 ? total : total * (t + 1) / teams, times = [];
      let lead = home(walk.nodes[i]), clock = lead / speed, since = lead, moved = false;
      drive += lead;
      starts.push(i);
      for (let first = true; i <= last && (walk.cum[i] <= end || first); i++, first = false) {
        if (!first) {
          const d = walk.cum[i] - walk.cum[i - 1], here = walk.nodes[i - 1];
          if (daily && moved && clock % daySeconds + (d + home(walk.nodes[i])) / speed > daySeconds) {
            // no time left to go on and still get back: drive home, and come back to this point tomorrow
            drive += 2 * home(here); since += home(here);
            clock = (Math.floor(clock / daySeconds) + 1) * daySeconds + home(here) / speed;
            moved = false;
          }
          clock += d / speed; since += d; drive += d; moved = true;
        }
        times.push(clock);
        for (const h of at.get(walk.nodes[i]) || []) {
          if (found[h]) continue;
          found[h] = 1;
          clock += 2 * pts[h].access / speed + service;
          drive += 2 * pts[h].access;
          visits.push({ h, t, finish: clock, leg: since + pts[h].access, at: i });
          since = pts[h].access;
        }
      }
      tracks.push({ begin: starts[t], times });   // when the team reaches each point of its stretch of the walk
      if (i <= last) i--;   // the next team starts where this stretch ended
    }
    visits.sort((a, b) => a.finish - b.finish || a.h - b.h);
    return { order: visits.map(v => v.h), team: visits.map(v => v.t), finish: visits.map(v => v.finish), leg: visits.map(v => v.leg), driveKm: drive / 1000, missed: n - visits.length,
             at: visits.map(v => v.at), starts, tracks };
  }

  // South to north in bands, alternating west to east and east to west.
  function zigzagOrder(x, y, band) {
    let ymin = Infinity;
    for (const v of y) if (v < ymin) ymin = v;
    const row = Array.from(y, v => Math.floor((v - ymin) / band));
    // the direction turns at each band that holds habitats, so empty bands do not break the sweep
    const turn = new Map(Array.from(new Set(row)).sort((a, b) => a - b).map((r, i) => [r, i % 2]));
    return Array.from(x, (_, i) => i).sort((a, b) => row[a] - row[b] || (turn.get(row[a]) ? x[b] - x[a] : x[a] - x[b]) || a - b);
  }

  // Share of `values` reached by the end of each working day (index 0 = before work starts).
  function coverageByDay(sim, values, daySeconds) {
    const n = sim.order.length, days = n ? Math.max(1, Math.ceil(sim.finish[n - 1] / daySeconds - 1e-9)) : 0;
    const out = new Float64Array(days + 1);
    let total = 0, run = 0, i = 0;
    for (let j = 0; j < n; j++) total += values[sim.order[j]];
    for (let d = 1; d <= days; d++) {
      while (i < n && sim.finish[i] <= d * daySeconds + 1e-6) run += values[sim.order[i++]];
      out[d] = total > 0 ? run / total : 0;
    }
    return out;
  }
  // First day on which coverage is at or above the target share; null if never.
  function daysToTarget(byDay, target) {
    for (let d = 0; d < byDay.length; d++) if (byDay[d] >= target - 1e-12) return d;
    return null;
  }

  // ---------------------------------------------------------------- synthetic demo data
  // A smooth random surface over the unit square, used to make neighborhoods differ.
  function smoothField(rand, bumps) {
    const list = [];
    for (let i = 0; i < (bumps || 14); i++) list.push([rand(), rand(), 0.12 + 0.2 * rand(), normal(rand)]);
    return (u, v) => {
      let s = 0;
      for (const [cu, cv, r, a] of list) s += a * Math.exp(-((u - cu) ** 2 + (v - cv) ** 2) / (2 * r * r));
      return s;
    };
  }
  function standardize(values) {
    const n = values.length;
    let mean = 0, ss = 0;
    for (const v of values) mean += v / n;
    for (const v of values) ss += (v - mean) ** 2 / n;
    const sd = Math.sqrt(ss) || 1;
    return values.map(v => (v - mean) / sd);
  }

  // Habitats placed beside real roads (or in clusters when no roads are given), with larval counts
  // from a zero-inflated negative binomial distribution whose mean varies smoothly across the area.
  //   o: {rand, n, box: {x0, x1, y0, y1} in meters, graph, zeroShare, mean, k, clustering}
  function synthesize(o) {
    const rand = o.rand, box = o.box, w = box.x1 - box.x0, h = box.y1 - box.y0, xs = [], ys = [];
    const u = x => (x - box.x0) / w, v = y => (y - box.y0) / h;
    const density = smoothField(rand);
    const E = o.graph && o.graph.edges, picks = [];
    if (E) {
      const g = o.graph, mid = [];
      for (let e = 0; e < E.a.length; e++) {
        const mx = (g.x[E.a[e]] + g.x[E.b[e]]) / 2, my = (g.y[E.a[e]] + g.y[E.b[e]]) / 2;
        if (mx >= box.x0 && mx <= box.x1 && my >= box.y0 && my <= box.y1) { picks.push(e); mid.push(density(u(mx), v(my))); }
      }
      if (picks.length) {
        // more habitats along small streets, and in some neighborhoods than in others
        const z = standardize(mid), cum = new Float64Array(picks.length);
        let run = 0;
        picks.forEach((e, i) => { run += E.len[e] * (E.minor[e] ? 1 : 0.35) * Math.exp(0.8 * z[i]); cum[i] = run; });
        for (let i = 0; i < o.n; i++) {
          const target = rand() * run;
          let lo = 0, hi = picks.length - 1;
          while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < target) lo = m + 1; else hi = m; }
          const e = picks[lo], ax = g.x[E.a[e]], ay = g.y[E.a[e]], bx = g.x[E.b[e]], by = g.y[E.b[e]];
          const t = rand(), len = Math.hypot(bx - ax, by - ay) || 1, off = (8 + 27 * rand()) * (rand() < 0.5 ? -1 : 1);
          xs.push(ax + (bx - ax) * t - (by - ay) / len * off);
          ys.push(ay + (by - ay) * t + (bx - ax) / len * off);
        }
      }
    }
    if (!xs.length) {
      const parents = [];
      for (let i = 0; i < Math.max(4, Math.round(o.n / 25)); i++) parents.push([box.x0 + rand() * w, box.y0 + rand() * h]);
      const clamp = (value, a, b) => Math.min(b, Math.max(a, value));
      for (let i = 0; i < o.n; i++) {
        const p = parents[Math.floor(rand() * parents.length)];
        xs.push(clamp(p[0] + normal(rand) * 0.05 * w, box.x0, box.x1));
        ys.push(clamp(p[1] + normal(rand) * 0.05 * h, box.y0, box.y1));
      }
    }
    const field = smoothField(rand), z = standardize(xs.map((x, i) => field(u(x), v(ys[i])))), c = o.clustering;
    const count = xs.map((_, i) => {
      if (rand() < o.zeroShare) return 0;
      const mean = o.mean * Math.exp(c * z[i] - c * c / 2);
      return poisson(rand, gamma(rand, o.k) * mean / o.k);
    });
    return { x: xs, y: ys, count, usedRoads: picks.length > 0 };
  }

  // Scores for the demo. A fixed random basis lets the skill change smoothly without reshuffling.
  function skillBasis(count, rand) {
    const n = count.length, jitter = Array.from({ length: n }, () => rand());
    const sorted = Array.from({ length: n }, () => normal(rand)).sort((a, b) => a - b);
    const byCount = Array.from({ length: n }, (_, i) => i).sort((a, b) => count[a] - count[b] || jitter[a] - jitter[b]);
    const signal = new Float64Array(n);
    byCount.forEach((i, r) => { signal[i] = sorted[r]; });
    return { signal, noise: Array.from({ length: n }, () => normal(rand)) };
  }
  // Scores between 0 and 1 whose ranking has the wanted lift-ratio against the counts.
  // score = rank of (rho x signal + sqrt(1 - rho^2) x noise); rho is found by bisection.
  function scoresForSkill(count, basis, target) {
    const n = count.length;
    const latent = rho => Array.from({ length: n }, (_, i) => rho * basis.signal[i] + Math.sqrt(1 - rho * rho) * basis.noise[i]);
    const liftAt = rho => liftRatio(rankOrder(latent(rho)), count);
    let lo = -1, hi = 1;   // slightly negative values cancel a chance link between the noise and the counts
    for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (liftAt(mid) < target) lo = mid; else hi = mid; }
    const rho = (lo + hi) / 2, order = rankOrder(latent(rho)), score = new Array(n);
    order.forEach((i, r) => { score[i] = Math.round(1e4 * (n - r) / n) / 1e4; });
    return { score, rho, lift: liftRatio(order, count) };
  }

  // ---------------------------------------------------------------- reading a habitat list
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const sep = [',', ';', '\t'].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c.trim() !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    return rows;
  }
  const NAMES = {
    lat: ['lat', 'latitude', 'y'],
    lon: ['lon', 'lng', 'long', 'longitude', 'x'],
    score: ['score', 'priority', 'prediction', 'predicted', 'pred', 'productivity', 'productivityscore', 'predictedscore', 'weight', 'value'],
    observed: ['observed', 'obs', 'count', 'larvae', 'larvalcount', 'observedlarvae', 'observedcount'],
    id: ['id', 'name', 'habitat', 'habitatid', 'site', 'siteid'],
  };
  // Text of a CSV file -> {rows: [{id, lat, lon, score, observed}], skipped, clipped, hasObserved, error}
  function readHabitats(text) {
    const table = parseCsv(text);
    if (!table.length) return { error: 'The file is empty.' };
    const clean = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
    const header = table[0].map(clean), col = {};
    const numericFirst = table[0].slice(0, 3).every(c => c.trim() !== '' && isFinite(Number(c)));
    if (numericFirst) { col.lat = 0; col.lon = 1; col.score = 2; if (table[0].length > 3) col.observed = 3; }
    else {
      for (const key in NAMES) for (const name of NAMES[key]) { const at = header.indexOf(name); if (at >= 0 && col[key] === undefined) col[key] = at; }
      const missing = ['lat', 'lon', 'score'].filter(k => col[k] === undefined);
      if (missing.length) return { error: 'Missing column: ' + missing.join(', ') + '. The file needs lat, lon and score columns.' };
    }
    const rows = [];
    let skipped = 0, clipped = 0, observedSeen = 0;
    for (let r = numericFirst ? 0 : 1; r < table.length; r++) {
      const line = table[r], num = k => (col[k] === undefined || line[col[k]] === undefined || line[col[k]].trim() === '' ? NaN : Number(line[col[k]]));
      const lat = num('lat'), lon = num('lon');
      let score = num('score'), observed = num('observed');
      if (!isFinite(lat) || !isFinite(lon) || !isFinite(score) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; continue; }
      if (score < 0) { score = 0; clipped++; }
      if (isFinite(observed)) { observedSeen++; if (observed < 0) observed = 0; }
      rows.push({ id: col.id === undefined ? String(rows.length + 1) : String(line[col.id] || rows.length + 1).trim(), lat, lon, score, observed });
    }
    if (!rows.length) return { error: 'No usable rows. Each row needs a latitude, a longitude and a score.' };
    // observed counts are used only when every habitat has one
    const hasObserved = observedSeen === rows.length;
    if (!hasObserved) rows.forEach(row => { row.observed = NaN; });
    return { rows, skipped, clipped, hasObserved, partlyObserved: observedSeen > 0 && !hasObserved };
  }

  return {
    makeRandom, normal, gamma, poisson, rankOrder, coverageCurve, area, idealCurve, liftOfCurve, liftRatio, rankingCurve,
    haversine, projector, buildGraph, snap, makeDijkstra, roadMatrix, updatePoint, straightMatrix,
    simulate, teamZones, streetWalk, simulateStreetSearch, zigzagOrder, coverageByDay, daysToTarget, smoothField, standardize, synthesize, skillBasis, scoresForSkill,
    parseCsv, readHabitats, CITIES, boxAround, drivable, packRoads, unpackRoads,
  };
});
