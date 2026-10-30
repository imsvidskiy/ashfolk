import { Color, Group, type MeshStandardNodeMaterial, Sphere, Vector3 } from "three/webgpu";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import type { GroundPoint } from "../../game/camera/god-camera.ts";
import { type AnimalAppearance, animalAppearance } from "../../models/animals/animal-appearance.ts";
import {
  ANIMAL_BONE_COUNT,
  ANIMAL_SPECIES,
  animalBoneScales,
  buildAnimalParts,
  poseAnimal,
  visibleAnimalParts,
} from "../../models/animals/animal-models.ts";
import { leapPerStride, QUADRUPED_CLIPS } from "../../models/animals/quadruped-clips.ts";
import { MaterialSlot } from "../../models/materials.ts";
import { Pose } from "../../models/rig/pose.ts";
import { SkeletonPoser } from "../../models/rig/skeleton-poser.ts";
import { measureStride } from "../../models/rig/stride.ts";
import { smoothstep } from "../../shared/math.ts";
import { isTarget } from "../../simulation/hand/grab-target.ts";
import { ANIMAL_STRIDE, AnimalField, restPositionOf } from "../../world/agent-buffers.ts";
import { ANIMAL_POSES, type AnimalPose } from "../../world/agent-poses.ts";
import { HIDDEN_LEVEL } from "../view-input.ts";
import { AgentMotion } from "./agent-motion.ts";
import { AgentPalette, NO_ROW } from "./agent-palette.ts";
import {
  type AgentViewInput,
  ANIMAL_WADING_DEPTH,
  detailLevel,
  farthestFigure,
  forgetUnseen,
  holdFigure,
  type LevelDistances,
  liftOf,
  NO_SELECTION,
  selectedAgentId,
  slopeLean,
  standingHeight,
} from "./agent-view-input.ts";
import { ANIMAL_MARKERS } from "./marker-look.ts";
import type { PaletteLayout } from "./palette-layout.ts";
import { PartBatches } from "./part-batches.ts";
import { createSkinnedMaterial } from "./skinned-material.ts";

export const ANIMAL_BOUNDING_LIFT = 1.5;
export const ANIMAL_BOUNDING_RADIUS = 4.6;

const ANIMAL_LAYOUT: PaletteLayout = {
  boneCount: ANIMAL_BONE_COUNT,
  colorSlots: [MaterialSlot.Coat, MaterialSlot.CoatLight],
};

const LEVEL_DISTANCES: LevelDistances = { far: 650, high: 90, low: 160 };
const LEAN_REACH = 1.5;
const SHORTEST_STRIDE = 0.5;
const REFERENCE_SEED = 0.5;
const YOUTH_STEPS = 8;
const MARKER_LIFT = 1.2;

interface AnimalVisual {
  readonly ageKey: number;
  readonly appearance: AnimalAppearance;
  readonly colors: readonly Color[];
  readonly kind: AnimalKind;
  readonly motion: AgentMotion;
  readonly parts: readonly number[];
  readonly scales: Float32Array;
  readonly variation: number;
}

interface AnimalKindView {
  readonly batches: PartBatches;
  readonly poser: SkeletonPoser;
  readonly strides: ReadonlyMap<AnimalPose, number>;
}

function measureKindStrides(kind: AnimalKind): Map<AnimalPose, number> {
  const species = ANIMAL_SPECIES[kind];
  const strides = new Map<AnimalPose, number>();

  const scales = animalBoneScales(kind, animalAppearance({ kind, seed: REFERENCE_SEED, youth: 0 }));

  for (const clip of ANIMAL_POSES) {
    if (QUADRUPED_CLIPS[clip].timing.kind !== "stride") {
      continue;
    }

    const stride = measureStride({
      pose: new Pose(species.skeleton.bones.length),
      poser: new SkeletonPoser(species.skeleton),
      sample: (target, phase) => {
        poseAnimal(kind, target, clip, phase, { variation: 0.5 });
      },
      scales,
      skeleton: species.skeleton,
    });

    strides.set(clip, Math.max(SHORTEST_STRIDE, stride + leapPerStride(species.gait, clip)));
  }

  return strides;
}

