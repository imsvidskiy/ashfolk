import { readWorldRules } from "../content/world-rules.ts";
import type { CommandOf, SimulationCommandType } from "./commands.ts";
import type { Simulation } from "./simulation.ts";

type CommandHandlers = {
  readonly [Type in SimulationCommandType]: (simulation: Simulation, command: CommandOf<Type>) => void;
};

const COMMAND_HANDLERS: CommandHandlers = {
  beginStroke: (simulation, command) => {
    simulation.beginStroke(command.powerId, command.x, command.z, command.parameters);
  },
  cancelGrab: (simulation) => {
    simulation.cancelGrab();
  },
  carry: (simulation, command) => {
    simulation.carry(command.x, command.z);
  },
  drop: (simulation) => {
    simulation.drop();
  },
  endStroke: (simulation) => {
    simulation.endStroke();
  },
  grab: (simulation, command) => {
    simulation.grab(command.target);
  },
  moveStroke: (simulation, command) => {
    simulation.moveStroke(command.x, command.z);
  },
  setDaySeconds: (simulation, command) => {
    simulation.calendar.daySeconds = command.seconds;
  },
  setDaysPerSeason: (simulation, command) => {
    simulation.calendar.setDaysPerSeason(command.days);
  },
  setHours: (simulation, command) => {
    simulation.calendar.setHours(command.hours);
  },
  setPaused: (simulation, command) => {
    simulation.setPaused(command.isPaused);
  },
  setSeason: (simulation, command) => {
    simulation.calendar.setSeason(command.season);
  },
  setSelection: (simulation, command) => {
    simulation.setSelection(command.selection);
  },
  setSpeed: (simulation, command) => {
    simulation.setSpeed(command.speed);
  },
  setTemperatureOffset: (simulation, command) => {
    simulation.weather.setUserTemperatureOffset(command.offset);
  },
  setTimeFrozen: (simulation, command) => {
    simulation.calendar.isTimeFrozen = command.isFrozen;
  },
  setViewFocus: (simulation, command) => {
    simulation.setViewFocus(command.x, command.z);
  },
  setWeather: (simulation, command) => {
    simulation.setWeather(command.weather);
  },
  setWind: (simulation, command) => {
    simulation.weather.setWind(command.direction, command.speed, simulation.rules.storms.windStrength);
  },
  setWorldRules: (simulation, command) => {
    simulation.setRules(readWorldRules(command.rules));
  },
  usePower: (simulation, command) => {
    simulation.usePower(command.powerId, command.x, command.z, command.parameters);
  },
};

export function runCommand<Type extends SimulationCommandType>(
  simulation: Simulation,
  type: Type,
  command: CommandOf<Type>
): void {
  const handler: CommandHandlers[Type] = COMMAND_HANDLERS[type];

  handler(simulation, command);
}
