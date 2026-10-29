import { Ray, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { PlantSpecies } from "../../content/plants.ts";
import { plantHitDistance, plantVolume, type StandingPlant } from "./plant-volumes.ts";

const OAK = { baseY: 0, height: 12, species: PlantSpecies.Oak, x: 0, z: 0 };

function sideways(y: number): Ray {
  return new Ray(new Vector3(-50, y, 0), new Vector3(1, 0, 0));
}

function hitSideways(plant: StandingPlant, y: number): number {
  const distance = plantHitDistance(sideways(y), plant, 0);

  if (distance === null) {
    throw new Error("The ray should meet the plant");
  }

  return distance;
}

describe("plant volumes", () => {
  it("sizes a broadleaf crown above its trunk and a conifer as a cone", () => {
    const oak = plantVolume(PlantSpecies.Oak);
    const spruce = plantVolume(PlantSpecies.Spruce);

    expect(oak.isCone).toBe(false);
    expect(oak.crownBottom).toBeGreaterThan(0.05);
    expect(oak.crownTop).toBeGreaterThan(oak.crownBottom);
    expect(oak.crownRadius).toBeGreaterThan(oak.trunkRadius);
    expect(spruce.isCone).toBe(true);
  });

  it("meets the crown first, then the trunk, and misses above the tree", () => {
    const crown = hitSideways(OAK, OAK.height * 0.6);
    const trunk = hitSideways(OAK, 0.5);

    expect(crown).toBeLessThan(trunk);
    expect(trunk).toBeGreaterThan(49);
    expect(plantHitDistance(sideways(OAK.height * 1.5), OAK, 0)).toBeNull();
  });

  it("narrows a conifer toward its tip", () => {
    const spruce = { ...OAK, height: 20, species: PlantSpecies.Spruce };

    expect(hitSideways(spruce, 4)).toBeLessThan(hitSideways(spruce, 17));
    expect(plantHitDistance(sideways(spruce.height * 1.25), spruce, 0)).toBeNull();
  });
});
