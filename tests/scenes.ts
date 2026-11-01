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
  readonly season?: number;
  readonly seconds?: number;
  readonly speed?: number;
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
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-2182.1,-425.7,55,0.7,-1.34",
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
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-2308.7,-135,180,0.7,2.84",
  },
  {
    name: "far-rivers",
    query: "seed=10&shape=round&quality=high&paused=1&hours=11&camera=35,2332,1500,0.8,0",
  },
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
