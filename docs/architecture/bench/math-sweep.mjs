const N = 200000;
let state = 0x9e3779b9;
function next() { state = (state + 0x6d2b79f5) | 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const f64 = new Float64Array(1); const u32 = new Uint32Array(f64.buffer);
function mix(h, v) { f64[0] = v; h = Math.imul(h ^ u32[0], 0x01000193); return Math.imul(h ^ u32[1], 0x01000193); }
const cases = {
  sin: () => Math.sin(next() * 2000 - 1000),
  cos: () => Math.cos(next() * 2000 - 1000),
  exp: () => Math.exp(next() * 40 - 20),
  log: () => Math.log(next() * 1000 + 1e-9),
  atan2: () => Math.atan2(next() * 2 - 1, next() * 2 - 1),
  hypot: () => Math.hypot(next() * 100, next() * 100),
  pow: () => Math.pow(next() * 10, next() * 4 - 2),
  sqrt: () => Math.sqrt(next() * 1e6),
  mulAdd: () => next() * next() + next() / (next() + 1),
};
const out = {};
for (const [name, fn] of Object.entries(cases)) { state = 0x9e3779b9; let h = 0x811c9dc5; for (let i = 0; i < N; i++) h = mix(h, fn()); out[name] = (h >>> 0).toString(16); }
out.fp = [Math.sin(-1e300), Math.cos(10.000000000123), Math.pow(Math.PI, -100), Math.exp(1), Math.tan(-1e300)].join(",");
console.log(JSON.stringify(out));
