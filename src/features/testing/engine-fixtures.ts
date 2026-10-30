import { Matrix4 } from "three/webgpu";
import { type Mock, type MockInstance, vi } from "vitest";
import { useEngineStore } from "../../app/engine-store.ts";
import type { CameraState } from "../../game/camera/god-camera.ts";
import type { EngineHandle } from "../../game/engine-handle.ts";
import { Filming } from "../../game/filming.ts";
import type { GameSession } from "../../game/game-session.ts";
import type { LabelPlacement } from "../../game/label-projector.ts";
import type { Landmark } from "../../game/landmarks.ts";
import { createLocalSession } from "../../game/testing/local-session.ts";
import type { PowerSelection } from "../../game/tools/power-tool.ts";
import type { SimulationCommand } from "../../simulation/commands.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";

const TEST_CAMERA: CameraState = { distance: 300, pitch: 0.6, targetX: 0, targetZ: 0, yaw: 0.8 };

interface Renders {
  readonly renderFrame: () => void;
  readonly subscribeToRenders: (listener: () => void) => () => void;
}

interface TestEngine {
  readonly clearSelection: Mock<() => void>;
  readonly engine: EngineHandle;
  readonly focusOn: Mock<(x: number, z: number, distance?: number) => void>;
  readonly followSelection: Mock<() => void>;
  readonly placeLabel: Mock<(x: number, z: number, lift: number) => LabelPlacement | null>;
  readonly renderFrame: () => void;
  readonly send: MockInstance<(command: SimulationCommand) => void>;
  readonly setFollowing: (isFollowing: boolean) => void;
  readonly setLandmarks: (landmarks: readonly Landmark[]) => void;
  readonly stopFollowing: Mock<() => void>;
}

interface TestEngineOptions {
  readonly cameraDistance?: number;
  readonly landmarks?: readonly Landmark[];
}

function createRenders(): Renders {
  const listeners = new Set<() => void>();

  return {
    renderFrame: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    subscribeToRenders: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export async function createTestSession(): Promise<GameSession> {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 64 } }));
  const { session } = await createLocalSession(simulation);

  return session;
}

export async function startTestEngine(options: TestEngineOptions = {}): Promise<TestEngine> {
  const { cameraDistance = TEST_CAMERA.distance } = options;
  let { landmarks = [] } = options;

  const session = await createTestSession();
  const { renderFrame, subscribeToRenders } = createRenders();
  const camera = {
    camera: { matrixWorld: new Matrix4() },
    groundFootprint: () => {
      return [];
    },
    isFollowing: false,
    state: { ...TEST_CAMERA, distance: cameraDistance },
  };

  function setFollowing(isFollowing: boolean): void {
    camera.isFollowing = isFollowing;
  }

  function setLandmarks(changedLandmarks: readonly Landmark[]): void {
    landmarks = changedLandmarks;
  }

  const send = vi.spyOn(session, "send");
  const clearSelection = vi.fn<() => void>(() => {
    setFollowing(false);
  });
  const focusOn = vi.fn<(x: number, z: number, distance?: number) => void>(() => {
    setFollowing(false);
  });
  const followSelection = vi.fn<() => void>(() => {
    setFollowing(true);
  });
  const placeLabel = vi.fn<(x: number, z: number, lift: number) => LabelPlacement | null>(() => {
    return null;
  });
  const stopFollowing = vi.fn<() => void>(() => {
    setFollowing(false);
  });

  const engine: EngineHandle = {
    camera,
    canvas: document.createElement("canvas"),
    clearSelection,
    filming: new Filming(),
    focusOn,
    followSelection,
    get landmarks() {
      return landmarks;
    },
    placeLabel,
    selectHand: vi.fn<(isSelected: boolean) => void>(),
    selectPower: vi.fn<(selection: PowerSelection | null) => void>(),
    session,
    setOutlinesShown: vi.fn<(areShown: boolean) => void>(),
    stopFollowing,
    subscribeToRenders,
  };

  useEngineStore.setState({ status: { engine, kind: "ready" } });

  return {
    clearSelection,
    engine,
    focusOn,
    followSelection,
    placeLabel,
    renderFrame,
    send,
    setFollowing,
    setLandmarks,
    stopFollowing,
  };
}
