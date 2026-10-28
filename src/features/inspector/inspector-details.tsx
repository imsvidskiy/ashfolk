import type { ReactNode } from "react";
import { LIT_CAMPFIRE_FUEL } from "../../content/buildings.ts";
import { TOOL_MATERIAL_DEFINITIONS } from "../../content/weapons.ts";
import { Badge } from "../../design/badge.tsx";
import { cn } from "../../design/cn.ts";
import { FactList } from "../../design/fact-list.tsx";
import { formatPercent } from "../../design/format.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import { MeterBar } from "../../design/meter-bar.tsx";
import type { EraView } from "../../simulation/frame.ts";
import type {
  AnimalInspection,
  BuildingInspection,
  CellInspection,
  PersonInspection,
  PlantDescription,
  TribeInspection,
} from "../../simulation/inspection.ts";
import { TribeRelations } from "../rivalry/tribe-relations.tsx";
import { BuildingList } from "../tribes/building-list.tsx";
import { GoalNeed } from "../tribes/goal-need.tsx";
import { StockList } from "../tribes/stock-list.tsx";

function landFacts(summary: TribeInspection["summary"]) {
  const { farmland } = summary;

  const crops = farmland.crops.map((crop) => `${crop.name} ${crop.count}`).join(" · ");
  const facts = [
    { label: "Fields", value: crops.length > 0 ? `${farmland.fields} (${crops})` : String(farmland.fields) },
    { label: "Orchard trees", value: farmland.orchardTrees },
    { label: "Woodlot trees", value: farmland.woodlotTrees },
  ];

  return facts.filter((fact) => fact.value !== 0 && fact.value !== "0");
}

export function PersonDetails({ person }: { readonly person: PersonInspection }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink text-sm">{person.activity}</p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <MeterBar label="Health" tone="ember" value={person.health} valueText={formatPercent(person.health)} />

        <MeterBar label="Fed" tone="gold" value={1 - person.hunger} valueText={formatPercent(1 - person.hunger)} />

        <MeterBar label="Warmth" tone="dawn" value={person.warmth} valueText={formatPercent(person.warmth)} />

        <MeterBar label="Energy" tone="meadow" value={person.energy} valueText={formatPercent(person.energy)} />
      </div>
    </div>
  );
}

export function AnimalDetails({ animal }: { readonly animal: AnimalInspection }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink text-sm">{animal.activity}</p>

      <MeterBar label="Health" tone="ember" value={animal.health} valueText={formatPercent(animal.health)} />
    </div>
  );
}

function BuildingState({ building }: { readonly building: BuildingInspection }) {
  if (building.isBurning) {
    return <Badge tone="ember">On fire</Badge>;
  }

  if (building.progress < 1) {
    return <Badge tone="muted">{`Being built · ${formatPercent(building.progress)}`}</Badge>;
  }

  return <Badge tone="meadow">Standing</Badge>;
}

function CampfireFuel({ building }: { readonly building: BuildingInspection }) {
  if (building.name !== "Campfire" || building.progress < 1) {
    return null;
  }

  const label = building.fuel > LIT_CAMPFIRE_FUEL ? "Firewood" : "Gone out";

  return <MeterBar label={label} tone="dawn" value={building.fuel} valueText={formatPercent(building.fuel)} />;
}

export function BuildingDetails({ building }: { readonly building: BuildingInspection }) {
  return (
    <div className="flex flex-col gap-3">
      <BuildingState building={building} />

      <MeterBar label="Condition" tone="meadow" value={building.health} valueText={formatPercent(building.health)} />

      <CampfireFuel building={building} />
    </div>
  );
}

function PlantChip({ plant }: { readonly plant: PlantDescription }) {
  return (
    <Badge tone={plant.isBurnt ? "ember" : "meadow"}>{plant.isBurnt ? `${plant.name} (burnt)` : plant.name}</Badge>
  );
}

