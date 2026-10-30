import type { PowerId } from "../content/powers.ts";
import type { WeatherKind } from "../content/weather.ts";
import { DEFAULT_WORLD_RULES, readWorldRules, type WorldRules } from "../content/world-rules.ts";
import type { GenerationOptions, GenerationProgress } from "../generation/generation-options.ts";
import { type GeneratedWorld, generateWorld } from "../generation/world-generator.ts";
import { clamp } from "../shared/math.ts";
import { createRandom, type RandomSource, type RandomState } from "../shared/random.ts";
import { mirroredWater } from "../world/water.ts";
import { keepApart } from "./agents/crowding.ts";
import { type DangerZone, HazardMap } from "./agents/hazards.ts";
import type { Mover } from "./agents/movement.ts";
import { NavigationGrid, type Waypoint } from "./agents/navigation.ts";
import { Chronicle, type ChronicleSnapshot } from "./chronicle.ts";
import { runCommand } from "./command-handlers.ts";
import { readCommand, type Selection } from "./commands.ts";
import { EffectLog } from "./effects.ts";
import { type FaunaSnapshot, FaunaSystem, type FaunaThreats } from "./fauna/fauna.ts";
import type { InitialWorld, SimulationFrame, WaterUpdate } from "./frame.ts";
import { FrameBuilder } from "./frame-builder.ts";
import { GRAB_HANDLERS } from "./hand/grab-handlers.ts";
import type { GrabTarget, HeldView } from "./hand/grab-target.ts";
import { IdentifierSource } from "./identifiers.ts";
import { Calendar, type CalendarSnapshot } from "./nature/calendar.ts";
import { type Ember, EmberSystem } from "./nature/embers.ts";
import { describeEnvironment, type Environment } from "./nature/environment.ts";
import { type FireSnapshot, FireSystem } from "./nature/fire.ts";
import { SurfaceSystem } from "./nature/surface.ts";
import { type VegetationGrowthSnapshot, VegetationGrowthSystem } from "./nature/vegetation-growth.ts";
import { type WeatherState, WeatherSystem } from "./nature/weather.ts";
import { naturalStrikeSite, strikeLightning } from "./powers/catastrophes.ts";
import { type PowerOutcome, type PowerServices, type PowerTarget, percent } from "./powers/power-handler.ts";
import { applyPower, parsePowerParameters } from "./powers/power-registry.ts";
import { TornadoSystem } from "./powers/tornadoes.ts";
import { type Volcano, VolcanoSystem } from "./powers/volcanoes.ts";
import { type BuildingIncidentKind, BuildingSystem, type BuildingsSnapshot } from "./society/buildings.ts";
import { type RivalrySnapshot, RivalrySystem } from "./society/rivalry/rivalry-system.ts";
import { type SocietySnapshot, SocietySystem } from "./society/society.ts";
import type { Tribe } from "./society/tribe.ts";
import { TICK_SECONDS } from "./tick.ts";
import { drowningText, drownMonuments } from "./world/monument-damage.ts";
import { WaterRecomputation, type WaterRecomputationSnapshot } from "./world/water-recomputation.ts";
import { type WorldSnapshot, WorldState } from "./world/world-state.ts";

const MAXIMUM_REAL_SECONDS = 0.25;
const MAXIMUM_TICKS_PER_ADVANCE = 40;
const NAVIGATION_CHECK_TICKS = 50;
const CROWDING_TICKS = 2;
const FIRST_STROKE_SECONDS = 1 / 30;
const HERDS_PER_SQUARE_KILOMETER = 0.49;
const SMALL_GAME_GROUPS_PER_SQUARE_KILOMETER = 0.74;
const STARTING_TRIBES = 3;
const STARTING_TRIBE_SIZE = 7;
const STARTING_SPOTS: readonly Waypoint[] = [
  { x: -0.35, z: 0.25 },
  { x: -0.6, z: 0.6 },
  { x: 0.05, z: 0.5 },
  { x: 0.25, z: -0.2 },
  { x: -0.5, z: 0 },
  { x: 0.45, z: 0.35 },
  { x: 0.2, z: -0.55 },
  { x: -0.3, z: -0.45 },
  { x: 0.55, z: -0.15 },
  { x: -0.15, z: 0.7 },
  { x: 0.6, z: 0.55 },
  { x: -0.6, z: -0.6 },
  { x: 0.5, z: -0.6 },
];
const HUNTER_NOTICE_DISTANCE = 18;
const GLOWING_EMBER_INTENSITY = 0.35;
const COOLING_EMBER_HEAT = 0.22;

