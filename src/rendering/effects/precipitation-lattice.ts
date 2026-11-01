import { clamp, float, floor, instanceIndex, uint, uniform, vec2 } from "three/tsl";
import { type Node, Vector2 } from "three/webgpu";
import { unitHash } from "../node-helpers.ts";

export const CYCLES = 256;

const IDENTITY_PERIOD = 65_536;
const IDENTITY_MASK = 0xff_ff;
const SALT_RANK = 0x5b_d1_e9_95;

export interface LatticeArea {
  readonly centerX: number;
  readonly centerZ: number;
  readonly radius: number;
}

interface LatticeElement {
  readonly presence: Node<"float">;
  readonly seed: Node<"uint">;
  readonly tile: Node<"vec2">;
}

type CycleSalts = Readonly<Record<"across" | "along" | "cycle" | "phase", number>>;

function scramble(seed: Node<"uint">): Node<"uint"> {
  const state = seed.mul(747_796_405).add(2_891_336_453);
  const word = state.shiftRight(state.shiftRight(28).add(4)).bitXor(state).mul(277_803_737);

  return word.shiftRight(22).bitXor(word);
}

function wrapIdentity(value: number): number {
  return ((value % IDENTITY_PERIOD) + IDENTITY_PERIOD) % IDENTITY_PERIOD;
}

export function latticeElement(cover: LatticeCover, salt: Node<"uint">): LatticeElement {
  const index = float(instanceIndex);
  const tileIndex = floor(index.add(0.5).div(cover.slots));
  const slot = index.sub(tileIndex.mul(cover.slots));
  const row = floor(tileIndex.add(0.5).div(cover.columns));
  const cell = vec2(tileIndex.sub(row.mul(cover.columns)), row);

  const identityColumn = uint(cover.identity.x.add(cell.x)).bitAnd(IDENTITY_MASK);
  const identityRow = uint(cover.identity.y.add(cell.y)).bitAnd(IDENTITY_MASK);

  const tileSeed = scramble(identityColumn.shiftLeft(16).bitOr(identityRow).bitXor(salt));
  const rank = slot.add(unitHash(tileSeed, SALT_RANK));

  return {
    presence: clamp(cover.shown.sub(rank), 0, 1),
    seed: scramble(tileSeed.add(uint(slot))),
    tile: cover.origin.add(cell),
  };
}

export function cycleOf(element: LatticeElement, clock: Node<"float">, salts: CycleSalts) {
  const phase = unitHash(element.seed, salts.phase);
  const progress = clock.add(phase);
  const cycle = floor(progress);

  const wrapped = uint(cycle).bitAnd(CYCLES - 1);
  const cycleSeed = scramble(element.seed.add(wrapped.mul(salts.cycle)));

  return {
    age: progress.sub(cycle),
    phase,
    spread: vec2(unitHash(cycleSeed, salts.across), unitHash(cycleSeed, salts.along)),
  };
}

export class LatticeCover {
  readonly columns = uniform(1);
  readonly identity = uniform(new Vector2());
  readonly origin = uniform(new Vector2());
  readonly shown = uniform(0);
  readonly slots = uniform(1);
  readonly #halfSize: number;
  count = 0;

  constructor(halfSize: number) {
    this.#halfSize = halfSize;
  }

  cover(area: LatticeArea, tileSize: number, shown: number, drift: Vector2): void {
    const halfSize = this.#halfSize;
    const west = Math.max(area.centerX - area.radius, -halfSize);
    const east = Math.min(area.centerX + area.radius, halfSize);
    const north = Math.max(area.centerZ - area.radius, -halfSize);
    const south = Math.min(area.centerZ + area.radius, halfSize);

    if (shown <= 0 || west >= east || north >= south) {
      this.count = 0;

      return;
    }

    const driftColumns = Math.floor(drift.x);
    const driftRows = Math.floor(drift.y);
    const firstColumn = Math.floor(west / tileSize - (drift.x - driftColumns));
    const firstRow = Math.floor(north / tileSize - (drift.y - driftRows));
    const columns = Math.floor(east / tileSize - (drift.x - driftColumns)) - firstColumn + 1;
    const rows = Math.floor(south / tileSize - (drift.y - driftRows)) - firstRow + 1;
    const slots = Math.ceil(shown);

    this.columns.value = columns;
    this.origin.value.set(firstColumn, firstRow);
    this.identity.value.set(wrapIdentity(firstColumn - driftColumns), wrapIdentity(firstRow - driftRows));
    this.shown.value = shown;
    this.slots.value = slots;
    this.count = columns * rows * slots;
  }
}
