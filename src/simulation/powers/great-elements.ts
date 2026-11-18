import type { PowerParameters } from "../../content/powers.ts";
import { FULL_TURN } from "../../shared/math.ts";
import type { Waypoint } from "../agents/navigation.ts";
import { strikeLightning } from "./catastrophes.ts";
import { meteorPower } from "./element-powers.ts";
import { APPLIED, type PowerOutcome, type PowerServices, type PowerTarget, refused } from "./power-handler.ts";

const BOLT_INTERVAL = 0.42;

const METEOR_INTERVAL = 0.55;
const SHOWER_CRATER_RADIUS = 52;

const SWARM_FUNNEL_RADIUS = 36;

interface Cluster {
  count: number;
  radius: number;
}

function castCluster(
  services: PowerServices,
  target: PowerTarget,
  cluster: Cluster,
  interval: number,
  cast: (point: Waypoint) => void
): PowerOutcome {
  const { random, world } = services;

  if (!world.isOnIsland(world.grid.cellAt(target.x, target.z))) {
    return refused("Choose a spot on the island.");
  }

  const heading = random.next() * FULL_TURN;
  const count = Math.round(cluster.count);

  cast(target);

  for (let index = 1; index < count; index += 1) {
    const angle = heading + ((index + random.signed() * 0.22) / (count - 1)) * FULL_TURN;
    let distance = cluster.radius * random.between(0.5, 1);
    let point = { x: target.x + Math.cos(angle) * distance, z: target.z + Math.sin(angle) * distance };

    while (!world.isOnIsland(world.grid.cellAt(point.x, point.z)) && distance > world.grid.cellSize) {
      distance *= 0.5;
      point = { x: target.x + Math.cos(angle) * distance, z: target.z + Math.sin(angle) * distance };
    }

    const site = world.isOnIsland(world.grid.cellAt(point.x, point.z)) ? point : target;

    if (interval === 0) {
      cast(site);
    } else {
      services.schedule(index * interval, () => {
        cast(site);
      });
    }
  }

  return APPLIED;
}

export function lightningStormPower(
  target: PowerTarget,
  parameters: PowerParameters<"lightning-storm">,
  services: PowerServices
): PowerOutcome {
  return castCluster(services, target, parameters, BOLT_INTERVAL, (point) => {
    strikeLightning({ ...point, ignitionChance: 0.9, isNatural: false }, services);
  });
}

export function meteorShowerPower(
  target: PowerTarget,
  parameters: PowerParameters<"meteor-shower">,
  services: PowerServices
): PowerOutcome {
  return castCluster(services, target, parameters, METEOR_INTERVAL, (point) => {
    meteorPower(
      { ...target, ...point },
      { craterRadius: SHOWER_CRATER_RADIUS, fallTime: 1.3, ignites: true },
      services
    );
  });
}

export function tornadoSwarmPower(
  target: PowerTarget,
  parameters: PowerParameters<"tornado-swarm">,
  services: PowerServices
): PowerOutcome {
  return castCluster(services, target, parameters, 0, (point) => {
    services.tornadoes.touchDown(
      { ...point, lifetime: parameters.duration, radius: SWARM_FUNNEL_RADIUS, strength: 1 },
      services
    );
  });
}

export function nuclearPower(
  target: PowerTarget,
  parameters: PowerParameters<"nuclear">,
  services: PowerServices
): PowerOutcome {
  services.fallingBombs.drop(services, target.x, target.z, parameters.radius);

  return APPLIED;
}

export function blackHolePower(
  target: PowerTarget,
  parameters: PowerParameters<"black-hole">,
  services: PowerServices
): PowerOutcome {
  const { world } = services;

  if (!world.isOnIsland(world.grid.cellAt(target.x, target.z))) {
    return refused("Open a black hole over the island.");
  }

  services.blackHoles.open(
    {
      durationSeconds: parameters.duration,
      kind: "black-hole",
      radius: parameters.radius,
      surfaceY: world.surfaceAt(target.x, target.z),
      x: target.x,
      z: target.z,
    },
    services
  );

  return APPLIED;
}