function cyclesPerSecond(
  kindView: AnimalKindView,
  clip: AnimalPose,
  speed: number,
  appearance: AnimalAppearance
): number {
  const { timing } = QUADRUPED_CLIPS[clip];

  if (timing.kind !== "stride") {
    return 1 / timing.cycleSeconds;
  }

  const stride = kindView.strides.get(clip);

  if (stride === undefined) {
    return 0;
  }

  return speed / (stride * appearance.size * appearance.legScale);
}

function animateAnimal(input: AgentViewInput, visual: AnimalVisual, kindView: AnimalKindView, offset: number): void {
  const { animals } = input.mirror.frame;

  const clipCode = animals[offset + AnimalField.Pose];
  const speed = Math.hypot(animals[offset + AnimalField.VelocityX], animals[offset + AnimalField.VelocityZ]);

  visual.motion.advance({
    clip: clipCode,
    gameSeconds: input.gameSeconds,
    heading: animals[offset + AnimalField.Heading],
    isOnce: QUADRUPED_CLIPS[ANIMAL_POSES[clipCode]].timing.kind === "once",
    rate: cyclesPerSecond(kindView, ANIMAL_POSES[clipCode], speed, visual.appearance),
    realSeconds: input.realSeconds,
  });
}

export class AnimalView {
  readonly group = new Group();
  readonly #blendedPose = new Pose(ANIMAL_BONE_COUNT);
  readonly #bounds = new Sphere(new Vector3(), ANIMAL_BOUNDING_RADIUS);
  readonly #kinds: Readonly<Record<AnimalKind, AnimalKindView>>;
  readonly #markerAnchor = new Vector3();
  readonly #palette = new AgentPalette(ANIMAL_LAYOUT);
  readonly #pose = new Pose(ANIMAL_BONE_COUNT);
  readonly #previousPose = new Pose(ANIMAL_BONE_COUNT);
  readonly #seen = new Set<number>();
  readonly #visuals = new Map<number, AnimalVisual>();
  #hoveredSpot: GroundPoint | null = null;
  #selectedId = NO_SELECTION;

  constructor() {
    const material = createSkinnedMaterial(this.#palette, ANIMAL_LAYOUT);

    this.#kinds = {
      deer: this.#createKindView("deer", material),
      hare: this.#createKindView("hare", material),
      ibex: this.#createKindView("ibex", material),
      mammoth: this.#createKindView("mammoth", material),
      wolf: this.#createKindView("wolf", material),
    };
  }

  get hoveredSpot(): GroundPoint | null {
    return this.#hoveredSpot;
  }

  update(input: AgentViewInput): void {
    const { frame } = input.mirror;

    this.#seen.clear();
    this.#palette.highlightRow.value = NO_ROW;
    this.#hoveredSpot = null;
    this.#selectedId = selectedAgentId(frame.inspection, "animal");

    for (const kind of ANIMAL_KINDS) {
      this.#kinds[kind].batches.begin();
    }

    let rows = 0;

    for (let animal = 0; animal < frame.animalCount; animal += 1) {
      const offset = animal * ANIMAL_STRIDE;

      this.#seen.add(frame.animals[offset + AnimalField.Id]);

      if (this.#drawAnimal(input, offset, rows)) {
        rows += 1;
      }
    }

    forgetUnseen(this.#visuals, this.#seen);

    for (const kind of ANIMAL_KINDS) {
      this.#kinds[kind].batches.commit();
    }

    this.#palette.finish(rows);
  }

  dispose(): void {
    for (const kind of ANIMAL_KINDS) {
      this.#kinds[kind].batches.dispose();
    }

    this.#palette.dispose();
  }

  #createKindView(kind: AnimalKind, material: MeshStandardNodeMaterial): AnimalKindView {
    const farParts = buildAnimalParts(kind, "far");

    const batches = new PartBatches(
      [
        { parts: buildAnimalParts(kind, "high"), shadowParts: farParts },
        { parts: buildAnimalParts(kind, "low"), shadowParts: null },
        { parts: farParts, shadowParts: null },
      ],
      material
    );

    this.group.add(batches.group);

    return { batches, poser: new SkeletonPoser(ANIMAL_SPECIES[kind].skeleton), strides: measureKindStrides(kind) };
  }

  #drawAnimal(input: AgentViewInput, offset: number, row: number): boolean {
    const { animals } = input.mirror.frame;

    const id = animals[offset + AnimalField.Id];
    const rest = restPositionOf(animals, offset, AnimalField, input.secondsSinceTick);
    const pose = input.hand.poseOf("animal", id, rest.x, rest.z);

