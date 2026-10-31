const SIDE = 640;
const CELLS = SIDE * SIDE;
const BURNING = 20000;
const OFFSETS = [-SIDE - 1, -SIDE, -SIDE + 1, -1, 1, SIDE - 1, SIDE, SIDE + 1];

function time(label, runs, fn) {
  for (let i = 0; i < 5; i++) fn();
  const t = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const ms = (performance.now() - t) / runs;
  console.log(`${label}: ${ms.toFixed(3)} ms`);
  return ms;
}

const burning = new Int32Array(BURNING);
for (let i = 0; i < BURNING; i++) burning[i] = SIDE * 200 + ((i * 7919) % (SIDE * 200));
const height = new Float32Array(CELLS).map((_, i) => (i % 97) * 0.3);

class CellSet {
  constructor(n) { this.cells = new Int32Array(n); this.isMember = new Uint8Array(n); this.size = 0; }
  add(c) { if (this.isMember[c] === 1) return; this.isMember[c] = 1; this.cells[this.size++] = c; }
  clear() { for (let i = 0; i < this.size; i++) this.isMember[this.cells[i]] = 0; this.size = 0; }
}

const heat = new Float32Array(CELLS);
const heated = new CellSet(CELLS);
const fire = new Float32Array(CELLS);

function rawSpread() {
  for (let i = 0; i < BURNING; i++) {
    const cell = burning[i];
    for (let n = 0; n < 8; n++) {
      const nb = cell + OFFSETS[n];
      if (fire[nb] > 0) continue;
      const rise = (height[nb] - height[cell]) * 0.1;
      const f = Math.min(3, Math.max(0.4, Math.exp(0.8 * rise)));
      heat[nb] += 0.01 * f;
      heated.add(nb);
    }
  }
  heated.clear();
}

const rowDirty = new Uint8Array(SIDE);
const defs = [];
const arrays = [];
const sets = [];
function define(type, min, max, snap, frameRows, active) {
  const a = type === "f32" ? new Float32Array(CELLS) : type === "u8" ? new Uint8Array(CELLS) : new Uint16Array(CELLS);
  defs.push({ min, max, snap, frameRows, active });
  arrays.push(a);
  sets.push(active ? new CellSet(CELLS) : null);
  return defs.length - 1;
}
const FIRE = define("f32", 0, 1, 0.02, true, true);
const HEAT = define("f32", 0, 100, 0.002, false, true);
const WET = define("f32", 0, 1, 0, true, false);
const SNOW = define("f32", 0, 1.2, 0, true, false);
const GERMS = define("u16", 0, 65535, 0, false, true);
const CROP = define("u8", 0, 255, 0, true, false);

const fields = {
  value(key, cell) { return arrays[key][cell]; },
  add(key, cell, amount) {
    const d = defs[key];
    const a = arrays[key];
    let v = a[cell] + amount;
    if (v < d.min) v = d.min; else if (v > d.max) v = d.max;
    if (v < d.snap) v = 0;
    a[cell] = v;
    const s = sets[key];
    if (s !== null && v !== 0) s.add(cell);
    if (d.frameRows) rowDirty[(cell / SIDE) | 0] = 1;
  },
};
// warm polymorphism: other fields of other element kinds go through the same accessor
for (let i = 0; i < 1000; i++) { fields.add(GERMS, i, 1); fields.add(CROP, i, 1); fields.add(WET, i, 0.1); fields.add(SNOW, i, 0.1); fields.value(GERMS, i); fields.value(CROP, i); }

