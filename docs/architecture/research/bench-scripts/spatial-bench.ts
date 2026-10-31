const depsRoot = process.argv[2];
const { default: KDBush } = await import(`${depsRoot}/node_modules/kdbush/index.js`);
const { default: Flatbush } = await import(`${depsRoot}/node_modules/flatbush/index.js`);

const SIDE = 640;
const CELL = 10;
const WORLD = SIDE * CELL;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function time(label: string, runs: number, body: () => number) {
  let sink = 0;
  for (let i = 0; i < 3; i += 1) sink += body();
  const start = performance.now();
  for (let i = 0; i < runs; i += 1) sink += body();
  const per = (performance.now() - start) / runs;
  console.log(`${label.padEnd(58)} ${(per * 1000).toFixed(1).padStart(9)} us  (sink ${sink % 997})`);
}

const random = mulberry(7);

// ---------- dynamic agents ----------
const AGENTS = 5000;
const ax = new Float32Array(AGENTS);
const az = new Float32Array(AGENTS);
for (let i = 0; i < AGENTS; i += 1) {
  // clustered around 12 camps, like tribes
  const camp = Math.floor(random() * 12);
  const cx = 800 + (camp % 4) * 1500;
  const cz = 800 + Math.floor(camp / 4) * 2000;
  ax[i] = cx + (random() - 0.5) * 400;
  az[i] = cz + (random() - 0.5) * 400;
}

const BUCKET = 4; // cells per bucket side => 40 m
const BSIDE = SIDE / BUCKET;
const bucketStart = new Int32Array(BSIDE * BSIDE + 1);
const bucketItems = new Int32Array(AGENTS);
const bucketOf = new Int32Array(AGENTS);

function buildBuckets() {
  bucketStart.fill(0);
  for (let i = 0; i < AGENTS; i += 1) {
    const bx = Math.min(BSIDE - 1, Math.max(0, Math.floor(ax[i] / (CELL * BUCKET))));
    const bz = Math.min(BSIDE - 1, Math.max(0, Math.floor(az[i] / (CELL * BUCKET))));
    const b = bz * BSIDE + bx;
    bucketOf[i] = b;
    bucketStart[b + 1] += 1;
  }
  for (let b = 0; b < BSIDE * BSIDE; b += 1) bucketStart[b + 1] += bucketStart[b];
  // stable scatter: walk ids ascending, write at a running cursor (reuse bucketItems as cursor via copy)
  const cursor = scratchCursor;
  cursor.set(bucketStart.subarray(0, BSIDE * BSIDE));
  for (let i = 0; i < AGENTS; i += 1) {
    const b = bucketOf[i];
    bucketItems[cursor[b]] = i;
    cursor[b] += 1;
  }
  return bucketStart[BSIDE * BSIDE];
}
const scratchCursor = new Int32Array(BSIDE * BSIDE);

const out = new Int32Array(AGENTS);

function gridWithin(x: number, z: number, r: number): number {
  const size = CELL * BUCKET;
  const x0 = Math.max(0, Math.floor((x - r) / size));
  const x1 = Math.min(BSIDE - 1, Math.floor((x + r) / size));
  const z0 = Math.max(0, Math.floor((z - r) / size));
  const z1 = Math.min(BSIDE - 1, Math.floor((z + r) / size));
  const r2 = r * r;
  let count = 0;
  for (let bz = z0; bz <= z1; bz += 1) {
    for (let bx = x0; bx <= x1; bx += 1) {
      const b = bz * BSIDE + bx;
      for (let k = bucketStart[b]; k < bucketStart[b + 1]; k += 1) {
        const id = bucketItems[k];
        const dx = ax[id] - x;
        const dz = az[id] - z;
        if (dx * dx + dz * dz <= r2) {
          out[count] = id;
          count += 1;
        }
      }
    }
  }
  return count;
}

