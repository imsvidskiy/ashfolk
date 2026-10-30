import { Color, type Group, Sphere, Vector3 } from "three/webgpu";
import { TOOL_MATERIALS, type ToolMaterial, WEAPON_KINDS, type WeaponKind } from "../../content/weapons.ts";
import type { GroundPoint } from "../../game/camera/god-camera.ts";
import { MaterialSlot } from "../../models/materials.ts";
import { type PersonAppearance, personAppearance } from "../../models/people/appearance.ts";
import { applyHumanClip, HUMAN_CLIPS, type HumanClipContext } from "../../models/people/human-clips.ts";
import { HUMAN_DETAILS } from "../../models/people/human-detail.ts";
import { activityParts, appearanceParts, buildHumanParts, humanPartIndex } from "../../models/people/human-model.ts";
import { FIGURE_SCALE, humanBoneScales } from "../../models/people/human-proportions.ts";
import { HUMAN_BONE_COUNT, HUMAN_SKELETON } from "../../models/people/human-skeleton.ts";
import { Pose } from "../../models/rig/pose.ts";
import { SkeletonPoser } from "../../models/rig/skeleton-poser.ts";
import { smoothstep } from "../../shared/math.ts";
import { isTarget } from "../../simulation/hand/grab-target.ts";
import { PERSON_STRIDE, PersonField } from "../../world/agent-buffers.ts";
import { CARRIED_ITEMS, type CarriedItem, PERSON_POSES } from "../../world/agent-poses.ts";
import type { TribeLooks } from "../tribe-looks.ts";
import { HIDDEN_LEVEL } from "../view-input.ts";
import { AgentMotion } from "./agent-motion.ts";
import { AgentPalette, NO_ROW } from "./agent-palette.ts";
import {
  type AgentViewInput,
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
import { HumanStrides } from "./human-strides.ts";
import { type MarkerStyle, personMarker } from "./marker-look.ts";
import type { PaletteLayout } from "./palette-layout.ts";
import { PartBatches } from "./part-batches.ts";
import { createSkinnedMaterial } from "./skinned-material.ts";

const PERSON_LAYOUT: PaletteLayout = {
  boneCount: HUMAN_BONE_COUNT,
  colorSlots: [
    MaterialSlot.Skin,
    MaterialSlot.Hair,
    MaterialSlot.Fur,
    MaterialSlot.Hide,
    MaterialSlot.Accent,
    MaterialSlot.Metal,
  ],
};

const GEAR_COLORS: Readonly<Record<ToolMaterial, number>> = {
  bronze: 0xb0_8a_3e,
  copper: 0xc0_6c_3a,
  iron: 0x5a_60_6a,
  stone: 0x7a_76_70,
  wood: 0x7a_5d_3f,
};

const LEVEL_DISTANCES: LevelDistances = { far: 420 * FIGURE_SCALE, high: 70 * FIGURE_SCALE, low: 120 * FIGURE_SCALE };
const BOUNDING_LIFT = 0.9 * FIGURE_SCALE;
const BOUNDING_RADIUS = 1.4 * FIGURE_SCALE;
const WEAPON_CHOICES: readonly (WeaponKind | null)[] = [null, ...WEAPON_KINDS];
const GEAR_COLOR_INDEX = PERSON_LAYOUT.colorSlots.indexOf(MaterialSlot.Metal);
const WADING_DEPTH = 1.1;
const LEAN_REACH = 1;
const LEAN_SHARE = 0.3;
const MARKER_LIFT = 1;
const WAR_PAINT = humanPartIndex("warPaint");

interface PersonVisual {
  readonly appearance: PersonAppearance;
  readonly baseParts: readonly number[];
  readonly colors: readonly Color[];
  readonly era: number;
  readonly motion: AgentMotion;
  readonly scales: Float32Array;
  readonly tribeId: number;
  readonly years: number;
}

function activityTable(): readonly (readonly (readonly (readonly number[])[])[])[] {
  return PERSON_POSES.map((pose) => {
    return CARRIED_ITEMS.map((carried) => {
      return WEAPON_CHOICES.map((weapon) => {
        return activityParts(pose, carried, weapon).map((part) => {
          return humanPartIndex(part);
        });
      });
    });
  });
}

function gearColors(): readonly Color[] {
  return TOOL_MATERIALS.map((material) => {
    return new Color(GEAR_COLORS[material]);
  });
}

function colorsOf(appearance: PersonAppearance): Color[] {
  const { colors } = appearance;

  return [colors.skin, colors.hair, colors.fur, colors.hide, colors.accent].map((hex) => {
    return new Color(hex);
  });
}

export class PeopleView {
  readonly #activityParts = activityTable();
  readonly #batches: PartBatches;
  readonly #blendedPose = new Pose(HUMAN_BONE_COUNT);
  readonly #bounds = new Sphere(new Vector3(), BOUNDING_RADIUS);
  readonly #gearColors = gearColors();
  readonly #markerAnchor = new Vector3();
  readonly #markerStyles = new Map<number, MarkerStyle>();
  readonly #palette = new AgentPalette(PERSON_LAYOUT);
  readonly #pose = new Pose(HUMAN_BONE_COUNT);
  readonly #poser = new SkeletonPoser(HUMAN_SKELETON);
  readonly #previousPose = new Pose(HUMAN_BONE_COUNT);
  readonly #seen = new Set<number>();
  readonly #strides = new HumanStrides();
  readonly #tribes: TribeLooks;
  readonly #visuals = new Map<number, PersonVisual>();
  #figureCount = 0;
  #hoveredSpot: GroundPoint | null = null;
  #selectedId = NO_SELECTION;

  constructor(tribes: TribeLooks) {
    this.#tribes = tribes;

    const material = createSkinnedMaterial(this.#palette, PERSON_LAYOUT);
    const farParts = buildHumanParts(HUMAN_DETAILS.far);

    this.#batches = new PartBatches(
      [
        { parts: buildHumanParts(HUMAN_DETAILS.high), shadowParts: farParts },
        { parts: buildHumanParts(HUMAN_DETAILS.low), shadowParts: null },
        { parts: farParts, shadowParts: null },
      ],
      material
    );
  }

  get figureCount(): number {
    return this.#figureCount;
  }

  get group(): Group {
    return this.#batches.group;
  }

  get hoveredSpot(): GroundPoint | null {
    return this.#hoveredSpot;
  }

  update(input: AgentViewInput): void {
    const { frame } = input.mirror;

    this.#seen.clear();
    this.#palette.highlightRow.value = NO_ROW;
    this.#hoveredSpot = null;
    this.#selectedId = selectedAgentId(frame.inspection, "person");
    this.#batches.begin();

    let rows = 0;

    for (let person = 0; person < frame.personCount; person += 1) {
      const offset = person * PERSON_STRIDE;

      this.#seen.add(frame.people[offset + PersonField.Id]);

      if (this.#drawPerson(input, offset, rows)) {
        rows += 1;
      }
    }

    this.#figureCount = rows;
    forgetUnseen(this.#visuals, this.#seen);
    this.#batches.commit();
    this.#palette.finish(rows);
  }

  dispose(): void {
    this.#batches.dispose();
    this.#palette.dispose();
  }

  #drawPerson(input: AgentViewInput, offset: number, row: number): boolean {
    const { people } = input.mirror.frame;

    const id = people[offset + PersonField.Id];
    const restX = people[offset + PersonField.X] + people[offset + PersonField.VelocityX] * input.secondsSinceTick;
    const restZ = people[offset + PersonField.Z] + people[offset + PersonField.VelocityZ] * input.secondsSinceTick;
    const pose = input.hand.poseOf("person", id, restX, restZ);

    const x = pose === null ? restX : pose.x;
    const z = pose === null ? restZ : pose.z;
    const y = standingHeight(input.mirror, x, z, WADING_DEPTH) + liftOf(pose);
    const isHighlighted = isTarget(input.highlighted, "person", id);

    if (isHighlighted) {
      this.#hoveredSpot = { x, z };
    }

    this.#bounds.center.set(x, y + BOUNDING_LIFT, z);

    const distance = input.camera.position.distanceTo(this.#bounds.center);
    const level = detailLevel(distance, LEVEL_DISTANCES, input.detail);

    this.#mark(input, offset, this.#markerAnchor.set(x, y + MARKER_LIFT, z));

    if (level === HIDDEN_LEVEL || !input.frustum.intersectsSphere(this.#bounds)) {
      return false;
    }

    const visual = this.#visualFor(people, offset);
    const clipCode = people[offset + PersonField.Pose];
    const carriedCode = people[offset + PersonField.Carried];
    const weapon = people[offset + PersonField.Weapon];
    const gear = this.#gearColors[people[offset + PersonField.Gear]];

    this.#animate(input, visual, people, offset);
    this.#palette.ensureRows(row + 1);
    this.#writePose(visual, CARRIED_ITEMS[carriedCode], row);
    this.#palette.lean(row, slopeLean(input.mirror, x, z, visual.motion.heading, LEAN_REACH) * LEAN_SHARE);
    holdFigure(this.#palette, row, visual.motion.heading, pose, isHighlighted);
    this.#palette.writeRoot(row, x, y, z, visual.motion.heading);

    for (const [index, color] of visual.colors.entries()) {
      this.#palette.writeColor(row, index, color);
    }

    this.#palette.writeColor(row, GEAR_COLOR_INDEX, gear);

    for (const part of visual.baseParts) {
      this.#batches.add(level, part, row);
    }

    for (const part of this.#activityParts[clipCode][carriedCode][weapon]) {
      this.#batches.add(level, part, row);
    }

    this.#drawWarPaint(people, offset, level, row);

    return true;
  }

  #mark(input: AgentViewInput, offset: number, anchor: Vector3): void {
    const { people } = input.mirror.frame;

    if (PERSON_POSES[people[offset + PersonField.Pose]] === "dead") {
      return;
    }

    const style = this.#markerStyle(people[offset + PersonField.TribeId]);
    const isSelected = people[offset + PersonField.Id] === this.#selectedId;

    input.markers.add(anchor, style, farthestFigure(LEVEL_DISTANCES, input.detail), isSelected);
  }

  #drawWarPaint(people: Float32Array, offset: number, level: number, row: number): void {
    if (people[offset + PersonField.IsRaiding] < 0.5) {
      return;
    }

    this.#batches.add(level, WAR_PAINT, row);
  }

  #animate(input: AgentViewInput, visual: PersonVisual, people: Float32Array, offset: number): void {
    const clipCode = people[offset + PersonField.Pose];
    const speed = Math.hypot(people[offset + PersonField.VelocityX], people[offset + PersonField.VelocityZ]);

    visual.motion.advance({
      clip: clipCode,
      gameSeconds: input.gameSeconds,
      heading: people[offset + PersonField.Heading],
      isOnce: HUMAN_CLIPS[PERSON_POSES[clipCode]].timing.kind === "once",
      rate: this.#strides.cyclesPerSecond(PERSON_POSES[clipCode], speed, visual.appearance),
      realSeconds: input.realSeconds,
    });
  }

  #writePose(visual: PersonVisual, carried: CarriedItem, row: number): void {
    const { appearance, motion } = visual;

    const context = { ageGroup: appearance.ageGroup, carried, motion: appearance.motion };

    applyHumanClip(this.#pose, PERSON_POSES[motion.clip], motion.phase, context);

    const pose = this.#blendIfNeeded(motion, context);

    this.#poser.pose(pose, visual.scales);
    this.#poser.writePalette(this.#palette.data, this.#palette.rowOffset(row));
  }

  #blendIfNeeded(motion: AgentMotion, context: HumanClipContext): Pose {
    if (motion.blend >= 1) {
      return this.#pose;
    }

    const eased = smoothstep(0, 1, motion.blend);

    applyHumanClip(this.#previousPose, PERSON_POSES[motion.previousClip], motion.previousPhase, context);
    this.#blendedPose.blendBetween(this.#previousPose, this.#pose, eased);

    return this.#blendedPose;
  }

  #visualFor(people: Float32Array, offset: number): PersonVisual {
    const id = people[offset + PersonField.Id];
    const age = people[offset + PersonField.Age];
    const tribeId = people[offset + PersonField.TribeId];
    const era = people[offset + PersonField.Era];
    const years = Math.floor(age);

    const existing = this.#visuals.get(id);

    if (existing !== undefined && existing.years === years && existing.tribeId === tribeId && existing.era === era) {
      return existing;
    }

    const appearance = personAppearance({
      age,
      era,
      isFemale: people[offset + PersonField.IsFemale] > 0.5,
      seed: people[offset + PersonField.AppearanceSeed],
      tribe: this.#tribes.look(tribeId),
    });

    const visual: PersonVisual = {
      appearance,
      baseParts: appearanceParts(appearance).map((part) => {
        return humanPartIndex(part);
      }),
      colors: colorsOf(appearance),
      era,
      motion:
        existing === undefined
          ? new AgentMotion(
              people[offset + PersonField.Pose],
              people[offset + PersonField.Phase],
              people[offset + PersonField.Heading]
            )
          : existing.motion,
      scales: humanBoneScales(appearance.body),
      tribeId,
      years,
    };

    this.#visuals.set(id, visual);

    return visual;
  }

  #markerStyle(tribeId: number): MarkerStyle {
    const { accent } = this.#tribes.look(tribeId);

    const known = this.#markerStyles.get(accent);

    if (known !== undefined) {
      return known;
    }

    const style = personMarker(accent);

    this.#markerStyles.set(accent, style);

    return style;
  }
}
