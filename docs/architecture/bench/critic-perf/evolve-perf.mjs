const SIDE = 640;
const CELLS = SIDE * SIDE;

function mulberry(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function time(label, runs, body) {
  let sink = 0;
  for (let i = 0; i < 5; i += 1) sink += body();
  const start = performance.now();
  for (let i = 0; i < runs; i += 1) sink += body();
  const per = (performance.now() - start) / runs;
  console.log(`${label.padEnd(72)} ${(per * 1000).toFixed(1).padStart(10)} us  (sink ${Math.round(sink) % 997})`);
  return per;
}

const random = mulberry(11);

class CellSet {
  constructor(n) {
    this.cells = new Int32Array(n);
    this.isMember = new Uint8Array(n);
    this.size = 0;
  }
  add(cell) {
    if (this.isMember[cell] === 1) return;
    this.isMember[cell] = 1;
    this.cells[this.size] = cell;
    this.size += 1;
  }
}

class RowTracker {
  constructor(rows) {
    this.dirty = new Uint8Array(rows);
  }
  markCell(cell) {
    this.dirty[(cell / SIDE) | 0] = 1;
  }
}

const rows = new RowTracker(SIDE);

class DenseField {
  constructor(name, min, max, rest, snap) {
    this.name = name;
    this.values = new Float32Array(CELLS);
    this.active = new CellSet(CELLS);
    this.min = min;
    this.max = max;
    this.rest = rest;
    this.snap = snap;
  }
  at(cell) {
    return this.values[cell];
  }
  set(cell, value) {
    let next = value < this.min ? this.min : value > this.max ? this.max : value;
    if (next < this.snap) next = this.rest;
    if (this.values[cell] === next) return;
    this.values[cell] = next;
    if (next !== this.rest) this.active.add(cell);
    rows.markCell(cell);
  }
  add(cell, amount) {
    this.set(cell, this.values[cell] + amount);
  }
  scale(cell, factor) {
    this.set(cell, this.values[cell] * factor);
  }
}

class ByteField {
  constructor(name) {
    this.name = name;
    this.values = new Uint8Array(CELLS);
    this.active = new CellSet(CELLS);
  }
  at(cell) {
    return this.values[cell] / 255;
  }
  set(cell, value) {
    const next = Math.max(0, Math.min(255, Math.round(value * 255)));
    if (this.values[cell] === next) return;
    this.values[cell] = next;
    if (next !== 0) this.active.add(cell);
    rows.markCell(cell);
  }
  add(cell, amount) {
    this.set(cell, this.at(cell) + amount);
  }
  scale(cell, factor) {
    this.set(cell, this.at(cell) * factor);
  }
}

class MapField {
  constructor(name) {
    this.name = name;
    this.values = new Map();
    this.active = new CellSet(CELLS);
  }
  at(cell) {
    const value = this.values.get(cell);
    return value === undefined ? 0 : value;
  }
  set(cell, value) {
    if (value <= 0) {
      this.values.delete(cell);
      return;
    }
    this.values.set(cell, value);
    this.active.add(cell);
  }
  add(cell, amount) {
    this.set(cell, this.at(cell) + amount);
  }
  scale(cell, factor) {
    this.set(cell, this.at(cell) * factor);
  }
}

const fields = {
  fire: new DenseField("fire", 0, 1, 0, 0.02),
  heat: new DenseField("heat", 0, 10, 0, 0.002),
  soak: new DenseField("soak", 0, 4, 0, 0.001),
  snow: new DenseField("snow", 0, 1.2, 0, 0.0001),
  wetness: new DenseField("wetness", 0, 1, 0, 0.0001),
  windX: new DenseField("windX", -50, 50, 0, 0.001),
  germs: new ByteField("germs"),
  acid: new MapField("acid"),
};

const fieldByName = new Map(Object.entries(fields));

const cellReader = {
  field(name) {
    return fieldByName.get(name);
  },
};

for (let cell = 0; cell < CELLS; cell += 1) {
  fields.fire.values[cell] = random() < 0.05 ? 0.5 + random() * 0.5 : 0;
  fields.heat.values[cell] = random();
  fields.snow.values[cell] = random();
  fields.wetness.values[cell] = random();
  fields.soak.values[cell] = random() * 0.5;
}

function makeActive(count) {
  const active = new Int32Array(count);
  for (let i = 0; i < count; i += 1) active[i] = Math.floor(random() * CELLS);
  active.sort();
  return active;
}

const activeBrush = makeActive(2000);
const activeRow = makeActive(20480);
const activeAll = Int32Array.from({ length: CELLS }, (_, i) => i);

const tick = { seconds: 0.1, tick: 1 };

const SOAK_DOUSES_FIRE = {
  drivenBy: "soak",
  id: "soak-douses-fire",
  apply: (cells, cell, t) => {
    const remaining = 1 - Math.min(1, cells.field("soak").at(cell) * t.seconds);
    cells.field("fire").scale(cell, remaining);
    cells.field("heat").scale(cell, remaining);
  },
  when: (cells, cell) => {
    return cells.field("fire").at(cell) > 0;
  },
};

const SNOW_MELTS = {
  drivenBy: "snow",
  id: "snow-melts",
  apply: (cells, cell, t) => {
    cells.field("snow").add(cell, -0.001 * t.seconds);
    cells.field("wetness").add(cell, 0.0005 * t.seconds);
  },
  when: (cells, cell) => {
    return cells.field("heat").at(cell) > 0.4;
  },
};

const GERMS_FADE = {
  drivenBy: "germs",
  id: "germs-fade",
  apply: (cells, cell) => {
    cells.field("germs").scale(cell, 0.99);
  },
  when: (cells, cell) => {
    return cells.field("wetness").at(cell) < 0.5;
  },
};

const ACID_SEARS = {
  drivenBy: "acid",
  id: "acid-sears",
  apply: (cells, cell) => {
    cells.field("acid").scale(cell, 0.999);
    cells.field("heat").add(cell, 0.0001);
  },
  when: (cells, cell) => {
    return cells.field("acid").at(cell) > 0;
  },
};

const WIND_BLOWS = {
  drivenBy: "windX",
  id: "wind-blows-out-fire",
  apply: (cells, cell) => {
    const wind = Math.abs(cells.field("windX").at(cell));
    cells.field("fire").scale(cell, 1 - Math.min(1, wind * 0.01));
  },
  when: (cells, cell) => {
    return cells.field("fire").at(cell) > 0;
  },
};

const REACTIONS = [SOAK_DOUSES_FIRE, SNOW_MELTS, GERMS_FADE, ACID_SEARS, WIND_BLOWS];

function reactionPass(reaction, active) {
  let applied = 0;
  for (let position = 0; position < active.length; position += 1) {
    const cell = active[position];
    if (reaction.when(cellReader, cell)) {
      reaction.apply(cellReader, cell, tick);
      applied += 1;
    }
  }
  return applied;
}

function warmPolymorphic() {
  for (const reaction of REACTIONS) reactionPass(reaction, activeBrush);
}
warmPolymorphic();

function directDouse(active) {
  const fire = fields.fire.values;
  const heat = fields.heat.values;
  const soak = fields.soak.values;
  let applied = 0;
  for (let position = 0; position < active.length; position += 1) {
    const cell = active[position];
    if (fire[cell] > 0) {
      const remaining = 1 - Math.min(1, soak[cell] * 0.1);
      let f = fire[cell] * remaining;
      if (f < 0.02) f = 0;
      fire[cell] = f;
      heat[cell] *= remaining;
      applied += 1;
    }
  }
  return applied;
}

function directSnow(active) {
  const snow = fields.snow.values;
  const wetness = fields.wetness.values;
  const heat = fields.heat.values;
  let applied = 0;
  for (let position = 0; position < active.length; position += 1) {
    const cell = active[position];
    if (heat[cell] > 0.4) {
      snow[cell] = Math.max(0, snow[cell] - 0.0001);
      wetness[cell] = Math.min(1, wetness[cell] + 0.00005);
      applied += 1;
    }
  }
  return applied;
}

console.log("== A. reaction pass: closures + field(name) lookup vs direct loop ==");
time("direct douse, 2k active", 2000, () => directDouse(activeBrush));
time("reaction douse (polymorphic site), 2k active", 2000, () => reactionPass(SOAK_DOUSES_FIRE, activeBrush));
time("direct douse, 20k active", 500, () => directDouse(activeRow));
time("reaction douse (polymorphic site), 20k active", 500, () => reactionPass(SOAK_DOUSES_FIRE, activeRow));
time("direct snow melt, 409,600 active (dense field)", 30, () => directSnow(activeAll));
time("reaction snow melt, 409,600 active (dense field)", 30, () => reactionPass(SNOW_MELTS, activeAll));

console.log("== B. writer overhead in a surface-like loop (20,480 cells = 32 rows) ==");
const rowStart = 100 * SIDE;
const rowEnd = rowStart + 32 * SIDE;
time("raw Float32 writes, 32 rows", 1000, () => {
  const snow = fields.snow.values;
  const wetness = fields.wetness.values;
  let s = 0;
  for (let cell = rowStart; cell < rowEnd; cell += 1) {
    snow[cell] = Math.fround(Math.min(1.2, snow[cell] + 0.00001));
    wetness[cell] = Math.fround(Math.max(0, wetness[cell] - 0.00001));
    s += snow[cell];
  }
  return s;
});
time("FieldWriter.add (clamp, snap, active, markRow), 32 rows", 1000, () => {
  const snow = fields.snow;
  const wetness = fields.wetness;
  let s = 0;
  for (let cell = rowStart; cell < rowEnd; cell += 1) {
    snow.add(cell, 0.00001);
    wetness.add(cell, -0.00001);
    s += snow.values[cell];
  }
  return s;
});
time("cells.field(name).add per write, 32 rows", 1000, () => {
  let s = 0;
  for (let cell = rowStart; cell < rowEnd; cell += 1) {
    cellReader.field("snow").add(cell, 0.00001);
    cellReader.field("wetness").add(cell, -0.00001);
    s += cellReader.field("snow").at(cell);
  }
  return s;
});

console.log("== C. visitor objects: allocated per call vs hoisted ==");
const PEOPLE = 5000;
const px = new Float64Array(PEOPLE);
const pz = new Float64Array(PEOPLE);
for (let i = 0; i < PEOPLE; i += 1) {
  px[i] = 800 + (i % 12) * 400 + (random() - 0.5) * 300;
  pz[i] = 800 + Math.floor((i % 12) / 4) * 1500 + (random() - 0.5) * 300;
}
const BUCKET_SIZE = 40;
const BSIDE = Math.ceil((SIDE * 10) / BUCKET_SIZE);
const bucketStart = new Int32Array(BSIDE * BSIDE + 1);
const bucketItems = new Int32Array(PEOPLE);
const bucketOf = new Int32Array(PEOPLE);
const cursor = new Int32Array(BSIDE * BSIDE);
function rebuild() {
  bucketStart.fill(0);
  for (let i = 0; i < PEOPLE; i += 1) {
    const b = Math.floor(pz[i] / BUCKET_SIZE) * BSIDE + Math.floor(px[i] / BUCKET_SIZE);
    bucketOf[i] = b;
    bucketStart[b + 1] += 1;
  }
  for (let b = 0; b < BSIDE * BSIDE; b += 1) bucketStart[b + 1] += bucketStart[b];
  cursor.set(bucketStart.subarray(0, BSIDE * BSIDE));
  for (let i = 0; i < PEOPLE; i += 1) {
    bucketItems[cursor[bucketOf[i]]] = i;
    cursor[bucketOf[i]] += 1;
  }
  return 1;
}
rebuild();
function visit(x, z, r, visitor) {
  const x0 = Math.floor((x - r) / BUCKET_SIZE);
  const x1 = Math.floor((x + r) / BUCKET_SIZE);
  const z0 = Math.floor((z - r) / BUCKET_SIZE);
  const z1 = Math.floor((z + r) / BUCKET_SIZE);
  const r2 = r * r;
  for (let bz = z0; bz <= z1; bz += 1) {
    for (let bx = x0; bx <= x1; bx += 1) {
      const b = bz * BSIDE + bx;
      for (let k = bucketStart[b]; k < bucketStart[b + 1]; k += 1) {
        const i = bucketItems[k];
        const dx = px[i] - x;
        const dz = pz[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2 && !visitor.visit(1, i, d2)) return;
      }
    }
  }
}
let exposure = 0;
const hoisted = {
  slot: 0,
  visit(group, neighbor, d2) {
    exposure += d2 > 0 ? 1 : 0;
    return true;
  },
};
const other1 = { visit: (g, n, d) => { exposure += n & 1; return true; } };
const other2 = { visit: (g, n, d) => { exposure -= 1; return true; } };
const other3 = { visit: (g, n, d) => { exposure += g; return true; } };
const other4 = { visit: (g, n, d) => { exposure ^= n; return true; } };
for (let i = 0; i < 2000; i += 1) {
  visit(px[i], pz[i], 30, other1);
  visit(px[i], pz[i], 30, other2);
  visit(px[i], pz[i], 30, other3);
  visit(px[i], pz[i], 30, other4);
}
time("5k contact queries r=4 m, hoisted visitor (megamorphic site)", 200, () => {
  exposure = 0;
  for (let i = 0; i < PEOPLE; i += 1) visit(px[i], pz[i], 4, hoisted);
  return exposure;
});
time("5k contact queries r=4 m, closure+object per call (megamorphic)", 200, () => {
  exposure = 0;
  for (let i = 0; i < PEOPLE; i += 1) {
    const slot = i;
    visit(px[i], pz[i], 4, {
      visit: (group, neighbor) => {
        exposure += neighbor === slot ? 0 : 1;
        return true;
      },
    });
  }
  return exposure;
});
time("5k contact queries r=4 m, inlined collect into Int32Array", 200, () => {
  let total = 0;
  const out = new Int32Array(64);
  for (let i = 0; i < PEOPLE; i += 1) {
    const x = px[i];
    const z = pz[i];
    const r = 4;
    const x0 = Math.floor((x - r) / BUCKET_SIZE);
    const x1 = Math.floor((x + r) / BUCKET_SIZE);
    const z0 = Math.floor((z - r) / BUCKET_SIZE);
    const z1 = Math.floor((z + r) / BUCKET_SIZE);
    let n = 0;
    for (let bz = z0; bz <= z1; bz += 1) {
      for (let bx = x0; bx <= x1; bx += 1) {
        const b = bz * BSIDE + bx;
        for (let k = bucketStart[b]; k < bucketStart[b + 1]; k += 1) {
          const j = bucketItems[k];
          const dx = px[j] - x;
          const dz = pz[j] - z;
          if (dx * dx + dz * dz <= 16 && n < 64) {
            out[n] = j;
            n += 1;
          }
        }
      }
    }
    total += n;
  }
  return total;
});
time("bucket rebuild, 5k movers", 2000, rebuild);

console.log("== D. events: object per event vs SoA queue (10k events/tick) ==");
const EVENTS = 10000;
const queue = [];
function drainObjects() {
  let s = 0;
  for (const event of queue) {
    switch (event.kind) {
      case "thingKilled":
        s += event.thing;
        break;
      case "fireSeen":
        s += event.cell;
        break;
      default:
        s += 1;
    }
  }
  queue.length = 0;
  return s;
}
time("emit 10k {kind, thing, cause} objects + drain", 300, () => {
  for (let i = 0; i < EVENTS; i += 1) {
    queue.push({ cause: 3, kind: i % 3 === 0 ? "fireSeen" : "thingKilled", thing: i, cell: i });
  }
  return drainObjects();
});
const eventKind = new Uint8Array(EVENTS);
const eventA = new Int32Array(EVENTS);
const eventB = new Int32Array(EVENTS);
time("emit 10k into SoA typed queue + drain", 300, () => {
  let n = 0;
  for (let i = 0; i < EVENTS; i += 1) {
    eventKind[n] = i % 3 === 0 ? 1 : 2;
    eventA[n] = i;
    eventB[n] = 3;
    n += 1;
  }
  let s = 0;
  for (let k = 0; k < n; k += 1) s += eventKind[k] === 1 ? eventA[k] : eventA[k] + eventB[k];
  return s;
});

console.log("== E. exact exp (fdlibm port) vs Math.exp ==");
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const halF = [0.5, -0.5];
const ln2HI = [6.93147180369123816490e-1, -6.93147180369123816490e-1];
const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const invln2 = 1.44269504088896338700e0;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;
function highWord(x) {
  f64[0] = x;
  return u32[1];
}
function withHighWord(x, hi) {
  f64[0] = x;
  u32[1] = hi;
  return f64[0];
}
function exactExp(x) {
  let hx = highWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) {
    if (x !== x) return x;
    if (x > 7.09782712893383973096e2) return Infinity;
    if (x < -7.45133219101941108420e2) return 0;
  }
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      hi = x - ln2HI[xsb];
      lo = ln2LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = (invln2 * x + halF[xsb]) | 0;
      const t = k;
      hi = x - t * ln2HI[0];
      lo = t * ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    return 1 + x;
  } else {
    k = 0;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) {
    return withHighWord(y, highWord(y) + (k << 20));
  }
  return withHighWord(y, highWord(y) + ((k + 1000) << 20)) * 9.33263618503218878990e-302;
}
let maxError = 0;
for (let i = 0; i < 100000; i += 1) {
  const x = (random() - 0.5) * 20;
  const e = Math.abs(exactExp(x) - Math.exp(x)) / Math.exp(x);
  if (e > maxError) maxError = e;
}
console.log(`exactExp max relative error vs Math.exp: ${maxError.toExponential(2)}`);
const inputs = Float64Array.from({ length: 80000 }, () => (random() - 0.5) * 2);
time("Math.exp x 80k (big-fire spreadHeat: 10k burning x 8 neighbors)", 500, () => {
  let s = 0;
  for (let i = 0; i < inputs.length; i += 1) s += Math.exp(inputs[i]);
  return s;
});
time("exactExp x 80k", 500, () => {
  let s = 0;
  for (let i = 0; i < inputs.length; i += 1) s += exactExp(inputs[i]);
  return s;
});
const TABLE_SIZE = 1024;
const tableMin = Math.log(0.4);
const tableMax = Math.log(3);
const table = Float64Array.from({ length: TABLE_SIZE + 1 }, (_, i) => exactExp(tableMin + ((tableMax - tableMin) * i) / TABLE_SIZE));
time("table exp (clamped slope factor, lerp) x 80k", 500, () => {
  let s = 0;
  const scale = TABLE_SIZE / (tableMax - tableMin);
  for (let i = 0; i < inputs.length; i += 1) {
    const v = inputs[i] < tableMin ? tableMin : inputs[i] > tableMax ? tableMax : inputs[i];
    const p = (v - tableMin) * scale;
    const k = Math.min(TABLE_SIZE - 1, p | 0);
    s += table[k] + (table[k + 1] - table[k]) * (p - k);
  }
  return s;
});
time("Math.hypot x 80k", 500, () => {
  let s = 0;
  for (let i = 0; i < inputs.length; i += 1) s += Math.hypot(inputs[i], inputs[(i + 1) % inputs.length]);
  return s;
});
time("Math.sqrt(dx*dx+dz*dz) x 80k", 500, () => {
  let s = 0;
  for (let i = 0; i < inputs.length; i += 1) {
    const a = inputs[i];
    const b = inputs[(i + 1) % inputs.length];
    s += Math.sqrt(a * a + b * b);
  }
  return s;
});

