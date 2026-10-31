const SIDE = 640, CELLS = SIDE * SIDE;
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry(7);
function time(label, runs, body) { let sink = 0; for (let i = 0; i < 5; i++) sink += body(); const s = performance.now(); for (let i = 0; i < runs; i++) sink += body(); const per = (performance.now() - s) / runs; console.log(`${label.padEnd(70)} ${(per * 1000).toFixed(1).padStart(10)} us  (${sink % 7})`); return per; }

// ---------- 1. surface sweep: raw vs Field interface ----------
const snow = new Float32Array(CELLS), wet = new Float32Array(CELLS);
const temp = Float32Array.from({ length: CELLS }, () => -5 + rnd() * 20);
for (let i = 0; i < CELLS; i++) wet[i] = rnd() * 0.5;
const ROWS = 32, FIRST = 100 * SIDE, END = FIRST + ROWS * SIDE;
function rawSweep() { let changed = 0; for (let c = FIRST; c < END; c++) { const t = temp[c]; let s = snow[c], w = wet[c]; const s0 = s, w0 = w; if (t < 0) s = Math.fround(Math.min(1.2, s + 0.001)); else w = Math.fround(Math.min(1, w + 0.002)); if (s > 0 && t > 0) { s = Math.fround(Math.max(0, s - 0.0005)); w = Math.fround(Math.min(1, w + 0.0004)); } snow[c] = s; wet[c] = w; if (s !== s0 || w !== w0) changed++; } return changed; }

class ActiveSet { constructor(n) { this.cells = new Int32Array(n); this.member = new Uint8Array(n); this.size = 0; } add(c) { if (this.member[c] === 1) return; this.member[c] = 1; this.cells[this.size++] = c; } }
function makeField(Kind, values, max, floor) { return new Kind(values, max, floor); }
class DenseField { constructor(v, max, floor) { this.values = v; this.max = max; this.floor = floor; this.active = new ActiveSet(CELLS); this.rows = new Uint8Array(SIDE); } value(c) { return this.values[c]; } set(c, x) { let v = x > this.max ? this.max : x; if (v < this.floor) v = 0; const old = this.values[c]; if (old === Math.fround(v)) return; this.values[c] = v; if (v > 0) this.active.add(c); this.rows[(c / SIDE) | 0] = 1; } add(c, a) { this.set(c, this.values[c] + a); } }
class SparseField extends DenseField { set(c, x) { let v = x > this.max ? this.max : x; if (v < this.floor) v = 0; const old = this.values[c]; if (old === Math.fround(v)) return; this.values[c] = v; if (v > 0) this.active.add(c); this.rows[(c / SIDE) | 0] = 1; this.dirty = true; } }
class DerivedField extends DenseField { value(c) { return this.values[c] * 1; } }
class ExposureField extends DenseField { set(c, x) { this.values[c] = x; this.active.add(c); } }
const sf = new DenseField(snow, 1.2, 0), wf = new DenseField(wet, 1, 0);
function fieldSweep(sF, wF) { let changed = 0; for (let c = FIRST; c < END; c++) { const t = temp[c]; const s0 = sF.value(c), w0 = wF.value(c); if (t < 0) sF.add(c, 0.001); else wF.add(c, 0.002); if (sF.value(c) > 0 && t > 0) { sF.add(c, -0.0005); wF.add(c, 0.0004); } if (sF.value(c) !== s0 || wF.value(c) !== w0) changed++; } return changed; }
// warm megamorphic: same call site sees 4 classes
const poly = [new DenseField(new Float32Array(CELLS),1,0), new SparseField(new Float32Array(CELLS),1,0.02), new DerivedField(new Float32Array(CELLS),1,0), new ExposureField(new Float32Array(CELLS),1,0)];
for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) fieldSweep(poly[k], poly[j]);
console.log("--- 1. surface sweep, 32 rows x 640 = 20,480 cells, 2 fields (per tick) ---");
time("raw Float32Array writes (today)", 400, rawSweep);
time("Field.value/add with clamp+floor+active+row mark (mono)", 400, () => fieldSweep(sf, wf));
const sp = new SparseField(snow, 1.2, 0), wp = new ExposureField(wet, 1, 0);
time("Field.value/add, call site saw 4 Field classes (megamorphic)", 400, () => fieldSweep(sp, wp));