function genericSpread() {
  for (let i = 0; i < BURNING; i++) {
    const cell = burning[i];
    for (let n = 0; n < 8; n++) {
      const nb = cell + OFFSETS[n];
      if (fields.value(FIRE, nb) > 0) continue;
      const rise = (height[nb] - height[cell]) * 0.1;
      const f = Math.min(3, Math.max(0.4, Math.exp(0.8 * rise)));
      fields.add(HEAT, nb, 0.01 * f);
    }
  }
  sets[HEAT].clear();
  arrays[HEAT].fill(0);
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const LN2HI = 6.93147180369123816490e-1, LN2LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700;
const P1 = 1.66666666666666019037e-1, P2 = -2.77777777770155933842e-3, P3 = 6.61375632143793436117e-5, P4 = -1.65339022054652515390e-6, P5 = 4.13813679705723846039e-8;
function exactExp(x) {
  let hi = 0, lo = 0, k = 0;
  const ax = Math.abs(x);
  if (ax > 0.34657359027997264) {
    if (ax < 1.0397207708399179) { k = x < 0 ? -1 : 1; hi = x - k * LN2HI; lo = k * LN2LO; }
    else { k = Math.trunc(INVLN2 * x + (x < 0 ? -0.5 : 0.5)); hi = x - k * LN2HI; lo = k * LN2LO; }
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) { return 1 + x; }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  f64[0] = 1 - ((lo - (x * c) / (2 - c)) - hi);
  u32[1] += k << 20;
  return f64[0];
}
function exactSpread() {
  for (let i = 0; i < BURNING; i++) {
    const cell = burning[i];
    for (let n = 0; n < 8; n++) {
      const nb = cell + OFFSETS[n];
      if (fire[nb] > 0) continue;
      const rise = (height[nb] - height[cell]) * 0.1;
      const f = Math.min(3, Math.max(0.4, exactExp(0.8 * rise)));
      heat[nb] += 0.01 * f;
      heated.add(nb);
    }
  }
  heated.clear();
}

console.log(`--- fire spread, ${BURNING} burning cells x 8 neighbours ---`);
time("raw arrays + CellSet (today's shape)", 50, rawSpread);
time("generic Fields.add/value (clamp, snap, set, dirty, polymorphic)", 50, genericSpread);
time("raw arrays + fdlibm-style exp", 50, exactSpread);

console.log("--- exposure clear at end of tick ---");
const exposures = [new Float32Array(CELLS), new Float32Array(CELLS), new Float32Array(CELLS), new Float32Array(CELLS)];
time("dense fill(0) of 4 exposure fields (640^2)", 200, () => { for (const e of exposures) e.fill(0); });
const stamped = new Int32Array(600).map((_, i) => 200 * SIDE + i * 3);
time("clear only 600 stamped cells x 4", 200, () => { for (const e of exposures) for (let i = 0; i < stamped.length; i++) e[stamped[i]] = 0; });

console.log("--- state hash of a 512k-slot plant table (40 B/slot) ---");
function fmix32(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
function hashWords(words, seed) {
  let h = seed | 0;
  for (let i = 0; i < words.length; i++) {
    let k = Math.imul(words[i], 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
    h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  return fmix32(h ^ words.length);
}
const SLOTS = Math.round(CELLS * 1.25);
const plantColumns = [];
for (let c = 0; c < 10; c++) { const a = new Uint32Array(SLOTS); for (let i = 0; i < SLOTS; i++) a[i] = i * 2654435761 + c; plantColumns.push(a); }
time(`hash ${SLOTS} slots x 10 words`, 20, () => { let h = 0; for (const a of plantColumns) h = hashWords(a, h); return h; });

console.log("--- visitor dispatch over 300k anchored candidates ---");
const ids = new Int32Array(300000).map((_, i) => i);
const species = new Uint8Array(300000).map((_, i) => i % 28);
function makeVisitor(k) { return new Function("species", `return { n: 0, k${k}: ${k}, visit(id, d) { if (species[id] === ${k}) this.n++; return true; } };`)(species); }
const visitors = Array.from({ length: 12 }, (_, k) => makeVisitor(k));
function visitAll(visitor) { for (let i = 0; i < ids.length; i++) if (!visitor.visit(ids[i], i)) break; }
for (const v of visitors) visitAll(v);
time("one visitor at the call site after 12 shapes (megamorphic)", 50, () => visitAll(visitors[3]));
function countInline(k) { let n = 0; for (let i = 0; i < ids.length; i++) if (species[ids[i]] === k) n++; return n; }
time("inline count loop", 50, () => countInline(3));
