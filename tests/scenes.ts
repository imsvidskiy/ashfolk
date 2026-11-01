export interface PowerCast {
  readonly parameters: Readonly<Record<string, number>>;
  readonly powerId: string;
  readonly x: number;
  readonly z: number;
}

export interface Scene {
  readonly cast?: PowerCast;
  readonly name: string;
  readonly query: string;
  readonly seconds?: number;
}

export const SCENES: readonly Scene[] = [
  { name: "far-round", query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=0,0,1800,0.8,0" },
  { name: "far-small", query: "seed=7&shape=round&size=small&quality=high&paused=1&hours=11&camera=0,0,1800,0.8,0" },
  { name: "far-large", query: "seed=7&shape=round&size=large&quality=high&paused=1&hours=11&camera=0,0,1800,0.8,0" },
  { name: "far-square", query: "seed=7&shape=square&quality=high&paused=1&hours=11&camera=0,0,1800,0.8,0" },
  {
    name: "markers-over-forest",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=1480,1360,140,0.45,0.13",
  },
  {
    name: "island-edge",
    query: "seed=7&shape=round&quality=high&paused=1&hours=19&camera=2769.5,856.7,160,0.12,2.52",
  },
  { name: "cave-mouth", query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-1573,1583,40,0.6,-0.79" },
  {
    name: "cave-wide-river",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-2210,-338,70,0.6,-1.34",
  },
  {
    name: "spring-pond",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-427.5,1536.9,130,0.75,0.8",
  },
  {
    name: "spring-lake",
    query: "seed=12&shape=square&quality=high&paused=1&hours=11&camera=-1340,-2877,300,0.7,0.5",
  },
  {
    name: "river-past-cave",
    query: "seed=10&shape=round&quality=high&paused=1&hours=11&camera=35,2332,260,0.8,0",
  },
  {
    name: "river-across-hillside",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-2490,-950,180,0.6,-1.6",
  },
  {
    name: "river-cascade",
    query: "seed=21&shape=round&quality=high&paused=1&hours=11&camera=-375,-1676,140,0.5,2.4",
  },
  {
    name: "river-cascade-up",
    query: "seed=21&shape=round&quality=high&paused=1&hours=11&camera=-375,-1676,120,0.4,3.14",
  },
  {
    name: "cascade-low",
    query: "seed=21&shape=round&quality=high&paused=1&hours=11&camera=-375,-1676,60,0.22,2.4",
  },
  {
    name: "river-cascade-far",
    query: "seed=21&shape=round&quality=high&paused=1&hours=11&camera=-531,-1721,900,0.6,2.11",
  },
  {
    name: "river-cascade-far-low",
    query: "seed=21&shape=round&quality=low&paused=1&hours=11&camera=-531,-1721,900,0.6,2.11",
  },
  {
    name: "river-wide-bends",
    query: "seed=21&shape=round&quality=high&paused=1&hours=11&camera=1746,-625,160,0.55,1",
  },
  {
    name: "river-steep-ford",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-945,-2488,70,0.55,2.07",
  },
  {
    name: "river-narrow-slope",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-1676,-2136,110,0.5,2.36",
  },
  {
    name: "river-pool-step",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-416,-2716,140,0.5,2.2",
  },
  {
    name: "river-junction",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=2184,-1526,300,0.6,0.6",
  },
  {
    name: "junction-close",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=2120,-1600,110,0.5,0.6",
  },
  {
    name: "lake-link-mid",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-190,1000,600,0.8,0.6",
  },
  {
    name: "wolf-mouth-close",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=235,1398,35,0.85,0.6",
  },
  {
    name: "river-pond-mouth",
    query: "seed=10&shape=round&quality=high&paused=1&hours=11&camera=-215,2250,250,0.8,0",
  },
  {
    name: "far-rivers",
    query: "seed=10&shape=round&quality=high&paused=1&hours=11&camera=35,2332,1500,0.8,0",
  },
  { name: "lake-cut-crown", query: "seed=2&shape=round&quality=high&paused=1&hours=11&camera=0,0,1500,0.55,0" },
  {
    name: "crater-lake-wall",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-1000,-500,900,0.45,1.57",
  },
  {
    name: "round-flank-pleats",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=300,1700,1000,0.5,0",
  },
  { name: "ground-zones", query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=2000,-400,800,0.5,0" },
  { name: "faceted-slope", query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=1800,-300,250,0.6,0" },
  { name: "peak-tip", query: "seed=2&shape=round&quality=high&paused=1&hours=11&camera=0,0,1500,0.3,1.57" },
  { name: "snow-cap", query: "seed=3&shape=round&quality=high&paused=1&hours=11&camera=-700,1085,800,0.45,0.6" },
  { name: "deposit-patches", query: "seed=2&shape=round&quality=high&paused=1&hours=11&camera=0,1800,700,0.45,0" },
  {
    name: "inside-crown",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=544.83,-628.35,12,0.985,0",
  },
  {
    name: "forest-floor",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=772.84,226.97,20,0.08,0",
  },
  {
    name: "boulder-edge",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-768.8,-580,8,0.3,0",
  },
  {
    cast: { parameters: { intensity: 60, radius: 25 }, powerId: "fire", x: -1545, z: 1457 },
    name: "smoke-over-forest",
    query: "seed=7&shape=round&quality=high&hours=11&camera=-1545,1457,160,0.5,-2.45",
    seconds: 25,
  },
];
