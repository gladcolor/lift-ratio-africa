/* Small SVG charts for the results site. Colors are CSS variables, so the charts follow the light or dark theme. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, attrs) {
    const t = el('text', Object.assign({ x, y, 'font-size': 12, fill: 'var(--ink-2)' }, attrs || {}), parent);
    t.textContent = s;
    return t;
  }
  const pct = v => Math.round(v * 100) + '%';
  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function tipFor(box) {
    let tip = box.querySelector('.tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; box.appendChild(tip); }
    return tip;
  }
  function placeTip(box, tip, x, y) {
    tip.hidden = false;
    const bw = box.clientWidth, tw = tip.offsetWidth;
    let left = x + 12;
    if (left + tw > bw) left = Math.max(0, x - tw - 12);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, y - 10) + 'px';
  }

  /* Coverage curves. series: [{name, color, dash, xs, ys}] on [0,1] x [0,1]; target: y value; marks: [{x, series}] */
  function coverage(box, opt) {
    box.innerHTML = '';
    const W = Math.max(300, box.clientWidth), H = Math.round(Math.min(340, Math.max(230, W * 0.5)));
    const m = { l: 56, r: 14, t: 10, b: 38 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opt.label || 'Coverage curves' }, box);
    const X = v => m.l + v * (W - m.l - m.r), Y = v => H - m.b - v * (H - m.t - m.b);
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      el('line', { x1: X(0), x2: X(1), y1: Y(v), y2: Y(v), stroke: 'var(--line)', 'stroke-width': 1 }, svg);
      text(svg, m.l - 6, Y(v) + 4, pct(v), { 'text-anchor': 'end' });
      text(svg, X(v), H - m.b + 16, pct(v), { 'text-anchor': 'middle' });
    }
    text(svg, X(0.5), H - 4, 'habitats visited', { 'text-anchor': 'middle' });
    text(svg, 11, Y(0.5), 'larvae reached', { 'text-anchor': 'middle', transform: `rotate(-90 11 ${Y(0.5)})` });
    if (opt.target != null) {
      el('line', { x1: X(0), x2: X(1), y1: Y(opt.target), y2: Y(opt.target), stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
      text(svg, X(1) - 2, Y(opt.target) + 15, 'target ' + pct(opt.target), { fill: 'var(--ink-2)', 'text-anchor': 'end', stroke: 'var(--surface)', 'stroke-width': 4, 'paint-order': 'stroke' });
    }
    for (const s of opt.series) {
      const d = s.xs.map((x, i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(s.ys[i]).toFixed(1)).join('');
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round' }, svg);
    }
    for (const mk of opt.marks || []) {
      const s = opt.series[mk.series];
      el('circle', { cx: X(mk.x), cy: Y(opt.target), r: 5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      text(svg, X(mk.x) + 8, Y(opt.target) + 17 + 13 * (mk.row || 0), mk.label, { fill: 'var(--ink)', 'font-size': 12, 'text-anchor': mk.anchor || 'start', stroke: 'var(--surface)', 'stroke-width': 4, 'paint-order': 'stroke' });
    }
    // crosshair and tooltip
    const cross = el('line', { y1: Y(1), y2: Y(0), stroke: 'var(--ink-2)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    const dots = opt.series.map(s => el('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
    const hit = el('rect', { x: X(0), y: Y(1), width: X(1) - X(0), height: Y(0) - Y(1), fill: 'transparent' }, svg);
    const tip = tipFor(box);
    const at = (s, x) => {
      let i = 1;
      while (i < s.xs.length - 1 && s.xs[i] < x) i++;
      const a = s.xs[i - 1], b = s.xs[i], f = b > a ? (x - a) / (b - a) : 0;
      return s.ys[i - 1] + f * (s.ys[i] - s.ys[i - 1]);
    };
    function move(ev) {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * W / r.width;
      const x = Math.min(1, Math.max(0, (sx - m.l) / (W - m.l - m.r)));
      cross.setAttribute('x1', X(x)); cross.setAttribute('x2', X(x)); cross.setAttribute('visibility', 'visible');
      let html = `<b>${pct(x)} of habitats visited</b>`;
      opt.series.forEach((s, k) => {
        const y = at(s, x);
        dots[k].setAttribute('cx', X(x)); dots[k].setAttribute('cy', Y(y)); dots[k].setAttribute('visibility', 'visible');
        html += `<br>${s.name}: ${(y * 100).toFixed(1)}% of larvae`;
      });
      tip.innerHTML = html;
      placeTip(box, tip, X(x) * r.width / W, (ev.clientY - r.top));
    }
    function leave() { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); tip.hidden = true; }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', leave);
  }

  /* Ranges: rows [{name, color, lo, mid, hi, note}] on a shared x axis. */
  function ranges(box, opt) {
    box.innerHTML = '';
    const W = Math.max(260, box.clientWidth), rowH = 30, m = { l: 124, r: 16, t: 6, b: 30 };
    const H = m.t + m.b + rowH * opt.rows.length;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opt.label || 'Ranges' }, box);
    const hi = Math.max(...opt.rows.map(r => r.hi)) * 1.05 || 1;
    const ticks = niceTicks(0, hi, 4), top = Math.max(hi, ticks[ticks.length - 1]);
    const X = v => m.l + v / top * (W - m.l - m.r);
    for (const v of ticks) {
      el('line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, stroke: 'var(--line)', 'stroke-width': 1 }, svg);
      text(svg, X(v), H - m.b + 15, String(v), { 'text-anchor': 'middle' });
    }
    text(svg, (m.l + W - m.r) / 2, H - 3, opt.unit || '', { 'text-anchor': 'middle' });
    const tip = tipFor(box);
    opt.rows.forEach((r, i) => {
      const y = m.t + rowH * i + rowH / 2;
      text(svg, m.l - 8, y + 4, r.name, { 'text-anchor': 'end', fill: 'var(--ink)' });
      el('line', { x1: X(r.lo), x2: X(r.hi), y1: y, y2: y, stroke: r.color, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-opacity': 0.35 }, svg);
      el('circle', { cx: X(r.mid), cy: y, r: 5, fill: r.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      const hit = el('rect', { x: 0, y: y - rowH / 2, width: W, height: rowH, fill: 'transparent' }, svg);
      hit.addEventListener('pointermove', ev => {
        const b = svg.getBoundingClientRect();
        tip.innerHTML = `<b>${r.name}</b><br>median ${r.mid.toFixed(1)}<br>10th to 90th percentile ${r.lo.toFixed(1)} to ${r.hi.toFixed(1)}${r.note ? '<br>' + r.note : ''}`;
        placeTip(box, tip, ev.clientX - b.left, ev.clientY - b.top);
      });
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
  }

  /* Histogram of values with an optional reference line. */
  function histogram(box, opt) {
    box.innerHTML = '';
    const vals = opt.values.filter(v => v != null && isFinite(v));
    const W = Math.max(260, box.clientWidth), H = 160, m = { l: 34, r: 12, t: 24, b: 30 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opt.label || 'Histogram' }, box);
    if (!vals.length) { text(svg, W / 2, H / 2, 'no values', { 'text-anchor': 'middle' }); return; }
    const lo = Math.min(opt.lo != null ? opt.lo : Infinity, ...vals), hi = Math.max(opt.hi != null ? opt.hi : -Infinity, ...vals);
    const raw = (hi - lo) / 10 || 0.01, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = opt.step || [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw);
    const a = Math.floor(lo / step) * step, nb = Math.max(1, Math.ceil((hi - a) / step + 1e-9));
    const counts = new Array(nb).fill(0);
    for (const v of vals) counts[Math.min(nb - 1, Math.floor((v - a) / step + 1e-9))]++;
    const cmax = Math.max(...counts);
    const X = v => m.l + (v - a) / (nb * step) * (W - m.l - m.r), Y = c => H - m.b - c / cmax * (H - m.t - m.b);
    const yt = niceTicks(0, cmax, 3);
    for (const c of yt) {
      if (c > cmax) continue;
      el('line', { x1: m.l, x2: W - m.r, y1: Y(c), y2: Y(c), stroke: 'var(--line)', 'stroke-width': 1 }, svg);
      text(svg, m.l - 5, Y(c) + 4, String(c), { 'text-anchor': 'end' });
    }
    const xt = niceTicks(a, a + nb * step, 5);
    for (const v of xt) text(svg, X(v), H - m.b + 15, opt.fmt ? opt.fmt(v) : String(v), { 'text-anchor': 'middle' });
    text(svg, (m.l + W - m.r) / 2, H - 3, opt.unit || '', { 'text-anchor': 'middle' });
    const tip = tipFor(box);
    counts.forEach((c, i) => {
      const x0 = X(a + i * step) + 1, x1 = X(a + (i + 1) * step) - 1, y = Y(c), w = Math.max(1, x1 - x0);
      if (c > 0) {
        const r = Math.min(4, w / 2, (Y(0) - y) / 2);
        el('path', { d: `M${x0} ${Y(0)}V${y + r}Q${x0} ${y} ${x0 + r} ${y}H${x1 - r}Q${x1} ${y} ${x1} ${y + r}V${Y(0)}Z`, fill: opt.color || 'var(--blue)' }, svg);
      }
      const hit = el('rect', { x: x0 - 1, y: m.t, width: w + 2, height: Y(0) - m.t, fill: 'transparent' }, svg);
      hit.addEventListener('pointermove', ev => {
        const b = svg.getBoundingClientRect(), f = opt.fmt || (v => v.toFixed(2));
        tip.innerHTML = `<b>${f(a + i * step)} to ${f(a + (i + 1) * step)}</b><br>${c} of ${vals.length} surveys`;
        placeTip(box, tip, ev.clientX - b.left, ev.clientY - b.top);
      });
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
    el('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: 'var(--line-2)', 'stroke-width': 1 }, svg);
    if (opt.ref != null) {
      el('line', { x1: X(opt.ref), x2: X(opt.ref), y1: m.t - 6, y2: Y(0), stroke: 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
      const right = X(opt.ref) > W * 0.7;
      text(svg, X(opt.ref) + (right ? -4 : 4), m.t - 10, opt.refLabel || '', { fill: 'var(--ink)', 'text-anchor': right ? 'end' : 'start' });
    }
  }

  window.Charts = { coverage, ranges, histogram, niceTicks };
})();
