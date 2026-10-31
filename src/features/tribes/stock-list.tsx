import {
  RESOURCE_GROUPS,
  RESOURCE_KINDS,
  RESOURCES,
  type ResourceGroup,
  type ResourceKind,
  resourcesInGroup,
} from "../../content/resources.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import type { StockView } from "../../simulation/frame.ts";
import { RESOURCE_ICONS } from "./tribe-icons.ts";

const GROUP_NAMES: Readonly<Record<ResourceGroup, string>> = {
  arms: "Arms",
  food: "Food",
  material: "Materials",
  metal: "Metals",
  ore: "Ores",
};

interface StockedAmount {
  readonly amount: number;
  readonly kind: ResourceKind;
}

function stockedAmounts(stock: StockView, kinds: readonly ResourceKind[]): StockedAmount[] {
  return kinds
    .map((kind) => {
      return { amount: Math.round(stock[kind]), kind };
    })
    .filter(({ amount }) => {
      return amount > 0;
    });
}

function StockGroup({ group, stock }: { readonly group: ResourceGroup; readonly stock: StockView }) {
  const amounts = stockedAmounts(stock, resourcesInGroup(group));

  if (amounts.length === 0) {
    return null;
  }

  const total = amounts.reduce((sum, { amount }) => {
    return sum + amount;
  }, 0);

  return (
    <section aria-label={GROUP_NAMES[group]} className="flex flex-col gap-1">
      <h4 className="text-2xs text-ink-muted flex items-baseline justify-between tracking-wide uppercase">
        <span>{GROUP_NAMES[group]}</span>

        <span className="tabular-nums">{total}</span>
      </h4>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {amounts.map(({ amount, kind }) => {
          const icon = RESOURCE_ICONS[kind];

          return (
            <li className="text-ink-soft flex min-w-0 items-center gap-1.5 text-xs" key={kind}>
              <GameIcon name={icon} size={22} />

              <span className="truncate">{RESOURCES[kind].name}</span>

              <span className="text-ink ml-auto font-medium tabular-nums">{amount}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StockList({ stock }: { readonly stock: StockView }) {
  const hasAnything = stockedAmounts(stock, RESOURCE_KINDS).length > 0;

  if (!hasAnything) {
    return <p className="text-ink-muted text-xs">The stores are empty.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {RESOURCE_GROUPS.map((group) => {
        return <StockGroup group={group} key={group} stock={stock} />;
      })}
    </div>
  );
}
