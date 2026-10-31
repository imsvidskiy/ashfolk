// fdlibm e_exp.c port using only exact ops and Float64Array/Uint32Array word access
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const halF = [0.5, -0.5], ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01], ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const invln2 = 1.44269504088896338700e+00, P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
function exactExp(x) {
  f64[0] = x; let hx = u32[1]; const xsb = (hx >>> 31) & 1; hx &= 0x7fffffff;
  if (hx >= 0x40862E42) { if (hx >= 0x7ff00000) return x + x; if (x > 7.09782712893383973096e+02) return Infinity; if (x < -7.45133219101941108420e+02) return 0; }
  let hi = 0, lo = 0, k = 0, t;
  if (hx > 0x3fd62e42) { if (hx < 0x3FF0A2B2) { hi = x - ln2HI[xsb]; lo = ln2LO[xsb]; k = 1 - xsb - xsb; } else { k = (invln2 * x + halF[xsb]) | 0; t = k; hi = x - t * ln2HI[0]; lo = t * ln2LO[0]; } x = hi - lo; }
  else if (hx < 0x3e300000) { return 1 + x; }
  t = x * x; const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
  const y = 1 - ((lo - (x * c) / (2.0 - c)) - hi);
  f64[0] = y; if (k >= -1021) { u32[1] += (k << 20); return f64[0]; } u32[1] += ((k + 1000) << 20); return f64[0] * 9.33263618503218878990e-302;
}
let maxDiff = 0; for (let i = 0; i < 1e5; i++) { const x = (i / 1e5 - 0.5) * 40; const a = exactExp(x), b = Math.exp(x); if (a !== b) maxDiff++; }
console.log("mismatches vs Math.exp in 1e5:", maxDiff);
const xs = Float64Array.from({ length: 1 << 20 }, (_, i) => ((i * 2654435761) % 1000) / 50 - 10);
function run(fn) { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < xs.length; i++) s += fn(xs[i]); const t0 = performance.now(); for (let r = 0; r < 10; r++) for (let i = 0; i < xs.length; i++) s += fn(xs[i]); return [((performance.now() - t0) / (10 * xs.length)) * 1e6, s]; }
console.log("Math.exp ns/call", run(Math.exp)[0].toFixed(2));
console.log("exactExp ns/call", run(exactExp)[0].toFixed(2));
