import { describe, expect, it } from "vitest";
import { MaterialSlot } from "../materials.ts";
import { type MeshData, vertexCount } from "../mesh/mesh-data.ts";
import { verticesWhere } from "../testing/mesh-checks.ts";
import { loosePieces } from "../testing/mesh-connectivity.ts";
import { meshTree, type PlantDetailLevel, plantSway, type TreeLook } from "./tree-mesher.ts";
import type { TreeStructure } from "./tree-structure.ts";

const LEVELS: readonly PlantDetailLevel[] = ["high", "medium", "low", "far"];
const LOOK: TreeLook = { bark: MaterialSlot.Bark, foliage: MaterialSlot.Leaf, hasBarkMarks: false };

const TREE: TreeStructure = {
  branches: [
    {
      depth: 0,
      points: [
        { radius: 0.4, x: 0, y: 0, z: 0 },
        { radius: 0.3, x: 0, y: 4, z: 0 },
        { radius: 0.2, x: 0, y: 7, z: 0 },
      ],
    },
    {
      depth: 1,
      points: [
        { radius: 0.15, x: 0, y: 5.5, z: 0 },
        { radius: 0.05, x: 3, y: 7.5, z: 0 },
      ],
    },
  ],
  foliage: [
    { center: [3, 7.5, 0], kind: "blob", radius: 2, squash: 0.8, tint: 0 },
    { center: [0, 8.5, 0], kind: "blob", radius: 2.2, squash: 0.8, tint: 0 },
  ],
  height: 10,
};

const SHRUB: TreeStructure = {
  branches: [
    {
      depth: 1,
      points: [
        { radius: 0.05, x: 0.05, y: 0, z: 0 },
        { radius: 0.02, x: 0.4, y: 1.1, z: 0 },
      ],
    },
    {
      depth: 1,
      points: [
        { radius: 0.05, x: -0.05, y: 0, z: 0 },
        { radius: 0.02, x: -0.4, y: 1.1, z: 0 },
      ],
    },
  ],
  foliage: [
    { center: [0.4, 1.1, 0], kind: "blob", radius: 0.6, squash: 0.85, tint: 0 },
    { center: [-0.4, 1.1, 0], kind: "blob", radius: 0.6, squash: 0.85, tint: 0 },
  ],
  height: 2.2,
};

const WEEPING_CROWN = { center: [3, 7.5, 0], drape: 2.5, kind: "blob", radius: 2, squash: 0.8, tint: 0 } as const;
const WEEPING: TreeStructure = { ...TREE, foliage: [WEEPING_CROWN] };

const FORKED: TreeStructure = {
  ...TREE,
  branches: TREE.branches.map((branch) => {
    return branch.depth === 0 ? { ...branch, isForked: true } : branch;
  }),
};

const FROND_TREE: TreeStructure = {
  ...TREE,
  foliage: [
    { center: [0, 7.2, 0], kind: "blob", radius: 0.6, squash: 0.8, tint: 0 },
    {
      kind: "frond",
      points: [
        { radius: 0.1, x: 0, y: 7.1, z: 0 },
        { radius: 0.5, x: 1.5, y: 7.6, z: 0 },
        { radius: 0.4, x: 3, y: 7.2, z: 0 },
        { radius: 0, x: 4, y: 6.2, z: 0 },
      ],
      tint: 0,
    },
  ],
};

const BARE: TreeStructure = { ...TREE, foliage: [] };

function heightOf(mesh: MeshData, vertex: number): number {
  return mesh.positions[vertex * 3 + 1];
}

function foliageOf(mesh: MeshData): number[] {
  return verticesWhere(mesh, (vertex) => {
    return mesh.channels.slot[vertex] === MaterialSlot.Leaf;
  });
}

