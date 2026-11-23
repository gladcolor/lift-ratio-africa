/* Lift-ratio math for the results site.
   model(pi, mu, k): the zero-inflated negative binomial count distribution, its Gini coefficient, and the
     large-city formulas for a Gaussian-copula model (rho for a lift-ratio, coverage).
   Bench(N, R): R synthetic surveys of N habitats with fixed random numbers, so results move smoothly with the
     settings; it gives the realized lift-ratio of a copula model, and the habitats needed to reach a target share
     of the larvae in the ideal, model and random orders. */
(function () {
  'use strict';
  function Phi(x) {                              // standard normal distribution function (|error| < 1e-7)
    const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp(-x * x / 2);
    const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
  }
  function PhiInv(p) {                           // Acklam's inverse normal (relative error < 1.2e-9)
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    if (p <= 0) return -40; if (p >= 1) return 40;
    if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function model(pi, mu, k) {
    const r = mu / (k + mu), p = [];
    let nb = Math.pow(k / (k + mu), k), F = pi + (1 - pi) * nb, mean = 0, y = 0;
    p.push(F);
    while (y < 400000) {
      y++;
      nb *= (y - 1 + k) / y * r;
      const py = (1 - pi) * nb;
      p.push(py); F += py; mean += y * py;
      if (y > mu && 1 - F < 1e-11) break;
    }
    let G = 0, Fc = 0;
    for (let i = 0; i < p.length; i++) { Fc += p[i]; G += Fc * (1 - Fc); }
    G /= mean;
    const Z = [], W2 = [];
    let Fm = 0;
    for (let i = 0; i < p.length; i++) {
      const py = p[i];
      if (py < 1e-15) { Fm += py; continue; }
      const M = Math.min(240, Math.max(2, Math.ceil(py * 900)));
      for (let j = 0; j < M; j++) { Z.push(PhiInv(Fm + (j + 0.5) / M * py)); W2.push((i - mean) * py / M); }
      Fm += py;
    }
    const Zf = Float64Array.from(Z), W2f = Float64Array.from(W2);
    let den = 0;
    for (let i = 0; i < Zf.length; i++) den += W2f[i] * (Phi(Zf[i]) - 0.5);
    const lift = rho => {
      if (rho >= 1) return 1;
      const s = 1 / Math.sqrt(2 - rho * rho);
      let num = 0;
      for (let i = 0; i < Zf.length; i++) num += W2f[i] * (Phi(rho * Zf[i] * s) - 0.5);
      return num / den;
    };
    const rhoFor = L => {
      if (L <= 0) return 0; if (L >= 1) return 1;
      let lo = 0, hi = 1;
      for (let it = 0; it < 36; it++) { const m = (lo + hi) / 2; if (lift(m) < L) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    const cum = new Float64Array(p.length);
    let cc = 0;
    for (let i = 0; i < p.length; i++) { cc += p[i]; cum[i] = cc; }
    return { p: Float64Array.from(p), cum, mean, G, p0: p[0], pPlus: 1 - p[0], lift, rhoFor };
  }

  // ------------------------------------------------------------------ synthetic surveys
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function Bench(N, R, seed) {
    const r = rng(seed || 7), n = N * R;
    this.N = N; this.R = R;
    this.U = new Float64Array(n); this.V = new Float64Array(n); this.E = new Float64Array(n); this.X = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.U[i] = r(); this.V[i] = r();
      const u1 = Math.max(1e-12, r()), u2 = r();
      this.E[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      this.X[i] = r();
    }
    this.y = new Float64Array(n); this.Q = new Float64Array(n); this.yc = new Float64Array(n);
    this.tot = new Float64Array(R); this.den = new Float64Array(R); this.ok = new Uint8Array(R);
    this.idx = new Int32Array(N); this.key = new Float64Array(N);
  }
  // counts and normal scores for a distribution (from the fixed random numbers)
  Bench.prototype.setModel = function (M) {
    const { N, R } = this, p = M.p, cum = M.cum, top = cum[cum.length - 1];
    for (let s = 0; s < R; s++) {
      let tot = 0;
      for (let j = 0; j < N; j++) {
        const i = s * N + j, u = this.U[i] * top;
        let lo = 0, hi = cum.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] >= u) hi = m; else lo = m + 1; }
        this.y[i] = lo;
        this.Q[i] = PhiInv(Math.min(1 - 1e-15, Math.max(1e-15, (lo > 0 ? cum[lo - 1] : 0) + this.V[i] * p[lo])));
        tot += lo;
      }
      this.tot[s] = tot;
      this.ok[s] = tot > 0 ? 1 : 0;
      const mean = tot / N;
      for (let j = 0; j < N; j++) this.yc[s * N + j] = this.y[s * N + j] - mean;
      // denominator of the lift-ratio: covariance of counts with their own average ranks
      const idx = this.idx, base = s * N, y = this.y;
      for (let j = 0; j < N; j++) idx[j] = j;
      idx.sort((a, b) => y[base + a] - y[base + b]);
      let den = 0, j = 0;
      while (j < N) {
        let e = j;
        while (e + 1 < N && y[base + idx[e + 1]] === y[base + idx[j]]) e++;
        const rk = (j + e) / 2 + 1;
        for (let t = j; t <= e; t++) den += this.yc[base + idx[t]] * rk;
        j = e + 1;
      }
      this.den[s] = den;
    }
    this.cache = {};
  };
  Bench.prototype.keys = function (s, mode, rho) {
    const { N } = this, base = s * N, key = this.key;
    if (mode === 'ideal') for (let j = 0; j < N; j++) key[j] = this.y[base + j] + 0.5 * this.V[base + j];
    else if (mode === 'random') for (let j = 0; j < N; j++) key[j] = this.X[base + j];
    else { const c = Math.sqrt(Math.max(0, 1 - rho * rho)); for (let j = 0; j < N; j++) key[j] = rho * this.Q[base + j] + c * this.E[base + j]; }
    const idx = this.idx;
    for (let j = 0; j < N; j++) idx[j] = j;
    idx.sort((a, b) => key[b] - key[a]);       // descending
    return idx;
  };
  // realized lift-ratio of the copula model with correlation rho: mean and SD over the surveys
  Bench.prototype.lift = function (rho) {
    const k = 'L' + rho.toFixed(6);
    if (this.cache[k]) return this.cache[k];
    const { N, R } = this;
    let s1 = 0, s2 = 0, n = 0;
    for (let s = 0; s < R; s++) {
      if (!this.ok[s] || this.den[s] <= 0) continue;
      const idx = this.keys(s, 'model', rho), base = s * N;
      let num = 0;
      for (let t = 0; t < N; t++) num += this.yc[base + idx[t]] * (N - t);   // rank N for the top score
      const L = num / this.den[s];
      s1 += L; s2 += L * L; n++;
    }
    const mean = s1 / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean) * n / Math.max(1, n - 1));
    return (this.cache[k] = { mean, sd, n });
  };
  // rho at which the realized lift-ratio averages L (secant steps from the large-city value)
  Bench.prototype.rhoFor = function (L, rho0) {
    if (L <= 0) return 0;
    let r0 = 0, l0 = 0, r1 = Math.min(0.9999, Math.max(0.01, rho0)), l1 = this.lift(r1).mean;
    for (let it = 0; it < 6 && Math.abs(l1 - L) > 0.002 && r1 < 0.9999; it++) {
      let r2 = l1 !== l0 ? r1 + (L - l1) * (r1 - r0) / (l1 - l0) : r1 * L / Math.max(l1, 1e-6);
      r2 = Math.min(0.9999, Math.max(0, r2));
      r0 = r1; l0 = l1; r1 = r2; l1 = this.lift(r1).mean;
    }
    return r1;
  };
  // habitats needed per survey to reach a share T of the larvae; optional coverage curve on a grid of shares
  Bench.prototype.need = function (mode, rho, T, grid) {
    const { N, R } = this, out = new Float64Array(R).fill(NaN), curve = grid ? new Float64Array(grid.length) : null;
    let nc = 0;
    for (let s = 0; s < R; s++) {
      if (!this.ok[s]) continue;
      const idx = this.keys(s, mode, rho), base = s * N, goal = T * this.tot[s] - 1e-9;
      let c = 0, t = 0, g = 0;
      for (; t < N; t++) {
        c += this.y[base + idx[t]];
        if (curve) while (g < grid.length && Math.round(grid[g] * N) <= t + 1) { if (Math.round(grid[g] * N) === t + 1) curve[g] += c / this.tot[s]; g++; }
        if (c >= goal && out[s] !== out[s]) { out[s] = t + 1; if (!curve) break; }
      }
      if (curve) nc++;
    }
    if (curve) for (let g = 0; g < grid.length; g++) curve[g] = grid[g] <= 0 ? 0 : curve[g] / nc;
    return { need: out, curve };
  };
  const meanOf = a => { let s = 0, n = 0; for (const v of a) if (v === v) { s += v; n++; } return n ? s / n : NaN; };

  window.Theory = { Phi, PhiInv, model, Bench, meanOf };
})();
