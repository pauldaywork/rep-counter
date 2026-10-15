import type { Frame } from "./features";

export interface Thresholds {
  /** the gate opens at or above this level */
  onDb: number;
  /** the gate closes below this level */
  offDb: number;
  minFlatness: number;
  minHighRatio: number;
}

export interface DetectorTiming {
  minDurationMs: number;
  maxDurationMs: number;
  /** from the end of the last rep to the start of the next sound */
  minGapMs: number;
}

export const DEFAULT_TIMING: DetectorTiming = { minDurationMs: 150, maxDurationMs: 2000, minGapMs: 600 };

export type DetectorEvent =
  | { kind: "rep"; t: number; durationMs: number }
  | { kind: "rejected"; t: number; reason: string };

/**
 * Hysteresis gate over frame levels. A sound opens the gate at onDb and
 * closes it below offDb; it is then classified as a rep or rejected.
 */
export class Detector {
  private state: "idle" | "active" | "overlong" = "idle";
  private startT = 0;
  private frameCount = 0;
  private flatnessSum = 0;
  private highRatioSum = 0;
  private lastRepT = -Infinity;

  constructor(
    private readonly thresholds: Thresholds,
    private readonly timing: DetectorTiming = DEFAULT_TIMING,
  ) {}

  push(frame: Frame): DetectorEvent | null {
    const { onDb, offDb } = this.thresholds;
    switch (this.state) {
      case "idle":
        if (frame.db >= onDb) {
          this.state = "active";
          this.startT = frame.t;
          this.frameCount = 0;
          this.flatnessSum = 0;
          this.highRatioSum = 0;
          this.accumulate(frame);
        }
        return null;
      case "active":
        if (frame.db < offDb) {
          this.state = "idle";
          return this.classify(frame.t);
        }
        this.accumulate(frame);
        if (frame.t - this.startT > this.timing.maxDurationMs) {
          this.state = "overlong";
          return { kind: "rejected", t: frame.t, reason: `too long (over ${this.timing.maxDurationMs} ms)` };
        }
        return null;
      case "overlong":
        if (frame.db < offDb) this.state = "idle";
        return null;
    }
  }

  private accumulate(frame: Frame): void {
    this.frameCount++;
    this.flatnessSum += frame.flatness;
    this.highRatioSum += frame.highRatio;
  }

  private classify(endT: number): DetectorEvent {
    const durationMs = endT - this.startT;
    const flatness = this.flatnessSum / this.frameCount;
    const highRatio = this.highRatioSum / this.frameCount;
    const { minFlatness, minHighRatio } = this.thresholds;
    const { minDurationMs, minGapMs } = this.timing;
    const reject = (reason: string): DetectorEvent => ({ kind: "rejected", t: endT, reason });

    if (durationMs < minDurationMs) return reject(`too short (${Math.round(durationMs)} ms)`);
    if (flatness < minFlatness) return reject(`tonal (flatness ${flatness.toFixed(2)} < ${minFlatness.toFixed(2)})`);
    if (highRatio < minHighRatio) {
      return reject(`low-frequency (high ratio ${highRatio.toFixed(2)} < ${minHighRatio.toFixed(2)})`);
    }
    const gap = this.startT - this.lastRepT;
    if (gap < minGapMs) return reject(`too soon (${Math.round(gap)} ms after the last rep)`);

    this.lastRepT = endT;
    return { kind: "rep", t: endT, durationMs };
  }
}