console.log(`--- ${AGENTS} moving agents (clustered in 12 camps), per tick ---`);
time("uniform grid 40 m buckets: counting-sort rebuild", 2000, buildBuckets);
time("kdbush 4.1: new + add + finish", 500, () => {
  const index = new KDBush(AGENTS);
  for (let i = 0; i < AGENTS; i += 1) index.add(ax[i], az[i]);
  index.finish();
  return index.numItems;
});
time("flatbush 4.6: new + add + finish", 500, () => {
  const index = new Flatbush(AGENTS);
  for (let i = 0; i < AGENTS; i += 1) index.add(ax[i], az[i], ax[i], az[i]);
  index.finish();
  return index.numItems;
});
buildBuckets();
const kd = new KDBush(AGENTS);
for (let i = 0; i < AGENTS; i += 1) kd.add(ax[i], az[i]);
kd.finish();
time(`grid: ${AGENTS} radius-30 m queries (every agent looks around)`, 50, () => {
  let total = 0;
  for (let i = 0; i < AGENTS; i += 1) total += gridWithin(ax[i], az[i], 30);
  return total;
});
time(`kdbush withinInto: ${AGENTS} radius-30 m queries`, 50, () => {
  let total = 0;
  for (let i = 0; i < AGENTS; i += 1) total += kd.withinInto(ax[i], az[i], 30, out);
  return total;
});
time(`kdbush within (allocating): ${AGENTS} radius-30 m queries`, 50, () => {
  let total = 0;
  for (let i = 0; i < AGENTS; i += 1) total += kd.within(ax[i], az[i], 30).length;
  return total;
});

// ---------- static plants ----------
const PLANTS = 300_000;
const SPECIES = 28;
const px = new Float32Array(PLANTS);
const pz = new Float32Array(PLANTS);
const species = new Uint8Array(PLANTS);
const cellOf = new Int32Array(PLANTS);
const firstInCell = new Int32Array(SIDE * SIDE).fill(-1);
const nextInCell = new Int32Array(PLANTS).fill(-1);
for (let i = 0; i < PLANTS; i += 1) {
  px[i] = random() * WORLD;
  pz[i] = random() * WORLD;
  species[i] = Math.floor(random() * SPECIES);
  const c = Math.floor(pz[i] / CELL) * SIDE + Math.floor(px[i] / CELL);
  cellOf[i] = c;
  nextInCell[i] = firstInCell[c];
  firstInCell[c] = i;
}
// coarse block counts: 16x16 cells (160 m), per species
const BLOCK = 16;
const BLSIDE = SIDE / BLOCK;
const blockCounts = new Uint16Array(BLSIDE * BLSIDE * SPECIES);
for (let i = 0; i < PLANTS; i += 1) {
  const c = cellOf[i];
  const b = Math.floor(Math.floor(c / SIDE) / BLOCK) * BLSIDE + Math.floor((c % SIDE) / BLOCK);
  blockCounts[b * SPECIES + species[i]] += 1;
}

function linkedCount(x: number, z: number, r: number, wanted: number): number {
  const x0 = Math.max(0, Math.floor((x - r) / CELL));
  const x1 = Math.min(SIDE - 1, Math.floor((x + r) / CELL));
  const z0 = Math.max(0, Math.floor((z - r) / CELL));
  const z1 = Math.min(SIDE - 1, Math.floor((z + r) / CELL));
  const r2 = r * r;
  let count = 0;
  for (let cz = z0; cz <= z1; cz += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let p = firstInCell[cz * SIDE + cx]; p !== -1; p = nextInCell[p]) {
        if (species[p] !== wanted) continue;
        const dx = px[p] - x;
        const dz = pz[p] - z;
        if (dx * dx + dz * dz <= r2) count += 1;
      }
    }
  }
  return count;
}

function blockCount(x: number, z: number, r: number, wanted: number): number {
  const size = CELL * BLOCK;
  const x0 = Math.max(0, Math.floor((x - r) / size));
  const x1 = Math.min(BLSIDE - 1, Math.floor((x + r) / size));
  const z0 = Math.max(0, Math.floor((z - r) / size));
  const z1 = Math.min(BLSIDE - 1, Math.floor((z + r) / size));
  let count = 0;
  for (let bz = z0; bz <= z1; bz += 1) {
    for (let bx = x0; bx <= x1; bx += 1) count += blockCounts[(bz * BLSIDE + bx) * SPECIES + wanted];
  }
  return count;
}