console.log("== F. ThingSource.forEachInCell across 5 source classes (113-cell footprint) ==");
const PLANTS = 512000;
const first = new Int32Array(CELLS).fill(-1);
const next = new Int32Array(PLANTS).fill(-1);
const kind = new Uint8Array(PLANTS);
for (let i = 0; i < PLANTS; i += 1) {
  const cell = Math.floor(random() * CELLS);
  next[i] = first[cell];
  first[cell] = i;
  kind[i] = Math.floor(random() * 28);
}
function makeSource(base) {
  return class {
    constructor() {
      this.base = base;
    }
    forEachInCell(cell, visitor) {
      for (let i = first[(cell + this.base) % CELLS]; i !== -1; i = next[i]) visitor.visit(this.base, i, 0);
    }
  };
}
const sources = [0, 1, 2, 3, 4].map((b) => new (makeSource(b))());
const footprint = [];
for (let dz = -6; dz <= 6; dz += 1) for (let dx = -6; dx <= 6; dx += 1) if (dx * dx + dz * dz <= 36) footprint.push(dz * SIDE + dx);
const counter = { n: 0, visit(group, slot) { if (kind[slot] < 7) this.n += 1; return true; } };
time(`count via 5 virtual sources x ${footprint.length} cells x 1000 queries`, 50, () => {
  counter.n = 0;
  for (let q = 0; q < 1000; q += 1) {
    const center = 200000 + q * 37;
    for (const source of sources) for (const off of footprint) source.forEachInCell(center + off, counter);
  }
  return counter.n;
});
time(`count via direct plant list x ${footprint.length} cells x 1000 queries`, 50, () => {
  let n = 0;
  for (let q = 0; q < 1000; q += 1) {
    const center = 200000 + q * 37;
    for (const off of footprint) for (let i = first[center + off]; i !== -1; i = next[i]) if (kind[i] < 7) n += 1;
  }
  return n;
});

console.log("== G. memory per field ==");
for (const side of [640, 768]) {
  const cells = side * side;
  console.log(`${side}^2: Float32 field ${(cells * 4 / 1e6).toFixed(2)} MB, +CellSet ${(cells * 5 / 1e6).toFixed(2)} MB, total ${(cells * 9 / 1e6).toFixed(2)} MB; Uint8 field ${(cells / 1e6).toFixed(2)} MB`);
}
