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
  { name: "far-square", query: "seed=7&shape=square&quality=high&paused=1&hours=11&camera=0,0,1800,0.8,0" },
  {
    name: "markers-over-forest",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-1050,640,140,0.45,2.6",
  },
  {
    name: "island-edge",
    query: "seed=7&shape=round&quality=high&paused=1&hours=19&camera=2769.5,856.7,80,0.12,2.52",
  },
  { name: "cave-mouth", query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-415,-585,40,0.6,0" },
  {
    name: "cave-wide-river",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-1050,-1990,55,0.7,-2.37",
  },
  {
    name: "spring-pond",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-1755,-1355,130,0.75,0.8",
  },
  {
    name: "river-past-cave",
    query: "seed=10&shape=round&quality=high&paused=1&hours=11&camera=355,-625,260,0.8,0",
  },
  {
    name: "river-across-hillside",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-255,-470,180,0.7,1.57",
  },
  {
    cast: { parameters: { intensity: 60, radius: 25 }, powerId: "fire", x: -1050, z: 640 },
    name: "smoke-over-forest",
    query: "seed=7&shape=round&quality=high&hours=11&camera=-1050,640,160,0.5,2.6",
    seconds: 25,
  },
];
