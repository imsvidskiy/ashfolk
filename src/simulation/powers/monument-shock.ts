import { ruinText, type Shock, shakeMonuments } from "../world/monument-damage.ts";
import type { PowerServices } from "./power-handler.ts";

export function ruinMonuments(services: PowerServices, shock: Shock): void {
  const { chronicle, environment, world } = services;

  for (const harm of shakeMonuments(world, shock, environment.day)) {
    chronicle.record({
      category: "warning",
      text: ruinText(shock.catastrophe, harm),
      tribeId: null,
      x: harm.monument.x,
      z: harm.monument.z,
    });
  }
}
