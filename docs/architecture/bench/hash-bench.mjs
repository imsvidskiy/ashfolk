const CELLS = 640 * 640;
const LAYERS = 10;
const layers = Array.from({ length: LAYERS }, (_, l) => { const a = new Float32Array(CELLS); for (let i = 0; i < CELLS; i++) a[i] = (i * 0.37 + l) % 13.1; return a; });
function fmix32(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
function hashWords(words, seed) {
  let h = seed | 0;
  for (let i = 0; i < words.length; i++) {
    let k = Math.imul(words[i], 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
    h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  return fmix32(h ^ words.length);
}
function hashAll() { let h = 0; for (const a of layers) h = hashWords(new Uint32Array(a.buffer), h); return h; }
for (let i = 0; i < 5; i++) hashAll();
let t = performance.now(); const runs = 20; let r = 0; for (let i = 0; i < runs; i++) r ^= hashAll();
const ms = (performance.now() - t) / runs;
console.log(`full hash of ${LAYERS} x ${CELLS} f32 (${(LAYERS*CELLS*4/1e6).toFixed(1)} MB): ${ms.toFixed(2)} ms, ${(LAYERS*CELLS*4/1e6/ms).toFixed(2)} GB/s`, r);
const CHUNK = 64 * 64; const chunks = CELLS / CHUNK;
t = performance.now(); let c = 0; for (let i = 0; i < 1000; i++) { const w = new Uint32Array(layers[i % LAYERS].buffer, ((i * 7) % chunks) * CHUNK * 4, CHUNK); c ^= hashWords(w, i); }
console.log(`one 64x64 chunk of one layer: ${((performance.now() - t) / 1000 * 1000).toFixed(2)} us`, c);
let s = 0; t = performance.now(); for (let i = 0; i < 1e7; i++) s += Math.sin(i * 0.001); const sinNs = (performance.now() - t) / 1e7 * 1e6;
console.log(`Math.sin ${sinNs.toFixed(1)} ns/call`, s > 0);
