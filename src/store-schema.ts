import type { Calibration } from "./calibration";
import type { DetectorTiming, Thresholds } from "./detector";
import type { Frame } from "./features";

/** Contents of data/calibration.json. Calibrations are keyed by mic label. */
export interface StoreFile {
  lastMic?: string;
  mics: Record<string, Calibration>;
}

/** One set's audio features, saved to test/fixtures for regression tests. */
export interface SetRecording {
  recordedAt: string;
  mic: string;
  thresholds: Thresholds;
  timing: DetectorTiming;
  frames: Frame[];
  detectedCount: number;
  actualCount: number;
}

const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export function isCalibration(x: unknown): x is Calibration {
  return (
    isRecord(x) &&
    typeof x.calibratedAt === "string" &&
    isNumber(x.noiseFloorDb) &&
    isNumber(x.onOffsetDb) &&
    isNumber(x.offOffsetDb) &&
    isNumber(x.minFlatness) &&
    isNumber(x.minHighRatio)
  );
}

export function isStoreFile(x: unknown): x is StoreFile {
  return (
    isRecord(x) &&
    (x.lastMic === undefined || typeof x.lastMic === "string") &&
    isRecord(x.mics) &&
    Object.values(x.mics).every(isCalibration)
  );
}

function isThresholds(x: unknown): x is Thresholds {
  return isRecord(x) && isNumber(x.onDb) && isNumber(x.offDb) && isNumber(x.minFlatness) && isNumber(x.minHighRatio);
}

function isTiming(x: unknown): x is DetectorTiming {
  return isRecord(x) && isNumber(x.minDurationMs) && isNumber(x.maxDurationMs) && isNumber(x.minGapMs);
}

function isFrame(x: unknown): x is Frame {
  return isRecord(x) && isNumber(x.t) && isNumber(x.db) && isNumber(x.flatness) && isNumber(x.highRatio);
}

export function isSetRecording(x: unknown): x is SetRecording {
  return (
    isRecord(x) &&
    typeof x.recordedAt === "string" &&
    typeof x.mic === "string" &&
    isThresholds(x.thresholds) &&
    isTiming(x.timing) &&
    Array.isArray(x.frames) &&
    x.frames.every(isFrame) &&
    isCount(x.detectedCount) &&
    isCount(x.actualCount)
  );
}