describe("tree mesher", () => {
  it.each(LEVELS)("sways the trunk, the branches and the crown alike at every height at %s detail", (level) => {
    const mesh = meshTree(TREE, LOOK, level);

    for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
      const height = mesh.positions[vertex * 3 + 1];

      expect(mesh.channels.sway[vertex]).toBeCloseTo(plantSway(height, TREE.height), 5);
    }
  });

  it.each(LEVELS)("grows the crown of a plant without a trunk out of the ground at %s detail", (level) => {
    const mesh = meshTree(SHRUB, LOOK, level);

    expect(loosePieces(mesh)).toEqual([]);
  });

  it.each(LEVELS)("drapes a weeping crown in one piece at %s detail", (level) => {
    const mesh = meshTree(WEEPING, LOOK, level);
    const leaves = foliageOf(mesh);

    expect(loosePieces(mesh)).toEqual([]);
    expect(
      Math.min(
        ...leaves.map((vertex) => {
          return heightOf(mesh, vertex);
        })
      )
    ).toBeLessThan(WEEPING_CROWN.center[1] - WEEPING_CROWN.radius * WEEPING_CROWN.squash);
  });

  it.each(["high", "medium"] as const)(
    "sways the top of a weeping crown with the tree and swings its hem fully at %s detail",
    (level) => {
      const mesh = meshTree(WEEPING, LOOK, level);
      const leaves = foliageOf(mesh);

      const top = leaves.reduce((highest, vertex) => {
        return heightOf(mesh, vertex) > heightOf(mesh, highest) ? vertex : highest;
      });
      const hem = leaves.reduce((lowest, vertex) => {
        return heightOf(mesh, vertex) < heightOf(mesh, lowest) ? vertex : lowest;
      });

      expect(mesh.channels.sway[top]).toBeCloseTo(plantSway(heightOf(mesh, top), TREE.height), 5);
      expect(mesh.channels.sway[hem]).toBeCloseTo(1, 5);
    }
  );

  it.each(["high", "medium"] as const)("rounds off the top of a forking trunk at %s detail", (level) => {
    const mesh = meshTree({ ...FORKED, foliage: [] }, LOOK, level);

    const wood = verticesWhere(mesh, (vertex) => {
      return Math.hypot(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 2]) < 0.25;
    });

    expect(
      Math.max(
        ...wood.map((vertex) => {
          return heightOf(mesh, vertex);
        })
      )
    ).toBeGreaterThan(7.15);
  });

  it("carries the trunk on into the crown at low detail", () => {
    const mesh = meshTree(TREE, LOOK, "low");

    const wood = verticesWhere(mesh, (vertex) => {
      return mesh.channels.slot[vertex] === MaterialSlot.Bark;
    });

    expect(
      Math.max(
        ...wood.map((vertex) => {
          return heightOf(mesh, vertex);
        })
      )
    ).toBeGreaterThan(7.5);
    expect(loosePieces(mesh)).toEqual([]);
  });

  it.each(LEVELS)("grows fronds out of the crown on both faces at %s detail", (level) => {
    const mesh = meshTree(FROND_TREE, LOOK, level);

    expect(loosePieces(mesh)).toEqual([]);
  });

  it("shades a frond from above and below", () => {
    const mesh = meshTree(FROND_TREE, LOOK, "high");

    const leafNormals = verticesWhere(mesh, (vertex) => {
      return mesh.channels.slot[vertex] === MaterialSlot.Leaf && mesh.positions[vertex * 3] > 1;
    }).map((vertex) => {
      return mesh.normals[vertex * 3 + 1];
    });

    expect(Math.max(...leafNormals)).toBeGreaterThan(0.5);
    expect(Math.min(...leafNormals)).toBeLessThan(-0.5);
  });

  it.each(LEVELS)("keeps a leafless tree to its bare wood at %s detail", (level) => {
    const mesh = meshTree(BARE, LOOK, level);

    expect(mesh.channels.slot).not.toContain(MaterialSlot.Leaf);
    expect(vertexCount(mesh)).toBeGreaterThan(0);
  });
});
