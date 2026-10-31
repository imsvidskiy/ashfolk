import { writeFileSync } from "node:fs";
const N = 200000;
let state = 0x9e3779b9;
function next() { state = (state + 0x6d2b79f5) | 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const cases = {
  sin: () => Math.sin(next() * 2000 - 1000), cos: () => Math.cos(next() * 2000 - 1000), exp: () => Math.exp(next() * 40 - 20),
  log: () => Math.log(next() * 1000 + 1e-9), atan2: () => Math.atan2(next() * 2 - 1, next() * 2 - 1), hypot: () => Math.hypot(next() * 100, next() * 100),
  pow: () => Math.pow(next() * 10, next() * 4 - 2), sqrtSum: () => { const a = next() * 100, b = next() * 100; return Math.sqrt(a * a + b * b); },
};
for (const [name, fn] of Object.entries(cases)) { state = 0x9e3779b9; const a = new Float64Array(N); for (let i = 0; i < N; i++) a[i] = fn(); writeFileSync(`${process.argv[2]}-${name}.bin`, new Uint8Array(a.buffer)); }
