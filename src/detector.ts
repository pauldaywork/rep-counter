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
  /** how long a sound must stay within HELD_WINDOW_DB of its own peak */
  minHeldMs: number;
}

export const DEFAULT_TIMING: DetectorTiming = { minDurationMs: 150, maxDurationMs: 3000, minGapMs: 600, minHeldMs: 200 };

/**
 * A clap or a weight's dink spikes and then fades, and its echo can keep it
 * above offDb for longer than minDurationMs. An exhale holds near its peak;
 * a spike drops more than this far below its peak almost at once.
 */
export const HELD_WINDOW_DB = 10;

/**
 * The gate follows the background, so in a quiet room it opens for soft
 * breaths and shuffles. Logged reps peak at -22 dB or louder and those
 * stray sounds at -27 dB or quieter, so a rep must peak at least this loud,
 * unless it lasts SOFT_REP_MIN_MS.
 */
export const MIN_PEAK_DB = -30;

/**
 * A softer rep still lasts as long as a loud one: exhales peaking at -36 to
 * -41 dB fell in step with the loud reps and lasted 1.0 s or more for rows
 * and 1.3 s or more for hip thrusts, while inhales between reps lasted under
 * 1.0 s.
 */
export const SOFT_REP_MIN_MS = 1000;

/**
 * An exhale's level rises and falls smoothly, while shuffles and clanks
 * jump about from frame to frame. Jitter is the mean change in level
 * between frames: logged reps have a median of 1.8 dB and 90% stay under
 * 2.4 dB, so it is too blunt to judge every sound. It only lets a long,
 * smooth sound past the spike check: a real exhale scored 2.0 dB and the
 * setup noises it would also let through 2.2 dB or more.
 */
export const SMOOTH_JITTER_DB = 2.2;

/**
 * Calibration sets minFlatness from three fresh breaths, but reps get less
 * hissy as a set wears on: late reps averaged 0.04 to 0.08, and a noisy
 * calibration once set the minimum at 0.10, rejecting half a set. Logged
 * grunts and hums average 0.01 or less, so the minimum never goes above this.
 */
export const MAX_MIN_FLATNESS = 0.02;

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
  private levels: number[] = [];
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
          this.levels = [];
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
    this.levels.push(frame.db);
    this.flatnessSum += frame.flatness;
    this.highRatioSum += frame.highRatio;
  }

  private classify(endT: number): DetectorEvent {
    const durationMs = endT - this.startT;
    const flatness = this.flatnessSum / this.frameCount;
    const highRatio = this.highRatioSum / this.frameCount;
    const minFlatness = Math.min(this.thresholds.minFlatness, MAX_MIN_FLATNESS);
    const { minHighRatio } = this.thresholds;
    const { minDurationMs, minGapMs, minHeldMs } = this.timing;
    const reject = (reason: string): DetectorEvent => ({ kind: "rejected", t: endT, reason });

    if (durationMs < minDurationMs) return reject(`too short (${Math.round(durationMs)} ms)`);
    const peakDb = Math.max(...this.levels);
    const frameMs = durationMs / this.frameCount;
    const heldMs = this.levels.filter((db) => db >= peakDb - HELD_WINDOW_DB).length * frameMs;
    const jitter = meanStep(this.levels);
    // A long, smooth exhale can burst at the start and then hold well below that peak.
    const smoothBreath = durationMs >= SOFT_REP_MIN_MS && jitter < SMOOTH_JITTER_DB;
    if (heldMs < minHeldMs && !smoothBreath) return reject(`spike (near its peak for only ${Math.round(heldMs)} ms)`);
    if (peakDb < MIN_PEAK_DB && durationMs < SOFT_REP_MIN_MS) return reject(`too quiet (peak ${peakDb.toFixed(0)} dB < ${MIN_PEAK_DB} dB)`);
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

/** The mean change in level from one frame to the next. */
function meanStep(levels: number[]): number {
  let sum = 0;
  for (let i = 1; i < levels.length; i++) sum += Math.abs(levels[i] - levels[i - 1]);
  return levels.length > 1 ? sum / (levels.length - 1) : 0;
}