export interface SimulationSnapshot {
  buildings: BuildingsSnapshot;
  calendar: CalendarSnapshot;
  chronicle: ChronicleSnapshot;
  embers: Ember[];
  fauna: FaunaSnapshot;
  fire: FireSnapshot;
  hazards: DangerZone[];
  identifiers: number;
  isPaused: boolean;
  random: RandomState;
  rivalry: RivalrySnapshot;
  rules: WorldRules;
  society: SocietySnapshot;
  speed: number;
  surfaceRow: number;
  tick: number;
  tickBacklog: number;
  vegetationGrowth: VegetationGrowthSnapshot;
  viewFocus: Waypoint;
  volcanoes?: Volcano[];
  waterRecomputation: WaterRecomputationSnapshot;
  weather: WeatherState;
  world: WorldSnapshot;
}

interface BrushStroke {
  apply: (target: PowerTarget) => PowerOutcome;
  startHeight: number;
  x: number;
  z: number;
}

interface Grab {
  isPlaceable: boolean;
  readonly origin: Waypoint;
  readonly target: GrabTarget;
  x: number;
  z: number;
}

interface ScheduledTask {
  remainingSeconds: number;
  run: () => void;
}

function incidentMessage(kind: BuildingIncidentKind, tribe: Tribe | null): string {
  const tribeName = tribe === null ? "A tribe" : tribe.name;

  if (kind === "caughtFire") {
    return `A building of ${tribeName} caught fire`;
  }

  return `The campfire of ${tribeName} spread to the grass`;
}

export class Simulation {
  readonly buildings: BuildingSystem;
  readonly calendar = new Calendar();
  readonly chronicle = new Chronicle();
  readonly effects = new EffectLog();
  readonly embers: EmberSystem;
  readonly fauna: FaunaSystem;
  readonly fire: FireSystem;
  readonly hazards: HazardMap;
  readonly identifiers = new IdentifierSource();
  readonly navigation: NavigationGrid;
  readonly random: RandomSource;
  readonly rivalry: RivalrySystem;
  readonly services: PowerServices;
  readonly society: SocietySystem;
  readonly surface: SurfaceSystem;
  readonly tornadoes = new TornadoSystem();
  readonly volcanoes = new VolcanoSystem();
  readonly waterRecomputation: WaterRecomputation;
  readonly weather = new WeatherSystem();
  readonly world: WorldState;
  readonly #faunaThreats: FaunaThreats;
  readonly #frameBuilder: FrameBuilder;
  readonly #vegetationGrowth: VegetationGrowthSystem;
  #grab: Grab | null = null;
  #isPaused: boolean;
  #notices: string[] = [];
  #selection: Selection | null = null;
  #speed = 1;
  #stroke: BrushStroke | null = null;
  #tasks: ScheduledTask[] = [];
  #tick = 0;
  #tickBacklog = 0;
  #viewFocus: Waypoint = { x: 0, z: 0 };
  #waterUpdate: WaterUpdate | null = null;

  constructor(generated: GeneratedWorld) {
    this.world = new WorldState(generated);
    this.random = createRandom(generated.seed * 5 + 17);
    this.navigation = new NavigationGrid(this.world);
    this.fire = new FireSystem(this.world);
    this.hazards = new HazardMap(this.world, this.fire);
    this.embers = new EmberSystem(this.world, this.effects);
    this.surface = new SurfaceSystem(this.world);
    this.#vegetationGrowth = new VegetationGrowthSystem(this.world);
    this.waterRecomputation = new WaterRecomputation(this.world);
    this.fauna = new FaunaSystem(this.world, this.navigation, this.identifiers);
    this.buildings = new BuildingSystem(this.world, this.identifiers);
    this.society = new SocietySystem({
      buildings: this.buildings,
      chronicle: this.chronicle,
      identifiers: this.identifiers,
      world: this.world,
    });
    this.rivalry = new RivalrySystem({ chronicle: this.chronicle, effects: this.effects, seed: generated.seed });
    this.services = this.#createServices();
    this.#faunaThreats = this.#createFaunaThreats();
    this.#frameBuilder = new FrameBuilder(this);
    this.#isPaused = false;
  }

  static generate(
    seed: number,
    options: GenerationOptions,
    onProgress: (progress: GenerationProgress) => void
  ): Simulation {
    return new Simulation(generateWorld(seed, options, onProgress));
  }

