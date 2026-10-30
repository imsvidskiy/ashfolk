const SLOW_FRAME_MILLISECONDS = 22;
const SMOOTH_FRAME_MILLISECONDS = 18;
const FRAME_SMOOTHING = 0.08;
const LOWEST_SCALE = 0.5;
const LOWEST_PIXEL_RATIO = 0.75;
const SCALE_STEP = 0.85;
const SETTLE_MILLISECONDS = 1500;
const RECOVERY_MILLISECONDS = 6000;
const LONGEST_MEASURED_FRAME_MILLISECONDS = 250;

export class ResolutionGovernor {
  readonly #maximumPixelRatio: number;
  #averageFrameMilliseconds = SMOOTH_FRAME_MILLISECONDS;
  #isHeld: boolean;
  #millisecondsSinceChange = 0;
  #scale = 1;

  constructor(maximumPixelRatio: number) {
    this.#maximumPixelRatio = maximumPixelRatio;
    this.#isHeld = false;
  }

  pixelRatio(devicePixelRatio: number): number {
    const sharpest = Math.min(devicePixelRatio, this.#maximumPixelRatio);

    return Math.min(sharpest, Math.max(LOWEST_PIXEL_RATIO, sharpest * this.#scale));
  }

  hold(isHeld: boolean): void {
    this.#isHeld = isHeld;

    if (isHeld) {
      this.#change(1);
    }
  }

  record(elapsed: number, hasFocus: boolean): boolean {
    if (this.#isHeld || !hasFocus || elapsed <= 0 || elapsed > LONGEST_MEASURED_FRAME_MILLISECONDS) {
      return false;
    }

    this.#averageFrameMilliseconds += (elapsed - this.#averageFrameMilliseconds) * FRAME_SMOOTHING;
    this.#millisecondsSinceChange += elapsed;

    if (this.#millisecondsSinceChange < SETTLE_MILLISECONDS) {
      return false;
    }

    if (this.#averageFrameMilliseconds > SLOW_FRAME_MILLISECONDS && this.#scale > LOWEST_SCALE) {
      return this.#change(Math.max(LOWEST_SCALE, this.#scale * SCALE_STEP));
    }

    const isSteady =
      this.#averageFrameMilliseconds < SMOOTH_FRAME_MILLISECONDS &&
      this.#millisecondsSinceChange >= RECOVERY_MILLISECONDS;

    if (isSteady && this.#scale < 1) {
      return this.#change(Math.min(1, this.#scale / SCALE_STEP));
    }

    return false;
  }

  #change(scale: number): boolean {
    this.#scale = scale;
    this.#millisecondsSinceChange = 0;
    this.#averageFrameMilliseconds = SMOOTH_FRAME_MILLISECONDS;

    return true;
  }
}
