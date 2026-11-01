const SCENE_OPTIONS = ["season", "seconds", "speed"] as const;

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
  {
    name: "models-forest-close",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=90,-1050,45,0.35,0.5",
  },
  {
    name: "models-forest-autumn",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=90,-1050,130,0.5,0.5",
    season: 2.6,
  },
  {
    name: "models-forest-lod",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=90,-1050,420,0.6,0.5",
  },
  {
    name: "models-people-camp",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=185,1348,14,0.35,0.6",
  },
  {
    name: "models-people-walk",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=1473,1315,16,0.45,0.3",
    seconds: 90,
    speed: 16,
  },
  {
    name: "models-camp-buildings",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=1470,1320,30,0.55,0.3",
    season: 1.5,
    seconds: 90,
    speed: 16,
  },
  { name: "models-mammoths", query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=2100,-45,22,0.3,0.4" },
  { name: "models-dolmen", query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-271,1162,18,0.35,0.6" },
  {
    name: "models-stone-head",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-132,2336,22,0.3,0.6",
  },
  {
    name: "models-pines-side",
    query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-50,-1920,16,0.3,0.4",
  },
  { name: "models-wolves", query: "seed=7&shape=round&quality=high&paused=1&hours=11&camera=-2107,640,22,0.7,0.4" },
  {
    cast: { parameters: { herdSize: 6 }, powerId: "ibex", x: -768.8, z: -580 },
    name: "models-ibex",
    query: "seed=7&shape=round&quality=high&hours=11&camera=-768.8,-580,24,0.5,0.4",
    seconds: 3,
  },
];

function optionNumber(option: string, value: string): number {
  const number = Number(value);

  if (value.trim() === "" || !Number.isFinite(number)) {
    throw new Error(`The scene option ${option} takes a number, got "${value}"`);
  }

  return number;
}

export function sceneFromQuery(name: string, query: string): Scene {
  const parameters = new URLSearchParams(query);
  const options: Partial<Record<(typeof SCENE_OPTIONS)[number], number>> = {};

  for (const option of SCENE_OPTIONS) {
    const value = parameters.get(option);

    if (value !== null) {
      options[option] = optionNumber(option, value);
      parameters.delete(option);
    }
  }

  return { ...options, name, query: parameters.toString() };
}
