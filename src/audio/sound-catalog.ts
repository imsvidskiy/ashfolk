const FULL = 1;
const SOFT = 0.5;
const QUIET = 0.25;

export type SoundBus = "ambience" | "effects" | "interface" | "music";

export interface SoundDefinition {
  readonly bus: SoundBus;
  readonly files: readonly string[];
  readonly priority: number;
  readonly referenceDistance: number;
  readonly volume: number;
}

export const SOUNDS = {
  animalDeer: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-deer-1.webm", import.meta.url).href,
      new URL("./sounds/animal-deer-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 60,
    volume: FULL,
  },
  animalHare: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-hare-1.webm", import.meta.url).href,
      new URL("./sounds/animal-hare-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 40,
    volume: FULL,
  },
  animalIbex: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-ibex-1.webm", import.meta.url).href,
      new URL("./sounds/animal-ibex-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 60,
    volume: FULL,
  },
  animalMammoth: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-mammoth-1.webm", import.meta.url).href,
      new URL("./sounds/animal-mammoth-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 90,
    volume: FULL,
  },
  animalWolves: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-wolves-1.webm", import.meta.url).href,
      new URL("./sounds/animal-wolves-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 120,
    volume: FULL,
  },
  arrow: {
    bus: "effects",
    files: [
      new URL("./sounds/arrow-1.webm", import.meta.url).href,
      new URL("./sounds/arrow-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 25,
    volume: QUIET,
  },
  blessingAbundance: {
    bus: "effects",
    files: [
      new URL("./sounds/blessing-abundance-1.webm", import.meta.url).href,
      new URL("./sounds/blessing-abundance-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 120,
    volume: FULL,
  },
  blessingHealing: {
    bus: "effects",
    files: [
      new URL("./sounds/blessing-healing-1.webm", import.meta.url).href,
      new URL("./sounds/blessing-healing-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 120,
    volume: FULL,
  },
  blessingInspiration: {
    bus: "effects",
    files: [
      new URL("./sounds/blessing-inspiration-1.webm", import.meta.url).href,
      new URL("./sounds/blessing-inspiration-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 120,
    volume: FULL,
  },
  buildingDone: {
    bus: "effects",
    files: [
      new URL("./sounds/building-done-1.webm", import.meta.url).href,
      new URL("./sounds/building-done-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 60,
    volume: FULL,
  },
  earthquake: {
    bus: "effects",
    files: [
      new URL("./sounds/earthquake-1.webm", import.meta.url).href,
      new URL("./sounds/earthquake-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 300,
    volume: FULL,
  },
  eventBirth: interfaceSound(FULL, [new URL("./sounds/event-birth-1.webm", import.meta.url).href]),
  eventDeath: interfaceSound(FULL, [new URL("./sounds/event-death-1.webm", import.meta.url).href]),
  eventDiscovery: interfaceSound(FULL, [new URL("./sounds/event-discovery-1.webm", import.meta.url).href]),
  eventEra: interfaceSound(FULL, [new URL("./sounds/event-era-1.webm", import.meta.url).href]),
  eventRaid: interfaceSound(FULL, [new URL("./sounds/event-raid-1.webm", import.meta.url).href]),
  explosion: {
    bus: "effects",
    files: [
      new URL("./sounds/explosion-1.webm", import.meta.url).href,
      new URL("./sounds/explosion-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 250,
    volume: FULL,
  },
  explosionWater: {
    bus: "effects",
    files: [
      new URL("./sounds/explosion-water-1.webm", import.meta.url).href,
      new URL("./sounds/explosion-water-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 250,
    volume: FULL,
  },
  fight: {
    bus: "effects",
    files: [
      new URL("./sounds/fight-1.webm", import.meta.url).href,
      new URL("./sounds/fight-2.webm", import.meta.url).href,
      new URL("./sounds/fight-3.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 25,
    volume: QUIET,
  },
  fire: {
    bus: "effects",
    files: [new URL("./sounds/fire-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 80,
    volume: FULL,
  },
  fireIgnite: {
    bus: "effects",
    files: [
      new URL("./sounds/fire-ignite-1.webm", import.meta.url).href,
      new URL("./sounds/fire-ignite-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 80,
    volume: FULL,
  },
  forestGrow: {
    bus: "effects",
    files: [
      new URL("./sounds/forest-grow-1.webm", import.meta.url).href,
      new URL("./sounds/forest-grow-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 120,
    volume: FULL,
  },
  handDrop: {
    bus: "effects",
    files: [
      new URL("./sounds/hand-drop-1.webm", import.meta.url).href,
      new URL("./sounds/hand-drop-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 0,
    volume: SOFT,
  },
  handGrab: {
    bus: "effects",
    files: [
      new URL("./sounds/hand-grab-1.webm", import.meta.url).href,
      new URL("./sounds/hand-grab-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 0,
    volume: SOFT,
  },
  landLower: {
    bus: "effects",
    files: [new URL("./sounds/land-lower-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 150,
    volume: FULL,
  },
  landRaise: {
    bus: "effects",
    files: [new URL("./sounds/land-raise-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 150,
    volume: FULL,
  },
  landSmooth: {
    bus: "effects",
    files: [new URL("./sounds/land-smooth-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 150,
    volume: FULL,
  },
  lava: {
    bus: "effects",
    files: [new URL("./sounds/lava-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 80,
    volume: FULL,
  },
  lightning: {
    bus: "effects",
    files: [
      new URL("./sounds/lightning-1.webm", import.meta.url).href,
      new URL("./sounds/lightning-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 250,
    volume: FULL,
  },
  meteorFall: {
    bus: "effects",
    files: [new URL("./sounds/meteor-fall-1.webm", import.meta.url).href],
    priority: 4,
    referenceDistance: 300,
    volume: FULL,
  },
  meteorImpact: {
    bus: "effects",
    files: [
      new URL("./sounds/meteor-impact-1.webm", import.meta.url).href,
      new URL("./sounds/meteor-impact-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 300,
    volume: FULL,
  },
  paintGround: {
    bus: "effects",
    files: [new URL("./sounds/paint-ground-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 150,
    volume: FULL,
  },
  rainStart: {
    bus: "effects",
    files: [new URL("./sounds/rain-start-1.webm", import.meta.url).href],
    priority: 2,
    referenceDistance: 150,
    volume: FULL,
  },
  snowStart: {
    bus: "effects",
    files: [new URL("./sounds/snow-start-1.webm", import.meta.url).href],
    priority: 2,
    referenceDistance: 150,
    volume: FULL,
  },
  spawn: {
    bus: "effects",
    files: [
      new URL("./sounds/spawn-1.webm", import.meta.url).href,
      new URL("./sounds/spawn-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 120,
    volume: FULL,
  },
  splash: {
    bus: "effects",
    files: [
      new URL("./sounds/splash-1.webm", import.meta.url).href,
      new URL("./sounds/splash-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 40,
    volume: SOFT,
  },
  thunderFar: {
    bus: "effects",
    files: [
      new URL("./sounds/thunder-far-1.webm", import.meta.url).href,
      new URL("./sounds/thunder-far-2.webm", import.meta.url).href,
      new URL("./sounds/thunder-far-3.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 1000,
    volume: FULL,
  },
  tornado: {
    bus: "effects",
    files: [new URL("./sounds/tornado-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 200,
    volume: FULL,
  },
  tribeArrive: {
    bus: "effects",
    files: [
      new URL("./sounds/tribe-arrive-1.webm", import.meta.url).href,
      new URL("./sounds/tribe-arrive-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 150,
    volume: FULL,
  },
  uiClick: interfaceSound(SOFT, [
    new URL("./sounds/ui-click-1.webm", import.meta.url).href,
    new URL("./sounds/ui-click-2.webm", import.meta.url).href,
    new URL("./sounds/ui-click-3.webm", import.meta.url).href,
  ]),
  uiClose: interfaceSound(SOFT, [
    new URL("./sounds/ui-close-1.webm", import.meta.url).href,
    new URL("./sounds/ui-close-2.webm", import.meta.url).href,
  ]),
  uiNotice: interfaceSound(FULL, [
    new URL("./sounds/ui-notice-1.webm", import.meta.url).href,
    new URL("./sounds/ui-notice-2.webm", import.meta.url).href,
  ]),
  uiOpen: interfaceSound(SOFT, [
    new URL("./sounds/ui-open-1.webm", import.meta.url).href,
    new URL("./sounds/ui-open-2.webm", import.meta.url).href,
  ]),
  uiPower: interfaceSound(SOFT, [
    new URL("./sounds/ui-power-1.webm", import.meta.url).href,
    new URL("./sounds/ui-power-2.webm", import.meta.url).href,
  ]),
  uiRefuse: interfaceSound(SOFT, [
    new URL("./sounds/ui-refuse-1.webm", import.meta.url).href,
    new URL("./sounds/ui-refuse-2.webm", import.meta.url).href,
  ]),
  uiTab: interfaceSound(SOFT, [
    new URL("./sounds/ui-tab-1.webm", import.meta.url).href,
    new URL("./sounds/ui-tab-2.webm", import.meta.url).href,
  ]),
  volcanoRise: {
    bus: "effects",
    files: [new URL("./sounds/volcano-rise-1.webm", import.meta.url).href],
    priority: 4,
    referenceDistance: 300,
    volume: FULL,
  },
  workBuild: {
    bus: "effects",
    files: [
      new URL("./sounds/work-build-1.webm", import.meta.url).href,
      new URL("./sounds/work-build-2.webm", import.meta.url).href,
      new URL("./sounds/work-build-3.webm", import.meta.url).href,
    ],
    priority: 0,
    referenceDistance: 20,
    volume: QUIET,
  },
  workChop: {
    bus: "effects",
    files: [
      new URL("./sounds/work-chop-1.webm", import.meta.url).href,
      new URL("./sounds/work-chop-2.webm", import.meta.url).href,
      new URL("./sounds/work-chop-3.webm", import.meta.url).href,
    ],
    priority: 0,
    referenceDistance: 20,
    volume: QUIET,
  },
  workDig: {
    bus: "effects",
    files: [
      new URL("./sounds/work-dig-1.webm", import.meta.url).href,
      new URL("./sounds/work-dig-2.webm", import.meta.url).href,
    ],
    priority: 0,
    referenceDistance: 20,
    volume: QUIET,
  },
  workMine: {
    bus: "effects",
    files: [
      new URL("./sounds/work-mine-1.webm", import.meta.url).href,
      new URL("./sounds/work-mine-2.webm", import.meta.url).href,
      new URL("./sounds/work-mine-3.webm", import.meta.url).href,
    ],
    priority: 0,
    referenceDistance: 20,
    volume: QUIET,
  },
} as const satisfies Record<string, SoundDefinition>;

export const AMBIENCE_LAYERS = {
  birdsDawn: ambienceLayer(new URL("./sounds/birds-dawn-1.webm", import.meta.url).href),
  birdsForest: ambienceLayer(new URL("./sounds/birds-forest-1.webm", import.meta.url).href),
  birdsMeadow: ambienceLayer(new URL("./sounds/birds-meadow-1.webm", import.meta.url).href),
  birdsTaiga: ambienceLayer(new URL("./sounds/birds-taiga-1.webm", import.meta.url).href),
  cicadas: ambienceLayer(new URL("./sounds/cicadas-1.webm", import.meta.url).href),
  crickets: ambienceLayer(new URL("./sounds/crickets-1.webm", import.meta.url).href),
  frogs: ambienceLayer(new URL("./sounds/frogs-1.webm", import.meta.url).href),
  rainHeavy: ambienceLayer(new URL("./sounds/rain-heavy-1.webm", import.meta.url).href),
  rainLight: ambienceLayer(new URL("./sounds/rain-light-1.webm", import.meta.url).href),
  stream: ambienceLayer(new URL("./sounds/stream-1.webm", import.meta.url).href),
  waves: ambienceLayer(new URL("./sounds/waves-1.webm", import.meta.url).href),
  windHigh: ambienceLayer(new URL("./sounds/wind-high-1.webm", import.meta.url).href),
  windLight: ambienceLayer(new URL("./sounds/wind-light-1.webm", import.meta.url).href),
  windSnowy: ambienceLayer(new URL("./sounds/wind-snowy-1.webm", import.meta.url).href),
  windStrong: ambienceLayer(new URL("./sounds/wind-strong-1.webm", import.meta.url).href),
} as const satisfies Record<string, SoundDefinition>;

export const MUSIC_TRACKS = {
  arcadeDay: [
    new URL("./sounds/music-arcade-day-1.webm", import.meta.url).href,
    new URL("./sounds/music-arcade-day-2.webm", import.meta.url).href,
  ],
  arcadeNight: [
    new URL("./sounds/music-arcade-night-1.webm", import.meta.url).href,
    new URL("./sounds/music-arcade-night-2.webm", import.meta.url).href,
  ],
  cozyDay: [
    new URL("./sounds/music-cozy-day-1.webm", import.meta.url).href,
    new URL("./sounds/music-cozy-day-2.webm", import.meta.url).href,
  ],
  cozyDusk: [
    new URL("./sounds/music-cozy-dusk-1.webm", import.meta.url).href,
    new URL("./sounds/music-cozy-dusk-2.webm", import.meta.url).href,
  ],
  cozyNight: [
    new URL("./sounds/music-cozy-night-1.webm", import.meta.url).href,
    new URL("./sounds/music-cozy-night-2.webm", import.meta.url).href,
  ],
} as const satisfies Record<string, readonly string[]>;

function interfaceSound(volume: number, files: readonly string[]): SoundDefinition {
  return { bus: "interface", files, priority: 1, referenceDistance: 0, volume };
}

function ambienceLayer(file: string): SoundDefinition {
  return { bus: "ambience", files: [file], priority: 0, referenceDistance: 0, volume: FULL };
}