console.log(`--- ${PLANTS} plants, ${SPECIES} species, uniform ---`);
time("kdbush 4.1: build 300k plants", 10, () => {
  const index = new KDBush(PLANTS);
  for (let i = 0; i < PLANTS; i += 1) index.add(px[i], pz[i]);
  index.finish();
  return index.numItems;
});
const kdPlants = new KDBush(PLANTS);
for (let i = 0; i < PLANTS; i += 1) kdPlants.add(px[i], pz[i]);
kdPlants.finish();
const plantOut = new Int32Array(PLANTS);
const QUERIES = 10_000;
const qx = new Float32Array(QUERIES);
const qz = new Float32Array(QUERIES);
for (let i = 0; i < QUERIES; i += 1) {
  qx[i] = random() * WORLD;
  qz[i] = random() * WORLD;
}
for (const radius of [30, 100, 300]) {
  time(`per-cell linked list: ${QUERIES} count(species) r=${radius} m`, 5, () => {
    let total = 0;
    for (let i = 0; i < QUERIES; i += 1) total += linkedCount(qx[i], qz[i], radius, i % SPECIES);
    return total;
  });
  time(`kdbush withinInto + filter: ${QUERIES} count(species) r=${radius} m`, 5, () => {
    let total = 0;
    for (let i = 0; i < QUERIES; i += 1) {
      const n = kdPlants.withinInto(qx[i], qz[i], radius, plantOut);
      const wanted = i % SPECIES;
      for (let k = 0; k < n; k += 1) if (species[plantOut[k]] === wanted) total += 1;
    }
    return total;
  });
  time(`160 m block summary (approx, square): ${QUERIES} count r=${radius} m`, 5, () => {
    let total = 0;
    for (let i = 0; i < QUERIES; i += 1) total += blockCount(qx[i], qz[i], radius, i % SPECIES);
    return total;
  });
}

// ---------- CSR plants (sorted by cell, SoA copy) ----------
const csrStart = new Int32Array(SIDE * SIDE + 1);
const csrX = new Float32Array(PLANTS);
const csrZ = new Float32Array(PLANTS);
const csrSpecies = new Uint8Array(PLANTS);
const csrId = new Int32Array(PLANTS);
const csrCursor = new Int32Array(SIDE * SIDE);
function buildCsr() {
  csrStart.fill(0);
  for (let i = 0; i < PLANTS; i += 1) csrStart[cellOf[i] + 1] += 1;
  for (let c = 0; c < SIDE * SIDE; c += 1) csrStart[c + 1] += csrStart[c];
  csrCursor.set(csrStart.subarray(0, SIDE * SIDE));
  for (let i = 0; i < PLANTS; i += 1) {
    const k = csrCursor[cellOf[i]];
    csrCursor[cellOf[i]] = k + 1;
    csrX[k] = px[i];
    csrZ[k] = pz[i];
    csrSpecies[k] = species[i];
    csrId[k] = i;
  }
  return csrStart[SIDE * SIDE];
}
function csrCount(x: number, z: number, r: number, wanted: number): number {
  const x0 = Math.max(0, Math.floor((x - r) / CELL));
  const x1 = Math.min(SIDE - 1, Math.floor((x + r) / CELL));
  const z0 = Math.max(0, Math.floor((z - r) / CELL));
  const z1 = Math.min(SIDE - 1, Math.floor((z + r) / CELL));
  const r2 = r * r;
  let count = 0;
  for (let cz = z0; cz <= z1; cz += 1) {
    const row = cz * SIDE;
    const end = csrStart[row + x1 + 1];
    for (let k = csrStart[row + x0]; k < end; k += 1) {
      if (csrSpecies[k] !== wanted) continue;
      const dx = csrX[k] - x;
      const dz = csrZ[k] - z;
      if (dx * dx + dz * dz <= r2) count += 1;
    }
  }
  return count;
}
time("CSR plants: full counting-sort rebuild of 300k", 20, buildCsr);
buildCsr();
for (const radius of [30, 100, 300]) {
  time(`CSR row-run scan: ${QUERIES} count(species) r=${radius} m`, 5, () => {
    let total = 0;
    for (let i = 0; i < QUERIES; i += 1) total += csrCount(qx[i], qz[i], radius, i % SPECIES);
    return total;
  });
}

// ---------- cell field reads ----------
const biome = new Uint8Array(SIDE * SIDE);
const fire = new Float32Array(SIDE * SIDE);
for (let i = 0; i < SIDE * SIDE; i += 1) {
  biome[i] = Math.floor(random() * 13);
  fire[i] = random() < 0.01 ? random() : 0;
}
const scratchHistogram = new Uint16Array(16);
time("tornado footprint r=60 m: biome histogram + max fire (113 cells)", 2000, () => {
  const x = 3200;
  const z = 3200;
  const r = 60;
  const histogram = scratchHistogram;
  histogram.fill(0);
  let hottest = 0;
  for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz += 1) {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx += 1) {
      const c = cz * SIDE + cx;
      histogram[biome[c]] += 1;
      if (fire[c] > hottest) hottest = fire[c];
    }
  }
  return histogram[3] + hottest;
});
