import type { Calibration, ExhaleSegment } from "./calibration";
import { DEFAULT_TIMING, type DetectorEvent, type DetectorTiming, type Thresholds } from "./detector";
import type { Frame } from "./features";
import { roundFrames } from "./recording";

/** A manual +1 or −1, timed in ms since the set's mic session started. */
export interface Adjustment {
  t: number;
  delta: 1 | -1;
}

/** Everything about one set, saved automatically to data/logs/sets. */
export interface SetLog {
  kind: "set";
  id: string;
  startedAt: string;
  endedAt: string;
  mic: string;
  target: number;
  outcome: "complete" | "stopped" | "error";
  error?: string;
  dingOnRep: boolean;
  calibration: Calibration;
  /** this set's measured background level, before the re-base clamp */
  quietFloorDb: number;
  thresholds: Thresholds;
  timing: DetectorTiming;
  detectedCount: number;
  /** the count when the set ended, after manual corrections */
  finalCount: number;
  /** what the user said they did, once they enter it */
  actualCount: number | null;
  events: DetectorEvent[];
  adjustments: Adjustment[];
  frames: Frame[];
}

/** One calibration attempt, saved automatically to data/logs/calibrations. */
export interface CalibrationLog {
  kind: "calibration";
  id: string;
  startedAt: string;
  mic: string;
  ok: boolean;
  reason?: string;
  calibration?: Calibration;
  noiseFloorDb: number;
  segments: ExhaleSegment[];
  quietFrames: Frame[];
  exhaleFrames: Frame[];
}

export type LogKind = "sets" | "calibrations";

/** A file-name-safe id that sorts by time, e.g. 2026-10-15T04-44-33-804Z. */
export function logId(date: Date): string {
  return date.toISOString().replace(/[^0-9A-Za-z]/g, "-");
}

export type SetLogInput = Omit<SetLog, "kind" | "id" | "startedAt" | "endedAt" | "timing" | "actualCount"> & {
  startedAt: Date;
  endedAt: Date;
};

export function buildSetLog(input: SetLogInput): SetLog {
  const { startedAt, endedAt, frames, ...rest } = input;
  return {
    kind: "set",
    id: logId(startedAt),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    ...rest,
    timing: { ...DEFAULT_TIMING },
    actualCount: null,
    frames: roundFrames(frames),
  };
}

export type CalibrationLogInput = Omit<CalibrationLog, "kind" | "id" | "startedAt"> & { startedAt: Date };

export function buildCalibrationLog(input: CalibrationLogInput): CalibrationLog {
  const { startedAt, quietFrames, exhaleFrames, ...rest } = input;
  return {
    kind: "calibration",
    id: logId(startedAt),
    startedAt: startedAt.toISOString(),
    ...rest,
    quietFrames: roundFrames(quietFrames),
    exhaleFrames: roundFrames(exhaleFrames),
  };
}
