import { describe, expect, it } from "vitest";
import { NO_CELL } from "./drainage.ts";
import { chainFlows } from "./river-chains.ts";

describe("river flow", () => {
  const CELLS = 64;
  const LAKE_CELL = 40;
  const CAPTURED_FLOW = 50;
  const FEEDER_CATCHMENT = 100;

  type Pairs = readonly (readonly [number, number])[];

  const STREAM_LINKS: Pairs = [
    [20, 21],
    [21, 22],
    [30, 31],
    [31, 32],
    [32, 33],
    [10, 11],
    [11, 12],
  ];

  const STREAM_ACCUMULATIONS: Pairs = [
    [20, FEEDER_CATCHMENT],
    [21, FEEDER_CATCHMENT],
    [22, FEEDER_CATCHMENT],
    [30, CAPTURED_FLOW],
    [31, CAPTURED_FLOW],
    [32, CAPTURED_FLOW],
  ];

  function flowNetwork(links: Pairs, accumulations: Pairs) {
    const receivers = new Int32Array(CELLS).fill(NO_CELL);
    const accumulation = new Float32Array(CELLS);

    for (const [cell, receiver] of [...STREAM_LINKS, ...links]) {
      receivers[cell] = receiver;
    }

    for (const [cell, value] of [...STREAM_ACCUMULATIONS, ...accumulations]) {
      accumulation[cell] = value;
    }

    return { accumulation, filled: new Float32Array(CELLS), order: new Int32Array(CELLS), receivers };
  }

  function capturedFeeder(joinsCell: number, mouthReceiver: number) {
    return [
      { cells: [10, 11, 12], joinsCell: NO_CELL, mouthReceiver: NO_CELL },
      { cells: [20, 21, 22], joinsCell, mouthReceiver },
      { cells: [30, 31, 32], joinsCell: 21, mouthReceiver: 21 },
    ];
  }

  it("carries the water of a captured stream on past a natural confluence", () => {
    const network = flowNetwork(
      [[22, 11]],
      [
        [10, 20],
        [11, 125],
        [12, 130],
      ]
    );

    const [trunk, feeder] = chainFlows(network, capturedFeeder(11, 11));
    const feederFlow = FEEDER_CATCHMENT + CAPTURED_FLOW;

    expect(feeder[2]).toBe(feederFlow);
    expect(trunk[1]).toBeGreaterThanOrEqual(feederFlow);
    expect(trunk[2]).toBeGreaterThanOrEqual(feederFlow);
  });

  it("carries the water of a captured stream on through a lake into its outflow", () => {
    const network = flowNetwork(
      [
        [22, LAKE_CELL],
        [LAKE_CELL, 10],
      ],
      [
        [LAKE_CELL, 105],
        [10, 105],
        [11, 125],
        [12, 130],
      ]
    );

    const [trunk, feeder] = chainFlows(network, capturedFeeder(NO_CELL, LAKE_CELL));
    const feederFlow = FEEDER_CATCHMENT + CAPTURED_FLOW;

    expect(feeder[2]).toBe(feederFlow);
    expect(trunk[0]).toBeGreaterThanOrEqual(feederFlow);
    expect(trunk[2]).toBeGreaterThanOrEqual(feederFlow);
  });
});