  get environment(): Environment {
    return describeEnvironment(this.calendar, this.weather);
  }

  get isBusy(): boolean {
    return (
      this.#tasks.length > 0 ||
      this.#stroke !== null ||
      this.#grab !== null ||
      this.tornadoes.isActive ||
      this.waterRecomputation.isPending
    );
  }

  get held(): HeldView | null {
    const grab = this.#grab;

    if (grab === null) {
      return null;
    }

    return { ...grab.target, isPlaceable: grab.isPlaceable, x: grab.x, z: grab.z };
  }

  get isPaused(): boolean {
    return this.#isPaused;
  }

  get rules(): WorldRules {
    return this.services.rules;
  }

  get secondsSinceTick(): number {
    return this.#tickBacklog;
  }

  get selection(): Selection | null {
    return this.#selection;
  }

  get speed(): number {
    return this.#speed;
  }

  get tick(): number {
    return this.#tick;
  }

  populate(): void {
    const { halfSize, squareKilometers } = this.world.grid;

    let settled = 0;

    for (const spot of STARTING_SPOTS) {
      if (settled >= STARTING_TRIBES) {
        break;
      }

      if (this.#spawnTribe(spot.x * halfSize, spot.z * halfSize)) {
        settled += 1;
      }
    }

    if (settled === 0) {
      this.#spawnTribe(0, 0);
    }

    this.fauna.populate(Math.round(HERDS_PER_SQUARE_KILOMETER * squareKilometers), this.random);
    this.fauna.populateSmallGame(Math.round(SMALL_GAME_GROUPS_PER_SQUARE_KILOMETER * squareKilometers));
    this.chronicle.takeEntries();
  }

  snapshot(): SimulationSnapshot | null {
    if (this.isBusy) {
      return null;
    }

    return {
      buildings: this.buildings.snapshot(),
      calendar: this.calendar.snapshot(),
      chronicle: this.chronicle.snapshot(),
      embers: this.embers.snapshot(),
      fauna: this.fauna.snapshot(),
      fire: this.fire.snapshot(),
      hazards: this.hazards.snapshot(),
      identifiers: this.identifiers.upcoming,
      isPaused: this.#isPaused,
      random: this.random.state(),
      rivalry: this.rivalry.snapshot(this.society.people),
      rules: structuredClone(this.rules),
      society: this.society.snapshot(),
      speed: this.#speed,
      surfaceRow: this.surface.nextRow,
      tick: this.#tick,
      tickBacklog: this.#tickBacklog,
      vegetationGrowth: this.#vegetationGrowth.snapshot(),
      viewFocus: { ...this.#viewFocus },
      volcanoes: this.volcanoes.snapshot(),
      waterRecomputation: this.waterRecomputation.snapshot(),
      weather: this.weather.snapshot(),
      world: this.world.snapshot(),
    };
  }

  restore(snapshot: SimulationSnapshot): void {
    this.world.restore(snapshot.world);
    this.waterRecomputation.restore(snapshot.waterRecomputation);
    this.navigation.rebuild();
    this.calendar.restore(snapshot.calendar);
    this.weather.restore(snapshot.weather);
    this.chronicle.restore(snapshot.chronicle);
    this.identifiers.restore(snapshot.identifiers);
    this.random.restore(snapshot.random);
    this.fire.restore(snapshot.fire);
    this.embers.restore(snapshot.embers);
    this.hazards.restore(snapshot.hazards);
    this.surface.restore(snapshot.surfaceRow);
    this.#vegetationGrowth.restore(snapshot.vegetationGrowth);
    this.buildings.restore(snapshot.buildings);
    this.society.restore(snapshot.society);
    this.fauna.restore(snapshot.fauna);
    this.rivalry.restore(snapshot.rivalry, this.society);
    this.volcanoes.restore(snapshot.volcanoes === undefined ? [] : snapshot.volcanoes);
    this.setRules(readWorldRules(snapshot.rules));
    this.services.environment = describeEnvironment(this.calendar, this.weather);
    this.#isPaused = snapshot.isPaused;
    this.#speed = snapshot.speed;
    this.#tick = snapshot.tick;
    this.#tickBacklog = snapshot.tickBacklog;
    this.#viewFocus = { ...snapshot.viewFocus };
    this.#tasks = [];
    this.tornadoes.clear();
    this.#stroke = null;
    this.#grab = null;
    this.#notices = [];
    this.#waterUpdate = null;
    this.effects.takeEffects();
  }

  execute(command: unknown): void {
    const parsed = readCommand(command);

    if (parsed === null) {
      return;
    }

    runCommand(this, parsed.type, parsed);
  }

  usePower(powerId: PowerId, x: number, z: number, values: unknown): void {
    const parameters = parsePowerParameters(powerId, values);

    if (parameters === null) {
      return;
    }

    const target = { seconds: 0, strokeStartHeight: this.world.heightAt(x, z), x, z };

    this.#recordOutcome(applyPower(powerId, parameters, target, this.services));
  }

  beginStroke(powerId: PowerId, x: number, z: number, values: Readonly<Record<string, unknown>>): void {
    const parameters = parsePowerParameters(powerId, values);

    if (parameters === null) {
      this.#stroke = null;

      return;
    }

    this.#stroke = {
      apply: (target) => {
        return applyPower(powerId, parameters, target, this.services);
      },
      startHeight: this.world.heightAt(x, z),
      x,
      z,
    };
    this.#applyStroke(FIRST_STROKE_SECONDS);
  }

