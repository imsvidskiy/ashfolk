import type { GenerationProgress, WorldRequest } from "../generation/generation-options.ts";
import { toError } from "../shared/errors.ts";
import { ignore } from "../shared/ignore.ts";
import type { ChronicleEntry } from "../simulation/chronicle.ts";
import type { SimulationCommand } from "../simulation/commands.ts";
import type { SimulationEffect } from "../simulation/effects.ts";
import type { SimulationFrame } from "../simulation/frame.ts";
import type { SavedWorldState } from "../simulation/saved-world.ts";
import { TICK_SECONDS } from "../simulation/tick.ts";
import type { SimulationConnection } from "./simulation-connection.ts";
import { WorldMirror } from "./world-mirror.ts";

export const CHRONICLE_HISTORY_LIMIT = 300;

const LONGEST_QUIET_SECONDS = 1;
const VIEW_COMMANDS: ReadonlySet<SimulationCommand["type"]> = new Set(["setSelection", "setViewFocus"]);

export type SessionStatus = { kind: "closed" } | { error: Error; kind: "failed" } | { kind: "running" };

type CommandListener = (command: SimulationCommand) => void;

type FrameListener = (frame: SimulationFrame) => void;

type StatusListener = (status: SessionStatus) => void;

interface SessionOptions {
  readonly onProgress?: (progress: GenerationProgress) => void;
}

interface LoadOptions extends SessionOptions {
  readonly journal?: readonly ChronicleEntry[];
}

interface SavedOrigin {
  readonly hasLandChanged: boolean;
  readonly journal: readonly ChronicleEntry[];
}

export class GameSession {
  readonly hasLandChanged: boolean;
  readonly mirror: WorldMirror;
  readonly #chronicle: ChronicleEntry[] = [];
  readonly #commandListeners = new Set<CommandListener>();
  readonly #connection: SimulationConnection;
  readonly #effects: SimulationEffect[] = [];
  readonly #frameListeners = new Set<FrameListener>();
  readonly #statusListeners = new Set<StatusListener>();
  #changes = 0;
  #commandsSinceRequest = 0;
  #pendingSeconds = 0;
  #request: Promise<void> | null = null;
  #status: SessionStatus = { kind: "running" };

  constructor(
    connection: SimulationConnection,
    mirror: WorldMirror,
    origin: SavedOrigin = { hasLandChanged: false, journal: [] }
  ) {
    this.#connection = connection;
    this.mirror = mirror;
    this.hasLandChanged = origin.hasLandChanged;
    this.#chronicle.push(...origin.journal);
    this.#remember(mirror.frame);
  }

  static async create(
    connection: SimulationConnection,
    request: WorldRequest,
    options: SessionOptions = {}
  ): Promise<GameSession> {
    const { onProgress = ignore } = options;

    const initial = await connection.createWorld(request, onProgress);

    return new GameSession(connection, new WorldMirror(initial, performance.now()));
  }

  static async load(
    connection: SimulationConnection,
    saved: SavedWorldState,
    options: LoadOptions = {}
  ): Promise<GameSession> {
    const { journal = [], onProgress = ignore } = options;

    const { hasLandChanged, world } = await connection.loadWorld(saved, onProgress);

    return new GameSession(connection, new WorldMirror(world, performance.now()), { hasLandChanged, journal });
  }

  get changes(): number {
    return this.#changes;
  }

  get chronicle(): readonly ChronicleEntry[] {
    return this.#chronicle;
  }

  get frame(): SimulationFrame {
    return this.mirror.frame;
  }

  get status(): SessionStatus {
    return this.#status;
  }

  send(command: SimulationCommand): void {
    if (this.#status.kind !== "running") {
      return;
    }

    this.#connection.send(command);

    if (!VIEW_COMMANDS.has(command.type)) {
      this.#changes += 1;
    }

    if (command.type !== "setViewFocus") {
      this.#commandsSinceRequest += 1;
    }

    for (const listener of this.#commandListeners) {
      listener(command);
    }
  }

  saveWorld(): Promise<SavedWorldState | null> {
    if (this.#status.kind !== "running") {
      return Promise.resolve(null);
    }

    return this.#connection.saveWorld();
  }

  update(realSeconds: number): void {
    if (this.#status.kind !== "running") {
      return;
    }

    this.#pendingSeconds += realSeconds;

    if (this.#request !== null || !this.#isAdvanceDue()) {
      return;
    }

    const seconds = this.#pendingSeconds;

    this.#pendingSeconds = 0;
    this.#commandsSinceRequest = 0;
    this.#request = this.#advance(seconds);
  }

  whenIdle(): Promise<void> {
    if (this.#request === null) {
      return Promise.resolve();
    }

    return this.#request;
  }

  takeEffects(): SimulationEffect[] {
    return this.#effects.splice(0);
  }

  subscribe(listener: FrameListener): () => void {
    this.#frameListeners.add(listener);

    return () => {
      this.#frameListeners.delete(listener);
    };
  }

  subscribeToCommands(listener: CommandListener): () => void {
    this.#commandListeners.add(listener);

    return () => {
      this.#commandListeners.delete(listener);
    };
  }

  subscribeToStatus(listener: StatusListener): () => void {
    this.#statusListeners.add(listener);

    return () => {
      this.#statusListeners.delete(listener);
    };
  }

  close(): void {
    if (this.#status.kind === "closed") {
      return;
    }

    this.#setStatus({ kind: "closed" });
    this.#commandListeners.clear();
    this.#frameListeners.clear();
    this.#statusListeners.clear();
    this.#connection.dispose();
  }

  #isAdvanceDue(): boolean {
    const { frame } = this.mirror;

    const hasCommands = this.#commandsSinceRequest > 0;
    const isQuietTooLong = this.#pendingSeconds >= LONGEST_QUIET_SECONDS;

    if (hasCommands || frame.isBusy || isQuietTooLong) {
      return true;
    }

    if (frame.isPaused) {
      return false;
    }

    return frame.secondsSinceTick + this.#pendingSeconds * frame.speed >= TICK_SECONDS;
  }

  async #advance(seconds: number): Promise<void> {
    try {
      const frame = await this.#connection.advance(seconds);

      this.#receive(frame);
    } catch (error) {
      this.#fail(toError(error));
    } finally {
      this.#request = null;
    }
  }

  #receive(frame: SimulationFrame): void {
    if (this.#status.kind !== "running") {
      return;
    }

    if (frame.tick !== this.mirror.frame.tick) {
      this.#changes += 1;
    }

    this.mirror.apply(frame, performance.now());
    this.#remember(frame);

    for (const listener of this.#frameListeners) {
      listener(frame);
    }
  }

  #remember(frame: SimulationFrame): void {
    this.#chronicle.push(...frame.chronicle);
    this.#effects.push(...frame.effects);

    const excess = this.#chronicle.length - CHRONICLE_HISTORY_LIMIT;

    if (excess > 0) {
      this.#chronicle.splice(0, excess);
    }
  }

  #fail(error: Error): void {
    if (this.#status.kind !== "running") {
      return;
    }

    console.error("The simulation stopped", error);
    this.#setStatus({ error, kind: "failed" });
    this.#connection.dispose();
  }

  #setStatus(status: SessionStatus): void {
    this.#status = status;

    for (const listener of this.#statusListeners) {
      listener(status);
    }
  }
}
