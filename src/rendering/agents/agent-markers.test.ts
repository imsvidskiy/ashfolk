import {
  type BufferAttribute,
  Frustum,
  type InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Vector3,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import { CameraAxes } from "../effects/billboards.ts";
import { AgentMarkers, NO_HERD } from "./agent-markers.ts";
import { ANIMAL_MARKERS, MarkerShape, personMarker } from "./marker-look.ts";
import { MARKER_STYLE_ATTRIBUTE } from "./marker-material.ts";
import type { SightGround } from "./terrain-sight.ts";

const VIEWPORT_HEIGHT = 900;
const HANDOVER = 420;
const HERD = 7;
const CROWD = 150;
const BEAR_CLAN = personMarker(0xc8_55_3d);
const FLAT_GROUND: SightGround = {
  grid: { halfSize: 5000 },
  heightAt: () => {
    return 0;
  },
};

interface View {
  readonly camera: PerspectiveCamera;
  readonly frustum: Frustum;
}

function viewFrom(height: number): View {
  const camera = new PerspectiveCamera(45, 1.6, 0.5, 40_000);

  camera.position.set(0, height, height * 0.6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );

  return { camera, frustum };
}

function markersSeenFrom(height: number, ground: SightGround = FLAT_GROUND): AgentMarkers {
  const { camera, frustum } = viewFrom(height);
  const markers = new AgentMarkers(new CameraAxes(), ground);

  markers.begin(camera, frustum, VIEWPORT_HEIGHT);

  return markers;
}

function addDeerHerd(markers: AgentMarkers, spread: number, selectedIndex = -1): void {
  for (let index = 0; index < 5; index += 1) {
    const anchor = new Vector3(Math.cos(index) * spread, 1, Math.sin(index) * spread);

    markers.add(anchor, ANIMAL_MARKERS.deer, HANDOVER, index === selectedIndex, HERD);
  }
}

function drawnAttribute(markers: AgentMarkers, attribute: string): BufferAttribute | InterleavedBufferAttribute {
  const [mesh] = markers.group.children;

  if (!(mesh instanceof Mesh)) {
    throw new TypeError("Expected the markers to be drawn by meshes");
  }

  return mesh.geometry.getAttribute(attribute);
}

function drawnStyles(markers: AgentMarkers): { readonly isSelected: boolean; readonly shape: number }[] {
  const styles = drawnAttribute(markers, MARKER_STYLE_ATTRIBUTE);

  return Array.from({ length: markers.count }, (_, index) => {
    return {
      isSelected: styles.getZ(index) > 0.5,
      shape: styles.getX(index),
    };
  });
}

function drawnSpots(markers: AgentMarkers): { readonly x: number; readonly z: number }[] {
  const placements = drawnAttribute(markers, "billboardPlacement");

  return Array.from({ length: markers.count }, (_, index) => {
    return { x: placements.getX(index), z: placements.getZ(index) };
  });
}

describe("agent markers", () => {
  it("marks far agents and leaves near ones to their figures", () => {
    const far = markersSeenFrom(2000);
    const near = markersSeenFrom(40);

    for (const markers of [far, near]) {
      markers.add(new Vector3(0, 1, 0), BEAR_CLAN, HANDOVER, false);
      markers.add(new Vector3(8, 1, 0), ANIMAL_MARKERS.wolf, HANDOVER, false);
      markers.commit();
    }

    expect(far.count).toBe(2);
    expect(far.group.visible).toBe(true);
    expect(near.count).toBe(0);
    expect(near.group.visible).toBe(false);
  });

  it("starts over every frame", () => {
    const markers = markersSeenFrom(2000);

    markers.add(new Vector3(0, 1, 0), BEAR_CLAN, HANDOVER, false);
    markers.commit();

    const drawnBefore = markers.count;

    markers.begin(new PerspectiveCamera(), new Frustum(), VIEWPORT_HEIGHT);
    markers.commit();

    expect(drawnBefore).toBe(1);
    expect(markers.count).toBe(0);
  });

  it("leaves out agents off screen", () => {
    const markers = markersSeenFrom(2000);

    markers.add(new Vector3(40_000, 1, 0), BEAR_CLAN, HANDOVER, false);
    markers.commit();

    expect(markers.count).toBe(0);
  });

  it("shows agents in the open but hides them behind a ridge", () => {
    const ridge: SightGround = {
      grid: { halfSize: 5000 },
      heightAt: (_x, z) => {
        return Math.abs(z - 200) < 40 ? 600 : 0;
      },
    };

    const open = markersSeenFrom(600);
    const hidden = markersSeenFrom(600, ridge);

    for (const markers of [open, hidden]) {
      markers.add(new Vector3(0, 1, 0), BEAR_CLAN, HANDOVER, false);
      markers.commit();
    }

    expect(open.count).toBe(1);
    expect(hidden.count).toBe(0);
  });

  it("gathers a far herd into one marker but keeps the selected animal apart", () => {
    const herd = markersSeenFrom(2500);
    const withSelection = markersSeenFrom(2500);

    addDeerHerd(herd, 6);
    addDeerHerd(withSelection, 6, 2);
    herd.commit();
    withSelection.commit();

    expect(herd.count).toBe(1);
    expect(withSelection.count).toBe(2);
  });

  it("spreads a near herd out into its animals", () => {
    const markers = markersSeenFrom(380);

    addDeerHerd(markers, 40);
    markers.commit();

    expect(markers.count).toBe(5);
  });

  it("draws people above animals and the selected agent above all", () => {
    const markers = markersSeenFrom(2000);

    markers.add(new Vector3(0, 1, 0), ANIMAL_MARKERS.deer, HANDOVER, true, NO_HERD);
    markers.add(new Vector3(30, 1, 0), BEAR_CLAN, HANDOVER, false);
    markers.add(new Vector3(-30, 1, 0), ANIMAL_MARKERS.ibex, HANDOVER, false, NO_HERD);
    markers.commit();

    expect(drawnStyles(markers)).toEqual([
      { isSelected: false, shape: MarkerShape.Diamond },
      { isSelected: false, shape: MarkerShape.Circle },
      { isSelected: true, shape: MarkerShape.Diamond },
    ]);
  });

  it("keeps every marker of a crowd in order, frame after frame", () => {
    const { camera, frustum } = viewFrom(2000);
    const markers = new AgentMarkers(new CameraAxes(), FLAT_GROUND);
    const crowd = Array.from({ length: CROWD }, (_, index) => {
      return new Vector3((index % 20) * 15 - 150, 1, Math.floor(index / 20) * 15 - 75);
    });

    for (let frame = 0; frame < 2; frame += 1) {
      markers.begin(camera, frustum, VIEWPORT_HEIGHT);

      for (const anchor of crowd) {
        markers.add(anchor, BEAR_CLAN, HANDOVER, false);
      }

      markers.commit();
    }

    expect(markers.count).toBe(CROWD);
    expect(drawnSpots(markers)).toEqual(
      crowd.map(({ x, z }) => {
        return { x, z };
      })
    );
  });
});
