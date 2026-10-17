import type { Calibration, ExhaleSegment } from "./calibration";
import type { DetectorEvent, DetectorTiming, Thresholds } from "./detector";
import type { Frame } from "./features";
import type { CalibrationLog, SetLog } from "./logs";

/** Contents of data/calibration.json. Calibrations are keyed by mic label. */
export interface StoreFile {
  lastMic?: string;
  mics: Record<string, Calibration>;
}

/** One exercise in a workout: `sets` sets of `reps` reps each. */
export interface Activity {
  name: string;
  reps: number;
  sets: number;
}

/** A named list of activities, run set by set on the routine page. */
export interface Workout {
  id: string;
  name: string;
  activities: Activity[];
  /** the rest between sets; 0 waits for a button press instead */
  restSeconds: number;
  /** runs each pair of activities a set of one, then a set of the other, until both are done */
  alternateSets?: boolean;
}

/** Contents of data-routine/workouts.json: every saved workout, and the one last chosen. */
export interface WorkoutLibrary {
  lastWorkout?: string;
  workouts: Workout[];
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

const isPositiveCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1;

function isActivity(x: unknown): x is Activity {
  return isRecord(x) && typeof x.name === "string" && x.name.trim() !== "" && isPositiveCount(x.reps) && isPositiveCount(x.sets);
}

export function isWorkout(x: unknown): x is Workout {
  return (
    isRecord(x) &&
    typeof x.id === "string" &&
    x.id !== "" &&
    typeof x.name === "string" &&
    x.name.trim() !== "" &&
    Array.isArray(x.activities) &&
    x.activities.every(isActivity) &&
    isCount(x.restSeconds) &&
    (x.alternateSets === undefined || typeof x.alternateSets === "boolean")
  );
}

export function isWorkoutLibrary(x: unknown): x is WorkoutLibrary {
  if (!isRecord(x) || !isOptionalString(x.lastWorkout) || !Array.isArray(x.workouts) || !x.workouts.every(isWorkout)) {
    return false;
  }
  const ids = x.workouts.map((w) => w.id);
  return new Set(ids).size === ids.length;
}

function isRoutineStep(x: unknown): boolean {
  return (
    isRecord(x) &&
    typeof x.runId === "string" &&
    typeof x.workout === "string" &&
    typeof x.activity === "string" &&
    isPositiveCount(x.set) &&
    isPositiveCount(x.sets)
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
  // minHeldMs was added later, so files saved before it may lack it.
  return (
    isRecord(x) &&
    isNumber(x.minDurationMs) &&
    isNumber(x.maxDurationMs) &&
    isNumber(x.minGapMs) &&
    (x.minHeldMs === undefined || isNumber(x.minHeldMs))
  );
}

function isFrame(x: unknown): x is Frame {
  return isRecord(x) && isNumber(x.t) && isNumber(x.db) && isNumber(x.flatness) && isNumber(x.highRatio);
}

const isFrames = (x: unknown): x is Frame[] => Array.isArray(x) && x.every(isFrame);
const isOptionalString = (x: unknown) => x === undefined || typeof x === "string";

function isEvent(x: unknown): x is DetectorEvent {
  return (
    isRecord(x) &&
    isNumber(x.t) &&
    ((x.kind === "rep" && isNumber(x.durationMs)) || (x.kind === "rejected" && typeof x.reason === "string"))
  );
}

function isSegment(x: unknown): x is ExhaleSegment {
  return (
    isRecord(x) &&
    isNumber(x.startT) &&
    isNumber(x.endT) &&
    isNumber(x.peakDb) &&
    isNumber(x.meanFlatness) &&
    isNumber(x.meanHighRatio)
  );
}

export function isSetLog(x: unknown): x is SetLog {
  return (
    isRecord(x) &&
    x.kind === "set" &&
    typeof x.id === "string" &&
    typeof x.startedAt === "string" &&
    typeof x.endedAt === "string" &&
    typeof x.mic === "string" &&
    isCount(x.target) &&
    (x.outcome === "complete" || x.outcome === "stopped" || x.outcome === "error") &&
    isOptionalString(x.error) &&
    typeof x.dingOnRep === "boolean" &&
    isCalibration(x.calibration) &&
    isNumber(x.quietFloorDb) &&
    isFrames(x.quietFrames) &&
    isThresholds(x.thresholds) &&
    isTiming(x.timing) &&
    isCount(x.detectedCount) &&
    isCount(x.finalCount) &&
    (x.actualCount === null || isCount(x.actualCount)) &&
    Array.isArray(x.events) &&
    x.events.every(isEvent) &&
    Array.isArray(x.adjustments) &&
    x.adjustments.every((a) => isRecord(a) && isNumber(a.t) && (a.delta === 1 || a.delta === -1)) &&
    isFrames(x.frames) &&
    (x.routine === undefined || isRoutineStep(x.routine))
  );
}

export function isCalibrationLog(x: unknown): x is CalibrationLog {
  return (
    isRecord(x) &&
    x.kind === "calibration" &&
    typeof x.id === "string" &&
    typeof x.startedAt === "string" &&
    typeof x.mic === "string" &&
    typeof x.ok === "boolean" &&
    isOptionalString(x.reason) &&
    (x.calibration === undefined || isCalibration(x.calibration)) &&
    isNumber(x.noiseFloorDb) &&
    Array.isArray(x.segments) &&
    x.segments.every(isSegment) &&
    isFrames(x.quietFrames) &&
    isFrames(x.exhaleFrames)
  );
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