// ---------- 2. reaction pass ----------
function unitHash(seed, a, b, c) { let h = seed ^ Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d); h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
const fire = new Float32Array(CELLS), ground = new Uint8Array(CELLS), acid = new Float32Array(CELLS);
const landActive = new Int32Array(250000); for (let i = 0; i < landActive.length; i++) landActive[i] = Math.floor(i * CELLS / 250000);
const fireActive = new Int32Array(5000); for (let i = 0; i < 5000; i++) { const c = 200 * SIDE + (i % 100) + Math.floor(i / 100) * SIDE; fireActive[i] = c; fire[c] = 0.5; }
const cellsApi = { field: (d) => d === "fire" ? fire : d === "wetness" ? wet : acid };
const reactions = [
  { id: 1, when: (cs, c) => fire[c] > 0, apply: (cs, c, t, ch) => { if (ch < wet[c]) fire[c] *= 0.9; } },
  { id: 2, when: (cs, c) => wet[c] > 0.3 && ground[c] === 3, apply: (cs, c, t, ch) => { if (ch < 0.001) ground[c] = 4; } },
  { id: 3, when: (cs, c) => wet[c] > 0.6 && temp[c] > 5, apply: (cs, c, t, ch) => { if (ch < 0.01) acid[c] += 0.001; } },
];
function reactionPass(active, n, tick) { let hits = 0; for (let r = 0; r < reactions.length; r++) { const re = reactions[r]; for (let i = 0; i < n; i++) { const c = active[i]; if (!re.when(cellsApi, c)) continue; hits++; re.apply(cellsApi, c, tick, unitHash(7, tick, c, re.id)); } } return hits; }
let tk = 0;
console.log("--- 2. reaction pass (per tick) ---");
time("3 reactions driven by wetness, 250k active land cells (rain)", 40, () => reactionPass(landActive, landActive.length, tk++));
function oneReactionFire() { let hits = 0; for (let i = 0; i < 5000; i++) { const c = fireActive[i]; if (fire[c] > 0) { hits++; if (unitHash(7, tk, c, 1) < wet[c]) fire[c] *= 0.9; } } return hits; }
time("soak-douses-fire driven by fire set instead (5k burning cells)", 400, () => { tk++; return oneReactionFire(); });
// with tags lookup: rule reads every field tagged wet
const wetTagged = [wet, acid];
function soakAllTagged() { let hits = 0; for (let i = 0; i < 5000; i++) { const c = fireActive[i]; let w = 0; for (let k = 0; k < wetTagged.length; k++) w += wetTagged[k][c]; if (unitHash(7, tk, c, 1) < w) { fire[c] *= 0.9; hits++; } } return hits; }
time("same, summing 2 fields tagged 'wet'", 400, () => { tk++; return soakAllTagged(); });

// ---------- 3. stats.effective ----------
const N_PLANTS = 512000; const species = new Uint8Array(N_PLANTS); const born = new Float32Array(N_PLANTS); const pcell = new Int32Array(N_PLANTS);
for (let i = 0; i < N_PLANTS; i++) { species[i] = (rnd() * 28) | 0; born[i] = rnd() * 100; pcell[i] = (rnd() * CELLS) | 0; }
const baseWR = Float32Array.from({ length: 28 }, () => rnd());
const modifiers = [ { applies: (ref) => true, modify: (v, ref) => v * (1 - 0.3 * wet[pcell[ref]]) }, { applies: (ref) => born[ref] < 50, modify: (v, ref) => v * 0.8 }, { applies: (ref) => false, modify: (v) => v + 0.1 } ];
function effective(stat, ref) { let v = stat[species[ref]]; for (let m = 0; m < modifiers.length; m++) { const mod = modifiers[m]; if (mod.applies(ref)) v = mod.modify(v, ref); } return v; }
console.log("--- 3. stats.effective ---");
time("effective() over 600 plants (tornado core, per tick)", 2000, () => { let s = 0; for (let i = 0; i < 600; i++) s += effective(baseWR, i * 800); return s; });
time("effective() over all 512k plants (if a growth/fire pass used it)", 10, () => { let s = 0; for (let i = 0; i < N_PLANTS; i++) s += effective(baseWR, i); return s; });
time("base lookup only over 512k plants", 10, () => { let s = 0; for (let i = 0; i < N_PLANTS; i++) s += baseWR[species[i]]; return s; });