  moveStroke(x: number, z: number): void {
    if (this.#stroke === null) {
      return;
    }

    this.#stroke.x = x;
    this.#stroke.z = z;
  }

  endStroke(): void {
    this.#stroke = null;
  }

  grab(target: GrabTarget): void {
    this.cancelGrab();

    const handler = GRAB_HANDLERS[target.kind];
    const origin = handler.lift(this.services, target.id);

    if (origin === null) {
      return;
    }

    this.#grab = {
      isPlaceable: handler.canPlace(this.services, target.id, origin.x, origin.z),
      origin,
      target,
      x: origin.x,
      z: origin.z,
    };
  }

  carry(x: number, z: number): void {
    const grab = this.#grab;

    if (grab === null) {
      return;
    }

    const handler = GRAB_HANDLERS[grab.target.kind];

    handler.carry(this.services, grab.target.id, x, z);
    grab.x = x;
    grab.z = z;
    grab.isPlaceable = handler.canPlace(this.services, grab.target.id, x, z);
  }

  drop(): void {
    const grab = this.#grab;

    if (grab === null) {
      return;
    }

    const { id, kind } = grab.target;

    const handler = GRAB_HANDLERS[kind];

    if (handler.canPlace(this.services, id, grab.x, grab.z)) {
      handler.place(this.services, id, grab.x, grab.z);
    } else {
      handler.putBack(this.services, id, grab.origin);
    }

    this.#grab = null;
  }

  cancelGrab(): void {
    const grab = this.#grab;

    if (grab === null) {
      return;
    }

    GRAB_HANDLERS[grab.target.kind].putBack(this.services, grab.target.id, grab.origin);
    this.#grab = null;
  }

  setPaused(isPaused: boolean): void {
    this.#isPaused = isPaused;
  }

  setSpeed(speed: number): void {
    this.#speed = speed;
  }

  setRules(rules: WorldRules): void {
    this.services.rules = rules;
  }

  setSelection(selection: Selection | null): void {
    this.#selection = selection;
  }

  setViewFocus(x: number, z: number): void {
    this.#viewFocus = { x, z };
  }

  setWeather(weather: WeatherKind | "automatic"): void {
    if (weather === "automatic") {
      this.weather.setAutomatic();

      return;
    }

    this.weather.setKind(weather);
  }

  takeNotices(): string[] {
    const notices = this.#notices;

    this.#notices = [];

    return notices;
  }

  takeWaterUpdate(): WaterUpdate | null {
    const update = this.#waterUpdate;

    this.#waterUpdate = null;

    return update;
  }

  advance(realSeconds: number): SimulationFrame {
    const seconds = clamp(realSeconds, 0, MAXIMUM_REAL_SECONDS);

    this.#recomputeWaterWhenSettled(seconds);
    this.#applyStroke(seconds);
    this.#runTasks(seconds);
    this.#tickBacklog += this.#gameSeconds(seconds);

    let ticks = 0;

    while (this.#tickBacklog >= TICK_SECONDS && ticks < MAXIMUM_TICKS_PER_ADVANCE) {
      this.step();
      this.#tickBacklog -= TICK_SECONDS;
      ticks += 1;
    }

    this.#tickBacklog = Math.min(this.#tickBacklog, TICK_SECONDS);

    return this.#frameBuilder.build();
  }

  runTicks(count: number): void {
    for (let tick = 0; tick < count; tick += 1) {
      this.step();
    }
  }

  step(): void {
    const days = this.calendar.advance(TICK_SECONDS);

    this.chronicle.day = this.calendar.day;
    this.#updateWeather(days);

    const environment = describeEnvironment(this.calendar, this.weather);

    this.services.environment = environment;
    this.#updateNature(days, environment);
    this.#updateLife(days, environment);
    this.#tick += 1;

    if (this.#tick % NAVIGATION_CHECK_TICKS === 0) {
      this.navigation.rebuildIfChanged();
    }
  }

  initialWorld(): InitialWorld {
    return this.#frameBuilder.initialWorld();
  }

  #gameSeconds(realSeconds: number): number {
    if (this.#isPaused) {
      return 0;
    }

    return realSeconds * this.#speed;
  }

  #schedule(delaySeconds: number, run: () => void): void {
    this.#tasks.push({ remainingSeconds: delaySeconds, run });
  }

  #createServices(): PowerServices {
    return {
      buildings: this.buildings,
      chronicle: this.chronicle,
      effects: this.effects,
      embers: this.embers,
      environment: describeEnvironment(this.calendar, this.weather),
      fauna: this.fauna,
      fire: this.fire,
      hazards: this.hazards,
      identifiers: this.identifiers,
      navigation: this.navigation,
      people: this.society,
      random: this.random,
      rivalry: this.rivalry,
      rules: DEFAULT_WORLD_RULES,
      schedule: (delaySeconds, run) => {
        this.#schedule(delaySeconds, run);
      },
      tornadoes: this.tornadoes,
      volcanoes: this.volcanoes,
      world: this.world,
    };
  }

  #createFaunaThreats(): FaunaThreats {
    return {
      dangerNear: (x, z, radius) => {
        return this.hazards.dangerNear(x, z, radius);
      },
      hunterNear: (x, z, radius) => {
        const hunter = this.society.nearestPerson(x, z, radius, (person) => {
          const isStalking = person.job?.kind === "hunt";

          return !isStalking || Math.hypot(person.mover.x - x, person.mover.z - z) < HUNTER_NOTICE_DISTANCE;
        });

        if (hunter === null) {
          return null;
        }

        return { x: hunter.mover.x, z: hunter.mover.z };
      },
      people: this.rivalry.senses(this.services),
    };
  }

  #spawnTribe(x: number, z: number): boolean {
    const tribe = this.society.spawnTribe({
      context: this.services,
      people: STARTING_TRIBE_SIZE,
      technologies: [],
      x,
      z,
    });

    return tribe !== null;
  }

  #recordOutcome(outcome: PowerOutcome): void {
    if (outcome.kind === "refused") {
      this.#notices.push(outcome.reason);
    }
  }

  #applyStroke(seconds: number): void {
    const stroke = this.#stroke;

    if (stroke === null || seconds <= 0) {
      return;
    }

    const target = { seconds, strokeStartHeight: stroke.startHeight, x: stroke.x, z: stroke.z };

    this.#recordOutcome(stroke.apply(target));
  }

  #runTasks(seconds: number): void {
    const due: ScheduledTask[] = [];

    for (const task of this.#tasks) {
      task.remainingSeconds -= seconds;

      if (task.remainingSeconds <= 0) {
        due.push(task);
      }
    }

    this.#tasks = this.#tasks.filter((task) => {
      return task.remainingSeconds > 0;
    });

    for (const task of due) {
      task.run();
    }
  }

  #recomputeWaterWhenSettled(seconds: number): void {
    const change = this.waterRecomputation.update(seconds);

    if (change === "none") {
      return;
    }

    if (change === "settled") {
      this.navigation.rebuildIfChanged();
    }

    if (change === "features") {
      this.navigation.rebuild();
      this.#waterUpdate = {
        crossings: this.world.crossings,
        features: mirroredWater(this.world.water),
        riverStrength: Uint8Array.from(this.world.terrain.riverStrength),
        waterSurface: Float32Array.from(this.world.terrain.waterSurface),
      };
    }

    this.#settleNewWater();
  }

  #settleNewWater(): void {
    for (const building of [...this.buildings.all]) {
      if (building.cell >= 0 && this.world.isWater(building.cell)) {
        this.buildings.remove(building, "destroyed");
      }
    }

    for (const monument of drownMonuments(this.world)) {
      this.chronicle.record({
        category: "warning",
        text: drowningText(monument),
        tribeId: null,
        x: monument.x,
        z: monument.z,
      });
    }
  }

  #updateWeather(days: number): void {
    const update = this.weather.update(
      { day: this.calendar.day, elapsedDays: days, elapsedSeconds: TICK_SECONDS, season: this.calendar.season },
      this.services.rules,
      this.random
    );

    if (update.changedTo !== null) {
      this.chronicle.record({
        category: "weather",
        text: `The weather turned: ${this.weather.name.toLowerCase()}`,
        tribeId: null,
        x: this.#viewFocus.x,
        z: this.#viewFocus.z,
      });
    }

    for (let strike = 0; strike < update.lightningStrikes; strike += 1) {
      this.#strikeNaturalLightning();
    }
  }

  #strikeNaturalLightning(): void {
    const site = naturalStrikeSite(this.#viewFocus, this.services);

    if (site === null) {
      return;
    }

    const ignitionChance = percent(this.services.rules.storms.lightningIgnition);

    strikeLightning({ ignitionChance, isNatural: true, x: site.x, z: site.z }, this.services);
  }

  #updateNature(days: number, environment: Environment): void {
    const { rules } = this.services;

    this.fire.setWind(environment.windX, environment.windZ, environment.windSpeed, rules);

    const wind = { strength: this.fire.windStrength, x: environment.windX, z: environment.windZ };

    for (const cell of this.fire.update(TICK_SECONDS, environment, rules, this.random)) {
      this.embers.launch(cell, wind, this.random);
    }

    this.embers.update(TICK_SECONDS, (ember) => {
      this.#landEmber(ember);
    });
    this.tornadoes.update(TICK_SECONDS, this.services);
    this.volcanoes.update(TICK_SECONDS, this.services);
    this.surface.update(TICK_SECONDS, days, environment, rules);
    this.#vegetationGrowth.update(days, environment, rules, this.random);
  }

  #landEmber(ember: Ember): void {
    const cell = this.world.grid.cellAt(ember.toX, ember.toZ);

    if (ember.isGlowing) {
      this.fire.ignite(cell, GLOWING_EMBER_INTENSITY);

      return;
    }

    this.fire.addHeat(cell, COOLING_EMBER_HEAT);
  }

  #updateLife(days: number, environment: Environment): void {
    const { rules } = this.services;

    this.buildings.update({
      days,
      fire: this.fire,
      random: this.random,
      seconds: TICK_SECONDS,
      weather: environment,
    });
    this.society.update(TICK_SECONDS, days, this.services);
    this.rivalry.update(TICK_SECONDS, days, this.services);
    this.fauna.update({
      days,
      hours: environment.hours,
      random: this.random,
      rules,
      season: environment.season,
      seconds: TICK_SECONDS,
      threats: this.#faunaThreats,
    });
    this.hazards.update(TICK_SECONDS);

    if (this.#tick % CROWDING_TICKS === 0) {
      this.#keepAgentsApart();
    }

    this.#recordBuildingIncidents();
    this.#recordSplashes();
  }

  #keepAgentsApart(): void {
    const movers: Mover[] = [];

    for (const person of this.society.people) {
      if (person.isAlive && !this.society.isHeld(person)) {
        movers.push(person.mover);
      }
    }

    for (const animal of this.fauna.animals) {
      if (animal.isAlive && !this.fauna.isHeld(animal)) {
        movers.push(animal.mover);
      }
    }

    keepApart(movers, this.world, TICK_SECONDS * CROWDING_TICKS);
  }

  #recordSplashes(): void {
    for (const person of this.society.people) {
      this.#recordSplash(person.mover);
    }

    for (const animal of this.fauna.animals) {
      this.#recordSplash(animal.mover);
    }
  }

  #recordSplash(mover: Mover): void {
    if (mover.splash === null) {
      return;
    }

    this.effects.add({ ...mover.splash, kind: "splash" });
    mover.splash = null;
  }

  #recordBuildingIncidents(): void {
    for (const incident of this.buildings.takeIncidents()) {
      const tribe = this.society.findTribe(incident.building.tribeId);

      this.chronicle.record({
        category: "fire",
        text: incidentMessage(incident.kind, tribe),
        tribeId: incident.building.tribeId,
        x: incident.building.x,
        z: incident.building.z,
      });
    }
  }
}
