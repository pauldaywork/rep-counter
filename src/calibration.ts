import { DEFAULT_TIMING, type Thresholds } from "./detector";
import type { Frame } from "./features";

/** One mic's calibration, as saved in data/calibration.json. */
export interface Calibration {
  calibratedAt: string;
  noiseFloorDb: number;
  /** thresholds are stored relative to the noise floor so they can be re-based */
  onOffsetDb: number;
  offOffsetDb: number;
  minFlatness: number;
  minHighRatio: number;
}

export interface ExhaleSegment {
  startT: number;
  endT: number;
  peakDb: number;
  meanFlatness: number;
  meanHighRatio: number;
}

export type CalibrationResult = { ok: true; calibration: Calibration } | { ok: false; reason: string };

export const REQUIRED_EXHALES = 3;
const SEGMENT_OPEN_DB = 10;
const SEGMENT_CLOSE_DB = 6;

export function noiseFloor(frames: Frame[]): number {
  if (frames.length === 0) throw new Error("No audio was captured to measure the background noise.");
  const sorted = frames.map((f) => f.db).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Splits calibration audio into sounds with a provisional gate that opens
 * 10 dB above the noise floor. A sound still going at the end is dropped.
 */
export function segmentExhales(frames: Frame[], noiseFloorDb: number): ExhaleSegment[] {
  const openDb = noiseFloorDb + SEGMENT_OPEN_DB;
  const closeDb = noiseFloorDb + SEGMENT_CLOSE_DB;
  const segments: ExhaleSegment[] = [];
  let current: Frame[] = [];

  for (const frame of frames) {
    if (current.length === 0) {
      if (frame.db >= openDb) current.push(frame);
    } else if (frame.db >= closeDb) {
      current.push(frame);
    } else {
      const startT = current[0].t;
      if (frame.t - startT >= DEFAULT_TIMING.minDurationMs) {
        segments.push({
          startT,
          endT: frame.t,
          peakDb: Math.max(...current.map((f) => f.db)),
          meanFlatness: mean(current.map((f) => f.flatness)),
          meanHighRatio: mean(current.map((f) => f.highRatio)),
        });
      }
      current = [];
    }
  }
  return segments;
}

/** True once three exhales were heard and the last ended at least settleMs ago. */
export function exhalesComplete(frames: Frame[], noiseFloorDb: number, settleMs = 600): boolean {
  const segments = segmentExhales(frames, noiseFloorDb);
  if (segments.length < REQUIRED_EXHALES) return false;
  return frames[frames.length - 1].t - segments[segments.length - 1].endT >= settleMs;
}

export function deriveCalibration(quiet: Frame[], exhales: Frame[], now: Date = new Date()): CalibrationResult {
  const noiseFloorDb = noiseFloor(quiet);
  const found = segmentExhales(exhales, noiseFloorDb);
  if (found.length < REQUIRED_EXHALES) {
    return {
      ok: false,
      reason: `Heard ${found.length} of ${REQUIRED_EXHALES} breaths. Breathe out harder, one breath at a time.`,
    };
  }
  const loudest = [...found].sort((a, b) => b.peakDb - a.peakDb).slice(0, REQUIRED_EXHALES);
  // Every segment peaks at least 10 dB above the floor, so span >= 10 dB.
  const span = Math.min(...loudest.map((s) => s.peakDb)) - noiseFloorDb;
  return {
    ok: true,
    calibration: {
      calibratedAt: now.toISOString(),
      noiseFloorDb,
      onOffsetDb: 0.5 * span,
      offOffsetDb: 0.3 * span,
      minFlatness: 0.7 * Math.min(...loudest.map((s) => s.meanFlatness)),
      minHighRatio: 0.7 * Math.min(...loudest.map((s) => s.meanHighRatio)),
    },
  };
}

export function thresholdsFor(calibration: Calibration, noiseFloorDb = calibration.noiseFloorDb): Thresholds {
  return {
    onDb: noiseFloorDb + calibration.onOffsetDb,
    offDb: noiseFloorDb + calibration.offOffsetDb,
    minFlatness: calibration.minFlatness,
    minHighRatio: calibration.minHighRatio,
  };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