// ---------- 4. summarize ----------
const height = Float32Array.from({ length: CELLS }, () => rnd() * 300); const biome = Uint8Array.from({ length: CELLS }, () => (rnd() * 13) | 0); const heat = new Float32Array(CELLS);
const first = new Int32Array(CELLS).fill(-1), next = new Int32Array(N_PLANTS).fill(-1);
for (let i = N_PLANTS - 1; i >= 0; i--) { const c = pcell[i]; next[i] = first[c]; first[c] = i; }
// forest patch: 5 plants per cell around (3200,3200)
const TYPES = 64; const typeCounts = new Uint16Array(TYPES); const biomeShares = new Float32Array(13);
function summarize(x, z, r) { typeCounts.fill(0); biomeShares.fill(0); const cs = 10; const r2 = r * r; const c0 = Math.max(0, Math.floor((x - r) / cs)), c1 = Math.min(SIDE - 1, Math.floor((x + r) / cs)); const r0 = Math.max(0, Math.floor((z - r) / cs)), r1 = Math.min(SIDE - 1, Math.floor((z + r) / cs)); let n = 0, maxFire = 0, sumHeat = 0, sumSlope = 0, water = 0, plants = 0; for (let row = r0; row <= r1; row++) { const dz = (row + 0.5) * cs - z; for (let col = c0; col <= c1; col++) { const dx = (col + 0.5) * cs - x; if (dx * dx + dz * dz > r2) continue; const c = row * SIDE + col; n++; biomeShares[biome[c]] += 1; if (fire[c] > maxFire) maxFire = fire[c]; sumHeat += heat[c]; const gx = height[c + 1] - height[c - 1], gz = height[c + SIDE] - height[c - SIDE]; sumSlope += Math.sqrt(gx * gx + gz * gz) / 20; if (wet[c] > 0.99) water++; for (let p = first[c]; p !== -1; p = next[p]) { typeCounts[species[p]]++; plants++; } } } for (let b = 0; b < 13; b++) biomeShares[b] /= n; return plants + n; }
console.log("--- 4. summarize (fields + plant type counts, no movers) ---");
time("summarize r=45 m (tornado default)", 20000, () => summarize(3200, 3200, 45));
time("summarize r=140 m (tornado max)", 5000, () => summarize(3200, 3200, 140));
time("5,000 agents each summarize r=30 m (if used per agent per tick)", 20, () => { let s = 0; for (let a = 0; a < 5000; a++) s += summarize(500 + (a % 70) * 80, 500 + ((a / 70) | 0) * 80, 30); return s; });

// ---------- 5. hashing ----------
function hash32(u32, start, end, h) { for (let i = start; i < end; i++) { let k = Math.imul(u32[i], 0xcc9e2d51); k = (k << 15) | (k >>> 17); h ^= Math.imul(k, 0x1b873593); h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0; } return h; }
const wetU = new Uint32Array(wet.buffer); const snowU = new Uint32Array(snow.buffer);
function chunk(u, cx, cz, h) { for (let r = 0; r < 64; r++) { const s = (cz * 64 + r) * SIDE + cx * 64; h = hash32(u, s, s + 64, h); } return h; }
console.log("--- 5. state hash ---");
time("rehash 10 dirty 64x64 chunks x 3 fields (one surface tick)", 2000, () => { let h = 0; for (let k = 0; k < 10; k++) { h = chunk(wetU, k, 1, h); h = chunk(snowU, k, 1, h); h = chunk(wetU, k, 2, h); } return h; });
const plantBytes = new Uint32Array(N_PLANTS * 10);
time("hash whole plant store (512k x 40 B = 20 MB)", 10, () => hash32(plantBytes, 0, plantBytes.length, 0));
time("hash 10 whole float fields at 640^2", 10, () => { let h = 0; for (let k = 0; k < 5; k++) { h = hash32(wetU, 0, CELLS, h); h = hash32(snowU, 0, CELLS, h); } return h; });

// ---------- 6. events per harmed thing ----------
const queue = []; 
console.log("--- 6. impact events ---");
time("emit thingHarmed {thing,cause,amount,x,z} for 300 things + drain", 5000, () => { for (let i = 0; i < 300; i++) queue.push({ amount: 0.01, cause: "fire", kind: 2, slot: i, generation: 1, x: i, z: i }); let s = 0; for (const e of queue) s += e.slot; queue.length = 0; return s; });
