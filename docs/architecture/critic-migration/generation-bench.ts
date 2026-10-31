import { generateWorld } from "./src/generation/world-generator.ts";
import { generationFingerprint } from "./src/generation/generation-fingerprint.ts";
for (const seed of [7, 11, 3]) {
  const start = performance.now();
  const world = generateWorld(seed);
  const middle = performance.now();
  const fp = generationFingerprint(world);
  const end = performance.now();
  console.log(seed, "generate ms", Math.round(middle - start), "fingerprint ms", Math.round(end - middle), fp);
}
