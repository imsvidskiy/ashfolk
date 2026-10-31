import * as z from "zod/mini";

type NameReader = { readonly index: (catalog: string, name: string) => number };
type NameWriter = { readonly name: (catalog: string, index: number) => string };
type Issuer = { readonly player: number };
type Refusal = { readonly message: string };

export interface Tick {
  readonly day: number;
  readonly index: number;
  readonly seconds: number;
  readonly step: number;
}

export type RestoreOutcome = "invalid" | "restored";

export interface SaveSectionSpec<Saved> {
  readonly isEssential: boolean;
  readonly key: string;
  readonly read: (saved: Saved, names: NameReader) => void;
  readonly requires: readonly string[];
  readonly reset: () => void;
  readonly schema: z.ZodMiniType<Saved>;
  readonly write: (names: NameWriter) => Saved;
}

export interface SaveSection {
  readonly isEssential: boolean;
  readonly key: string;
  readonly requires: readonly string[];
  readonly reset: () => void;
  readonly restore: (raw: unknown, names: NameReader) => RestoreOutcome;
  readonly write: (names: NameWriter) => unknown;
}

export function defineSaveSection<Saved>(spec: SaveSectionSpec<Saved>): SaveSection {
  return {
    isEssential: spec.isEssential,
    key: spec.key,
    requires: spec.requires,
    reset: spec.reset,
    restore: (raw, names) => {
      const parsed = spec.schema.safeParse(raw);

      if (!parsed.success) {
        return "invalid";
      }

      spec.read(parsed.data, names);

      return "restored";
    },
    write: (names) => {
      return spec.write(names);
    },
  };
}

export interface CommandDeclaration<Kind extends string, Payload> {
  readonly kind: Kind;
  readonly schema: z.ZodMiniType<Payload>;
}

export function declareCommand<const Kind extends string, Payload>(
  kind: Kind,
  schema: z.ZodMiniType<Payload>,
): CommandDeclaration<Kind, Payload> {
  return { kind, schema };
}

export interface CommandHandler {
  readonly apply: (raw: unknown, issuer: Issuer, tick: Tick) => Refusal | null;
  readonly kind: string;
}

export function handleCommand<Kind extends string, Payload>(
  declaration: CommandDeclaration<Kind, Payload>,
  apply: (payload: Payload, issuer: Issuer, tick: Tick) => Refusal | null,
): CommandHandler {
  return {
    apply: (raw, issuer, tick) => {
      const parsed = declaration.schema.safeParse(raw);

      if (!parsed.success) {
        return { message: "command.invalid" };
      }

      return apply(parsed.data, issuer, tick);
    },
    kind: declaration.kind,
  };
}

export interface EventQueue {
  readonly order: EventChannel<never>["deliverNext"][];
}

export interface EventChannel<Payload> {
  readonly deliverNext: (tick: Tick) => void;
  readonly emit: (payload: Payload) => void;
  readonly listeners: ((tick: Tick, payload: Payload) => void)[];
}

export interface EventHandle<Payload> {
  readonly channel: (queue: EventQueue) => EventChannel<Payload>;
  readonly id: string;
  readonly isPresented: boolean;
}

export interface EventListener {
  readonly attach: (queue: EventQueue) => void;
}

function createChannel<Payload>(queue: EventQueue): EventChannel<Payload> {
  const pending: Payload[] = [];
  let next = 0;
  const listeners: ((tick: Tick, payload: Payload) => void)[] = [];

  function deliverNext(tick: Tick): void {
    const payload = pending[next];

    next += 1;

    if (payload === undefined) {
      return;
    }

    for (const listener of listeners) {
      listener(tick, payload);
    }

    if (next === pending.length) {
      pending.length = 0;
      next = 0;
    }
  }

  return {
    deliverNext,
    emit: (payload) => {
      pending.push(payload);
      queue.order.push(deliverNext);
    },
    listeners,
  };
}

export function defineEvent<Payload>(definition: { readonly id: string; readonly isPresented: boolean }): EventHandle<Payload> {
  const channels = new WeakMap<EventQueue, EventChannel<Payload>>();

  return {
    channel: (queue) => {
      const existing = channels.get(queue);

      if (existing !== undefined) {
        return existing;
      }

      const created = createChannel<Payload>(queue);

      channels.set(queue, created);

      return created;
    },
    id: definition.id,
    isPresented: definition.isPresented,
  };
}

export function listen<Payload>(event: EventHandle<Payload>, handle: (tick: Tick, payload: Payload) => void): EventListener {
  return {
    attach: (queue) => {
      event.channel(queue).listeners.push(handle);
    },
  };
}

const FIRE_WHIRL = defineEvent<{ readonly cell: number; readonly strength: number }>({ id: "fireWhirl", isPresented: true });

const listeners: readonly EventListener[] = [
  listen(FIRE_WHIRL, (tick, payload) => {
    payload.strength.toFixed(tick.step);
  }),
];

const SPAWN_BOAT = declareCommand("spawnBoat", z.object({ x: z.int(), z: z.int() }));

const handlers: readonly CommandHandler[] = [
  handleCommand(SPAWN_BOAT, (payload) => {
    return payload.x > 0 ? null : { message: "boat.off-map" };
  }),
];

const sections: readonly SaveSection[] = [
  defineSaveSection({
    isEssential: false,
    key: "boat",
    read: (saved) => {
      saved.count.toFixed();
    },
    requires: [],
    reset: () => {
      return;
    },
    schema: z.object({ count: z.number() }),
    write: () => {
      return { count: 1 };
    },
  }),
];

export type ToWorker<Command> =
  | { readonly commands: readonly Command[]; readonly kind: "advance"; readonly realMilliseconds: number }
  | { readonly kind: "dispose" };

export interface Frame<Sections> {
  readonly sections: Partial<Sections>;
  readonly step: number;
  readonly tick: number;
}

void handlers;
void listeners;
void sections;
