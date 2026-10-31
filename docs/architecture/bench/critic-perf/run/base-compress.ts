import { DEFAULT_GENERATION_OPTIONS } from "./src/generation/generation-options.ts";
import { generateWorld } from "./src/generation/world-generator.ts";
const g = generateWorld(7, DEFAULT_GENERATION_OPTIONS);
async function gz(bytes: Uint8Array): Promise<number> {
  return (await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()).byteLength;
}
function shuffle(bytes: Uint8Array, width: number): Uint8Array {
  const n = bytes.length / width; const out = new Uint8Array(bytes.length);
  for (let i = 0; i < n; i++) for (let b = 0; b < width; b++) out[b * n + i] = bytes[i * width + b];
  return out;
}
let raw = 0, plain = 0, best = 0; const t = performance.now();
for (const [k, v] of Object.entries(g.terrain)) {
  if (!ArrayBuffer.isView(v)) continue;
  const bytes = new Uint8Array(v.buffer.slice(0));
  raw += bytes.length;
  const p = await gz(bytes); plain += p;
  let b = p;
  if (v instanceof Float32Array) {
    const bits = new Int32Array(v.buffer.slice(0)); const delta = new Int32Array(bits.length);
    for (let i = 0; i < bits.length; i++) delta[i] = bits[i] - (i > 0 ? bits[i - 1] : 0);
    b = Math.min(await gz(shuffle(new Uint8Array(delta.buffer), 4)), await gz(shuffle(bytes, 4)));
  }
  best += b;
  console.log(`${k.padEnd(16)} raw ${(bytes.length/1e6).toFixed(2)} MB gzip ${(p/1e6).toFixed(2)} best-lossless ${(b/1e6).toFixed(2)}`);
}
console.log(`TOTAL raw ${(raw/1e6).toFixed(1)} MB, gzip ${(plain/1e6).toFixed(1)} MB, delta+shuffle+gzip ${(best/1e6).toFixed(1)} MB, ${(performance.now()-t).toFixed(0)} ms`);
