import { describe, expect, it } from "vitest";
import { cropCode, FENCED_CROP_OFFSET } from "../../content/crops.ts";
import { Ground } from "../../content/grounds.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { GROUND_CHANNELS, GroundChannel } from "../../world/agent-buffers.ts";
import { FieldPlan } from "../terrain/field-plan.ts";
import { cameraAbove } from "../testing/camera-above.ts";
import { drawnInstances, drawnMeshes } from "../testing/drawn-meshes.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { CropField } from "./crop-field.ts";
import { PlantWeather } from "./plant-material.ts";

const FIELD_ROW = 30;
const FIELD_COLUMNS = [30, 31];
const WHEAT = cropCode("wheat");
const FENCED_WHEAT = WHEAT + FENCED_CROP_OFFSET;
const SPROUTING = 60;
const GROWN = 200;

interface Farm {
  readonly field: CropField;
  readonly mirror: WorldMirror;
}

interface FirstCrop {
  readonly count: number;
  readonly growth: number;
  readonly x: number;
}

function setGround(mirror: WorldMirror, column: number, channel: number, value: number): void {
  mirror.ground[mirror.grid.index(column, FIELD_ROW) * GROUND_CHANNELS + channel] = value;
}

function createFarm(code: number): Farm {
  const mirror = createVegetatedMirror();

  for (const column of FIELD_COLUMNS) {
    setGround(mirror, column, GroundChannel.Ground, Ground.Farm);
    setGround(mirror, column, GroundChannel.CropKind, code);
    setGround(mirror, column, GroundChannel.Crop, SPROUTING);
  }

  return { field: new CropField(mirror, new PlantWeather(), new FieldPlan(mirror)), mirror };
}

function updateFromAbove({ field, mirror }: Farm): void {
  const { grid } = mirror;

  const { camera, frustum } = cameraAbove(mirror, grid.centerX(FIELD_COLUMNS[0]), grid.centerZ(FIELD_ROW), 30);

  field.update(camera, frustum, 1);
}

function drawnCount(farm: Farm, attribute: string): number {
  updateFromAbove(farm);

  return drawnInstances(farm.field.group, attribute);
}

function firstCrop(farm: Farm): FirstCrop {
  updateFromAbove(farm);

  const [mesh] = drawnMeshes(farm.field.group, "cropPlacement");

  if (mesh === undefined) {
    throw new Error("No crops are drawn");
  }

  const { geometry } = mesh;

  return {
    count: geometry.instanceCount,
    growth: geometry.getAttribute("cropLook").getX(0),
    x: geometry.getAttribute("cropPlacement").getX(0),
  };
}

function groundChanged({ field }: Farm): void {
  field.groundChanged([{ firstRow: FIELD_ROW, rowCount: 1 }]);
}

describe("crop field", () => {
  it("rows crops over every farm cell and fences the sides that face open ground", () => {
    const fenced = createFarm(FENCED_WHEAT);
    const open = createFarm(WHEAT);

    expect(drawnCount(fenced, "cropPlacement")).toBeGreaterThan(20);
    expect(drawnCount(fenced, "fenceStart")).toBe(6);
    expect(drawnCount(open, "cropPlacement")).toBe(drawnCount(fenced, "cropPlacement"));
    expect(drawnCount(open, "fenceStart")).toBe(0);
  });

  it("grows the crops where they stand", () => {
    const farm = createFarm(FENCED_WHEAT);

    const before = firstCrop(farm);

    for (const column of FIELD_COLUMNS) {
      setGround(farm.mirror, column, GroundChannel.Crop, GROWN);
    }

    groundChanged(farm);

    const after = firstCrop(farm);

    expect(before.growth).toBeCloseTo(SPROUTING / 255);
    expect(after).toEqual({ count: before.count, growth: expect.closeTo(GROWN / 255), x: before.x });
  });

  it("clears a field once its ground is no longer farmland", () => {
    const farm = createFarm(FENCED_WHEAT);

    expect(drawnCount(farm, "cropPlacement")).toBeGreaterThan(0);

    for (const column of FIELD_COLUMNS) {
      setGround(farm.mirror, column, GroundChannel.Ground, Ground.Meadow);
    }

    groundChanged(farm);

    expect(drawnCount(farm, "cropPlacement")).toBe(0);
    expect(drawnCount(farm, "fenceStart")).toBe(0);
  });
});
