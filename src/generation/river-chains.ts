import { riverWidthOfStrength } from "../world/water.ts";
import { type DrainageNetwork, NO_CELL } from "./drainage.ts";

export interface RiverChain {
  cells: number[];
  joinsCell: number;
  mouthReceiver: number;
}

interface ChainPosition {
  readonly chain: number;
  readonly index: number;
}

function buildUpstreamLists(isRiver: Uint8Array, receivers: Int32Array): Map<number, number[]> {
  const upstream = new Map<number, number[]>();

  for (let cell = 0; cell < isRiver.length; cell += 1) {
    const receiver = receivers[cell];

    if (isRiver[cell] === 0 || receiver === NO_CELL || isRiver[receiver] === 0) {
      continue;
    }

    const list = upstream.get(receiver);

    if (list !== undefined) {
      list.push(cell);

      continue;
    }

    upstream.set(receiver, [cell]);
  }

  return upstream;
}

function largestByAccumulation(accumulation: Float32Array, cells: readonly number[]): number {
  let best = NO_CELL;
  let bestAccumulation = -1;

  for (const cell of cells) {
    if (accumulation[cell] > bestAccumulation) {
      best = cell;
      bestAccumulation = accumulation[cell];
    }
  }

  return best;
}

export function traceRiverChains(network: DrainageNetwork, lakeIds: Int32Array, riverThreshold: number): RiverChain[] {
  const isRiver = new Uint8Array(lakeIds.length);

  for (let cell = 0; cell < isRiver.length; cell += 1) {
    if (network.accumulation[cell] >= riverThreshold && lakeIds[cell] === NO_CELL) {
      isRiver[cell] = 1;
    }
  }

  const upstream = buildUpstreamLists(isRiver, network.receivers);
  const pending: { joinsCell: number; mouth: number }[] = [];

  for (let cell = 0; cell < isRiver.length; cell += 1) {
    const receiver = network.receivers[cell];

    if (isRiver[cell] === 1 && (receiver === NO_CELL || isRiver[receiver] === 0)) {
      pending.push({ joinsCell: NO_CELL, mouth: cell });
    }
  }

  const chains: RiverChain[] = [];

  for (let start = pending.pop(); start !== undefined; start = pending.pop()) {
    const cells = [start.mouth];
    let current = start.mouth;

    for (let sources = upstream.get(current); sources !== undefined; sources = upstream.get(current)) {
      const main = largestByAccumulation(network.accumulation, sources);

      for (const tributary of sources) {
        if (tributary !== main) {
          pending.push({ joinsCell: current, mouth: tributary });
        }
      }

      cells.push(main);
      current = main;
    }

    cells.reverse();
    chains.push({ cells, joinsCell: start.joinsCell, mouthReceiver: network.receivers[start.mouth] });
  }

  return chains;
}

export function riverStrengthFor(flow: number, threshold: number): number {
  return Math.log2(Math.max(1, flow / threshold));
}

export function riverWidthFor(flow: number, threshold: number): number {
  return riverWidthOfStrength(riverStrengthFor(flow, threshold));
}

export function chainCells(chain: RiverChain): number[] {
  return chain.joinsCell === NO_CELL ? [...chain.cells] : [...chain.cells, chain.joinsCell];
}

function downstreamChainCell(
  network: DrainageNetwork,
  positions: ReadonlyMap<number, ChainPosition>,
  cell: number
): ChainPosition | undefined {
  for (let current = network.receivers[cell]; current !== NO_CELL; current = network.receivers[current]) {
    const position = positions.get(current);

    if (position !== undefined) {
      return position;
    }
  }

  return undefined;
}

export function chainFlows(network: DrainageNetwork, chains: readonly RiverChain[]): number[][] {
  const positions = new Map<number, ChainPosition>();

  for (const [chain, { cells }] of chains.entries()) {
    for (const [index, cell] of cells.entries()) {
      positions.set(cell, { chain, index });
    }
  }

  const inflows = chains.map((chain) => {
    return new Float64Array(chain.cells.length + 1);
  });
  const flows: number[][] = [];

  for (let chainIndex = chains.length - 1; chainIndex >= 0; chainIndex -= 1) {
    const chain = chains[chainIndex];

    let flow = 0;

    flows[chainIndex] = chainCells(chain).map((cell, index) => {
      flow = Math.max(flow, network.accumulation[cell]) + inflows[chainIndex][index];

      return flow;
    });

    const last = chain.cells.at(-1);

    if (last === undefined) {
      continue;
    }

    const lastFlow = flows[chainIndex][chain.cells.length - 1];
    const junction = positions.get(chain.joinsCell);

    if (junction !== undefined && network.receivers[last] !== chain.joinsCell) {
      inflows[junction.chain][junction.index] += lastFlow;
      continue;
    }

    const downstream = downstreamChainCell(network, positions, last);
    const addedFlow = lastFlow - network.accumulation[last];

    if (downstream !== undefined && downstream.chain < chainIndex && addedFlow > 0) {
      inflows[downstream.chain][downstream.index] += addedFlow;
    }
  }

  return flows;
}