function PlantList({ plants }: { readonly plants: readonly PlantDescription[] }) {
  if (plants.length === 0) {
    return <p className="text-ink-muted text-xs">Nothing grows here.</p>;
  }

  return (
    <ul aria-label="Plants" className="flex flex-wrap gap-1.5">
      {plants.map((plant, index) => (
        <li className="flex" key={`${plant.name}-${String(index)}`}>
          <PlantChip plant={plant} />
        </li>
      ))}
    </ul>
  );
}

function FireWarning({ cell }: { readonly cell: CellInspection }) {
  if (cell.fire <= 0.05) {
    return null;
  }

  return (
    <p className="text-ember flex items-center gap-1.5 text-sm font-medium">
      <GameIcon name="fire" size={22} />
      Burning
    </p>
  );
}

export function CellDetails({ cell }: { readonly cell: CellInspection }) {
  const facts = [
    { label: "Ground", value: cell.groundName },
    { label: "Height", value: `${Math.round(cell.height)} m` },
    { label: "Temperature", value: `${Math.round(cell.temperature)} °C` },
    { label: "Water depth", value: cell.waterDepth > 0.05 ? `${cell.waterDepth.toFixed(1)} m` : "Dry" },
    { label: "Snow", value: formatPercent(cell.snow) },
    { label: "Wetness", value: formatPercent(cell.wetness) },
    { label: "Scorched", value: formatPercent(cell.scorch) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <FireWarning cell={cell} />

      <FactList facts={facts} />

      <PlantList plants={cell.plants} />
    </div>
  );
}

function NextDiscovery({ tribe }: { readonly tribe: TribeInspection }) {
  const { goal } = tribe.summary;

  if (goal === null) {
    return <p className="text-ink-muted text-xs">Every discovery is made.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <MeterBar
        label={`Next: ${goal.technologyName}`}
        tone="lake"
        value={goal.progress}
        valueText={formatPercent(goal.progress)}
      />

      <GoalNeed goal={goal} />
    </div>
  );
}

function EraSteps({ era }: { readonly era: EraView }) {
  return (
    <div className="flex items-center gap-2">
      <ol aria-label={`Era ${era.index + 1} of ${era.count}`} className="flex flex-1 gap-1">
        {Array.from({ length: era.count }, (_, step) => (
          <li
            className={cn("h-1.5 flex-1 rounded-full", step <= era.index ? "bg-gold" : "bg-ink/10")}
            key={`era-${String(step)}`}
          />
        ))}
      </ol>

      <span className="text-ink-muted text-xs">{era.nextName === null ? "Last era" : `Next: ${era.nextName}`}</span>
    </div>
  );
}

function Section({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-ink-soft text-xs font-semibold">{title}</h3>

      {children}
    </section>
  );
}

export function TribeDetails({ tribe }: { readonly tribe: TribeInspection }) {
  const { summary } = tribe;

  const facts = [
    { label: "Era", value: summary.eraName },
    { label: "People", value: `${summary.population} (${summary.children} children)` },
    { label: "Births · deaths", value: `${summary.births} · ${summary.deaths}` },
    { label: "Tools", value: TOOL_MATERIAL_DEFINITIONS[summary.tools].name },
  ];
  const land = landFacts(summary);

  return (
    <div className="flex flex-col gap-3">
      <FactList facts={facts} />

      <EraSteps era={summary.era} />

      <NextDiscovery tribe={tribe} />

      <MeterBar
        label="Faith"
        tone="gold"
        value={Math.min(1, summary.faith / 100)}
        valueText={String(Math.round(summary.faith))}
      />

      <Section title="Stores">
        <StockList stock={summary.stock} />
      </Section>

      <Section title="Buildings">
        <BuildingList buildings={summary.buildings} />
      </Section>

      {land.length > 0 ? (
        <Section title="Land">
          <FactList facts={land} />
        </Section>
      ) : null}

      <TribeRelations tribeId={summary.id} />

      {summary.technologies.length > 0 ? (
        <ul aria-label="Discoveries" className="flex flex-wrap gap-1.5">
          {summary.technologies.map((name) => (
            <li className="flex" key={name}>
              <Badge tone="muted">{name}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