    const x = pose === null ? rest.x : pose.x;
    const z = pose === null ? rest.z : pose.z;
    const y = standingHeight(input.mirror, x, z, ANIMAL_WADING_DEPTH) + liftOf(pose);
    const isHighlighted = isTarget(input.highlighted, "animal", id);

    if (isHighlighted) {
      this.#hoveredSpot = { x, z };
    }

    this.#bounds.center.set(x, y + ANIMAL_BOUNDING_LIFT, z);

    const distance = input.camera.position.distanceTo(this.#bounds.center);
    const level = detailLevel(distance, LEVEL_DISTANCES, input.detail);

    this.#mark(input, offset, this.#markerAnchor.set(x, y + MARKER_LIFT, z));

    if (level === HIDDEN_LEVEL || !input.frustum.intersectsSphere(this.#bounds)) {
      return false;
    }

    const visual = this.#visualFor(animals, offset);
    const kindView = this.#kinds[visual.kind];

    animateAnimal(input, visual, kindView, offset);
    this.#palette.ensureRows(row + 1);
    this.#writePose(visual, kindView, row);
    this.#palette.lean(row, slopeLean(input.mirror, x, z, visual.motion.heading, LEAN_REACH));
    holdFigure(this.#palette, row, visual.motion.heading, pose, isHighlighted);
    this.#palette.writeRoot(row, x, y, z, visual.motion.heading);

    for (const [index, color] of visual.colors.entries()) {
      this.#palette.writeColor(row, index, color);
    }

    for (const part of visual.parts) {
      kindView.batches.add(level, part, row);
    }

    return true;
  }

  #mark(input: AgentViewInput, offset: number, anchor: Vector3): void {
    const { animals } = input.mirror.frame;

    if (ANIMAL_POSES[animals[offset + AnimalField.Pose]] === "dead") {
      return;
    }

    const style = ANIMAL_MARKERS[ANIMAL_KINDS[animals[offset + AnimalField.Kind]]];
    const isSelected = animals[offset + AnimalField.Id] === this.#selectedId;
    const handover = farthestFigure(LEVEL_DISTANCES, input.detail);

    input.markers.add(anchor, style, handover, isSelected, animals[offset + AnimalField.HerdId]);
  }

  #writePose(visual: AnimalVisual, kindView: AnimalKindView, row: number): void {
    const { motion } = visual;

    const context = { variation: visual.variation };

    poseAnimal(visual.kind, this.#pose, ANIMAL_POSES[motion.clip], motion.phase, context);

    const pose = this.#blendIfNeeded(visual, context);

    kindView.poser.pose(pose, visual.scales);
    kindView.poser.writePalette(this.#palette.data, this.#palette.rowOffset(row));
  }

  #blendIfNeeded(visual: AnimalVisual, context: { readonly variation: number }): Pose {
    const { motion } = visual;

    if (motion.blend >= 1) {
      return this.#pose;
    }

    const eased = smoothstep(0, 1, motion.blend);

    poseAnimal(visual.kind, this.#previousPose, ANIMAL_POSES[motion.previousClip], motion.previousPhase, context);
    this.#blendedPose.blendBetween(this.#previousPose, this.#pose, eased);

    return this.#blendedPose;
  }

  #visualFor(animals: Float32Array, offset: number): AnimalVisual {
    const id = animals[offset + AnimalField.Id];
    const youth = animals[offset + AnimalField.Youth];

    const ageKey = Math.round(youth * YOUTH_STEPS);
    const existing = this.#visuals.get(id);

    if (existing !== undefined && existing.ageKey === ageKey) {
      return existing;
    }

    const kind = ANIMAL_KINDS[animals[offset + AnimalField.Kind]];
    const seed = animals[offset + AnimalField.AppearanceSeed];
    const appearance = animalAppearance({ kind, seed, youth });

    const visual: AnimalVisual = {
      ageKey,
      appearance,
      colors: [new Color(appearance.coat), new Color(appearance.coatLight)],
      kind,
      motion:
        existing === undefined
          ? new AgentMotion(
              animals[offset + AnimalField.Pose],
              animals[offset + AnimalField.Phase],
              animals[offset + AnimalField.Heading]
            )
          : existing.motion,
      parts: visibleAnimalParts(kind, appearance),
      scales: animalBoneScales(kind, appearance),
      variation: seed,
    };

    this.#visuals.set(id, visual);

    return visual;
  }
}
