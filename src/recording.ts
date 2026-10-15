import { DEFAULT_TIMING, Detector, type Thresholds } from "./detector";
import type { Frame } from "./features";
import type { SetRecording } from "./store-schema";

export interface RecordingInput {
  mic: string;
  thresholds: Thresholds;
  frames: Frame[];
  detectedCount: number;
  actualCount: number;
  recordedAt?: Date;
}

export function buildRecording(input: RecordingInput): SetRecording {
  return {
    recordedAt: (input.recordedAt ?? new Date()).toISOString(),
    mic: input.mic,
    thresholds: input.thresholds,
    timing: { ...DEFAULT_TIMING },
    frames: roundFrames(input.frames),
    detectedCount: input.detectedCount,
    actualCount: input.actualCount,
  };
}

/**
 * Replays a recording with its saved thresholds but the current
 * DEFAULT_TIMING, so changes to the timing rules are checked against
 * every saved set.
 */
export function replayCount(recording: SetRecording): number {
  const detector = new Detector(recording.thresholds, DEFAULT_TIMING);
  let count = 0;
  for (const frame of recording.frames) {
    if (detector.push(frame)?.kind === "rep") count++;
  }
  return count;
}

/** Rounds frame values to the precision saved files need, to keep them small. */
export function roundFrames(frames: Frame[]): Frame[] {
  return frames.map((f) => ({
    t: round(f.t, 1),
    db: round(f.db, 2),
    flatness: round(f.flatness, 4),
    highRatio: round(f.highRatio, 4),
  }));
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places));
}
