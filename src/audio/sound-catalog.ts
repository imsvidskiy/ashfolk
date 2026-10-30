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
    volume: 0.55,
  },
  animalHare: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-hare-1.webm", import.meta.url).href,
      new URL("./sounds/animal-hare-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 40,
    volume: 0.5,
  },
  animalIbex: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-ibex-1.webm", import.meta.url).href,
      new URL("./sounds/animal-ibex-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 60,
    volume: 0.55,
  },
  animalMammoth: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-mammoth-1.webm", import.meta.url).href,
      new URL("./sounds/animal-mammoth-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 90,
    volume: 0.65,
  },
  animalWolves: {
    bus: "effects",
    files: [
      new URL("./sounds/animal-wolves-1.webm", import.meta.url).href,
      new URL("./sounds/animal-wolves-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 120,
    volume: 0.55,
  },
  arrow: {
    bus: "effects",
    files: [
      new URL("./sounds/arrow-1.webm", import.meta.url).href,
      new URL("./sounds/arrow-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 25,
    volume: 0.4,
  },
  blessingAbundance: {
    bus: "effects",
    files: [
      new URL("./sounds/blessing-abundance-1.webm", import.meta.url).href,
      new URL("./sounds/blessing-abundance-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 120,
    volume: 0.8,
  },
  blessingHealing: {
    bus: "effects",
    files: [
      new URL("./sounds/blessing-healing-1.webm", import.meta.url).href,
      new URL("./sounds/blessing-healing-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 120,
    volume: 0.8,
  },
  blessingInspiration: {
    bus: "effects",
    files: [
      new URL("./sounds/blessing-inspiration-1.webm", import.meta.url).href,
      new URL("./sounds/blessing-inspiration-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 120,
    volume: 0.8,
  },
  buildingDone: {
    bus: "effects",
    files: [
      new URL("./sounds/building-done-1.webm", import.meta.url).href,
      new URL("./sounds/building-done-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 60,
    volume: 0.55,
  },
  earthquake: {
    bus: "effects",
    files: [
      new URL("./sounds/earthquake-1.webm", import.meta.url).href,
      new URL("./sounds/earthquake-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 300,
    volume: 0.9,
  },
  eventBirth: {
    bus: "interface",
    files: [new URL("./sounds/event-birth-1.webm", import.meta.url).href],
    priority: 1,
    referenceDistance: 0,
    volume: 0.4,
  },
  eventDeath: {
    bus: "interface",
    files: [new URL("./sounds/event-death-1.webm", import.meta.url).href],
    priority: 1,
    referenceDistance: 0,
    volume: 0.4,
  },
  eventDiscovery: {
    bus: "interface",
    files: [new URL("./sounds/event-discovery-1.webm", import.meta.url).href],
    priority: 1,
    referenceDistance: 0,
    volume: 0.5,
  },
  eventEra: {
    bus: "interface",
    files: [new URL("./sounds/event-era-1.webm", import.meta.url).href],
    priority: 1,
    referenceDistance: 0,
    volume: 0.6,
  },
  eventRaid: {
    bus: "interface",
    files: [new URL("./sounds/event-raid-1.webm", import.meta.url).href],
    priority: 1,
    referenceDistance: 0,
    volume: 0.5,
  },
  explosion: {
    bus: "effects",
    files: [
      new URL("./sounds/explosion-1.webm", import.meta.url).href,
      new URL("./sounds/explosion-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 250,
    volume: 0.9,
  },
  explosionWater: {
    bus: "effects",
    files: [
      new URL("./sounds/explosion-water-1.webm", import.meta.url).href,
      new URL("./sounds/explosion-water-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 250,
    volume: 0.9,
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
    volume: 0.4,
  },
  fire: {
    bus: "effects",
    files: [new URL("./sounds/fire-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 80,
    volume: 0.6,
  },
  fireIgnite: {
    bus: "effects",
    files: [
      new URL("./sounds/fire-ignite-1.webm", import.meta.url).href,
      new URL("./sounds/fire-ignite-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 80,
    volume: 0.6,
  },
  forestGrow: {
    bus: "effects",
    files: [
      new URL("./sounds/forest-grow-1.webm", import.meta.url).href,
      new URL("./sounds/forest-grow-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 120,
    volume: 0.6,
  },
  handDrop: {
    bus: "effects",
    files: [
      new URL("./sounds/hand-drop-1.webm", import.meta.url).href,
      new URL("./sounds/hand-drop-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 0,
    volume: 0.55,
  },
  handGrab: {
    bus: "effects",
    files: [
      new URL("./sounds/hand-grab-1.webm", import.meta.url).href,
      new URL("./sounds/hand-grab-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 0,
    volume: 0.55,
  },
  landLower: {
    bus: "effects",
    files: [new URL("./sounds/land-lower-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 150,
    volume: 0.55,
  },
  landRaise: {
    bus: "effects",
    files: [new URL("./sounds/land-raise-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 150,
    volume: 0.55,
  },
  landSmooth: {
    bus: "effects",
    files: [new URL("./sounds/land-smooth-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 150,
    volume: 0.5,
  },
  lava: {
    bus: "effects",
    files: [new URL("./sounds/lava-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 80,
    volume: 0.6,
  },
  lightning: {
    bus: "effects",
    files: [
      new URL("./sounds/lightning-1.webm", import.meta.url).href,
      new URL("./sounds/lightning-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 250,
    volume: 0.85,
  },
  meteorFall: {
    bus: "effects",
    files: [new URL("./sounds/meteor-fall-1.webm", import.meta.url).href],
    priority: 4,
    referenceDistance: 300,
    volume: 0.8,
  },
  meteorImpact: {
    bus: "effects",
    files: [
      new URL("./sounds/meteor-impact-1.webm", import.meta.url).href,
      new URL("./sounds/meteor-impact-2.webm", import.meta.url).href,
    ],
    priority: 4,
    referenceDistance: 300,
    volume: 0.95,
  },
  paintGround: {
    bus: "effects",
    files: [new URL("./sounds/paint-ground-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 150,
    volume: 0.45,
  },
  rainStart: {
    bus: "effects",
    files: [new URL("./sounds/rain-start-1.webm", import.meta.url).href],
    priority: 2,
    referenceDistance: 150,
    volume: 0.6,
  },
  snowStart: {
    bus: "effects",
    files: [new URL("./sounds/snow-start-1.webm", import.meta.url).href],
    priority: 2,
    referenceDistance: 150,
    volume: 0.6,
  },
  spawn: {
    bus: "effects",
    files: [
      new URL("./sounds/spawn-1.webm", import.meta.url).href,
      new URL("./sounds/spawn-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 120,
    volume: 0.7,
  },
  splash: {
    bus: "effects",
    files: [
      new URL("./sounds/splash-1.webm", import.meta.url).href,
      new URL("./sounds/splash-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 40,
    volume: 0.55,
  },
  steam: {
    bus: "effects",
    files: [
      new URL("./sounds/steam-1.webm", import.meta.url).href,
      new URL("./sounds/steam-2.webm", import.meta.url).href,
    ],
    priority: 2,
    referenceDistance: 40,
    volume: 0.5,
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
    volume: 0.6,
  },
  tornado: {
    bus: "effects",
    files: [new URL("./sounds/tornado-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 200,
    volume: 0.85,
  },
  treeFall: {
    bus: "effects",
    files: [
      new URL("./sounds/tree-fall-1.webm", import.meta.url).href,
      new URL("./sounds/tree-fall-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 40,
    volume: 0.55,
  },
  tribeArrive: {
    bus: "effects",
    files: [
      new URL("./sounds/tribe-arrive-1.webm", import.meta.url).href,
      new URL("./sounds/tribe-arrive-2.webm", import.meta.url).href,
    ],
    priority: 3,
    referenceDistance: 150,
    volume: 0.7,
  },
  uiClick: {
    bus: "interface",
    files: [
      new URL("./sounds/ui-click-1.webm", import.meta.url).href,
      new URL("./sounds/ui-click-2.webm", import.meta.url).href,
      new URL("./sounds/ui-click-3.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 0,
    volume: 0.45,
  },
  uiClose: {
    bus: "interface",
    files: [
      new URL("./sounds/ui-close-1.webm", import.meta.url).href,
      new URL("./sounds/ui-close-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 0,
    volume: 0.45,
  },
  uiNotice: {
    bus: "interface",
    files: [
      new URL("./sounds/ui-notice-1.webm", import.meta.url).href,
      new URL("./sounds/ui-notice-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 0,
    volume: 0.4,
  },
  uiOpen: {
    bus: "interface",
    files: [
      new URL("./sounds/ui-open-1.webm", import.meta.url).href,
      new URL("./sounds/ui-open-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 0,
    volume: 0.5,
  },
  uiPower: {
    bus: "interface",
    files: [
      new URL("./sounds/ui-power-1.webm", import.meta.url).href,
      new URL("./sounds/ui-power-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 0,
    volume: 0.5,
  },
  uiRefuse: {
    bus: "interface",
    files: [
      new URL("./sounds/ui-refuse-1.webm", import.meta.url).href,
      new URL("./sounds/ui-refuse-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 0,
    volume: 0.55,
  },
  uiSave: {
    bus: "interface",
    files: [
      new URL("./sounds/ui-save-1.webm", import.meta.url).href,
      new URL("./sounds/ui-save-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 0,
    volume: 0.5,
  },
  uiTab: {
    bus: "interface",
    files: [
      new URL("./sounds/ui-tab-1.webm", import.meta.url).href,
      new URL("./sounds/ui-tab-2.webm", import.meta.url).href,
    ],
    priority: 1,
    referenceDistance: 0,
    volume: 0.45,
  },
  volcanoRise: {
    bus: "effects",
    files: [new URL("./sounds/volcano-rise-1.webm", import.meta.url).href],
    priority: 4,
    referenceDistance: 300,
    volume: 0.9,
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
    volume: 0.35,
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
    volume: 0.35,
  },
  workDig: {
    bus: "effects",
    files: [
      new URL("./sounds/work-dig-1.webm", import.meta.url).href,
      new URL("./sounds/work-dig-2.webm", import.meta.url).href,
    ],
    priority: 0,
    referenceDistance: 20,
    volume: 0.3,
  },
  workForge: {
    bus: "effects",
    files: [
      new URL("./sounds/work-forge-1.webm", import.meta.url).href,
      new URL("./sounds/work-forge-2.webm", import.meta.url).href,
    ],
    priority: 0,
    referenceDistance: 20,
    volume: 0.35,
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
    volume: 0.35,
  },
} as const satisfies Record<string, SoundDefinition>;

export const AMBIENCE_LAYERS = {
  birdsDawn: {
    bus: "ambience",
    files: [new URL("./sounds/birds-dawn-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  birdsForest: {
    bus: "ambience",
    files: [new URL("./sounds/birds-forest-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  birdsMeadow: {
    bus: "ambience",
    files: [new URL("./sounds/birds-meadow-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  birdsTaiga: {
    bus: "ambience",
    files: [new URL("./sounds/birds-taiga-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  cicadas: {
    bus: "ambience",
    files: [new URL("./sounds/cicadas-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  crickets: {
    bus: "ambience",
    files: [new URL("./sounds/crickets-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  frogs: {
    bus: "ambience",
    files: [new URL("./sounds/frogs-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  rainHeavy: {
    bus: "ambience",
    files: [new URL("./sounds/rain-heavy-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  rainLight: {
    bus: "ambience",
    files: [new URL("./sounds/rain-light-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  stream: {
    bus: "ambience",
    files: [new URL("./sounds/stream-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  waves: {
    bus: "ambience",
    files: [new URL("./sounds/waves-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  windHigh: {
    bus: "ambience",
    files: [new URL("./sounds/wind-high-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  windLight: {
    bus: "ambience",
    files: [new URL("./sounds/wind-light-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  windSnowy: {
    bus: "ambience",
    files: [new URL("./sounds/wind-snowy-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
  windStrong: {
    bus: "ambience",
    files: [new URL("./sounds/wind-strong-1.webm", import.meta.url).href],
    priority: 0,
    referenceDistance: 0,
    volume: 1,
  },
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
