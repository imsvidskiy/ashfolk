import { Button } from "@base-ui/react/button";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Pause } from "lucide-react";
import { useSendCommand } from "../../app/use-engine.ts";
import { cn } from "../../design/cn.ts";
import { SEGMENT, SEGMENT_TRACK } from "../../design/styles.ts";
import { SIMULATION_SPEEDS } from "../../simulation/tick.ts";
import { useWorldStore } from "../world/world-store.ts";

function SpeedOption({ speed }: { readonly speed: number }) {
  return (
    <Toggle
      aria-label={`Speed ${speed} times`}
      className={cn(SEGMENT, "min-w-8 px-1.5 font-semibold tabular-nums lg:min-w-9 lg:px-2")}
      value={String(speed)}
    >
      {speed}×
    </Toggle>
  );
}

function useTimeControls() {
  const send = useSendCommand();
  const isPaused = useWorldStore((state) => state.snapshot?.isPaused === true);
  const speed = useWorldStore((state) => state.snapshot?.speed);

  function handlePauseToggle(): void {
    send({ isPaused: !isPaused, type: "setPaused" });
  }

  function handleSpeedChange(values: string[]): void {
    const [selected] = values;

    if (selected === undefined) {
      return;
    }

    send({ speed: Number(selected), type: "setSpeed" });

    if (isPaused) {
      send({ isPaused: false, type: "setPaused" });
    }
  }

  return { handlePauseToggle, handleSpeedChange, isPaused, speed };
}

export function TimeControls() {
  const { handlePauseToggle, handleSpeedChange, isPaused, speed } = useTimeControls();

  const pressedSpeeds = isPaused || speed === undefined ? [] : [String(speed)];

  return (
    <div className={cn(SEGMENT_TRACK, "items-center p-1")}>
      <Button
        aria-label={isPaused ? "Resume" : "Pause"}
        className={cn(SEGMENT, "w-8 px-0", { "text-ink shadow-segment bg-white": isPaused })}
        onClick={handlePauseToggle}
      >
        <Pause aria-hidden="true" fill="currentColor" size={14} />
      </Button>

      <span aria-hidden="true" className="bg-line mx-1 h-5 w-px shrink-0" />

      <ToggleGroup
        aria-label="Game speed"
        className="flex flex-1 justify-between gap-0.5"
        onValueChange={handleSpeedChange}
        value={pressedSpeeds}
      >
        {SIMULATION_SPEEDS.map((option) => (
          <SpeedOption key={option} speed={option} />
        ))}
      </ToggleGroup>
    </div>
  );
}
