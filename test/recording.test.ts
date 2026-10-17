import { describe, expect, it } from "vitest";
import type { Thresholds } from "../src/detector";
import { buildRecording, replayCount } from "../src/recording";
import { isSetRecording } from "../src/store-schema";
import { exhale, frames, quiet } from "./frames";

const TH: Thresholds = { onDb: -40, offDb: -50, minFlatness: 0.3, minHighRatio: 0.3 };

describe("buildRecording", () => {
  it("rounds frame values and produces a valid recording", () => {
    const recording = buildRecording({
      mic: "Headset",
      thresholds: TH,
      frames: [{ t: 21.33333, db: -61.23456, flatness: 0.512345, highRatio: 0.654321 }],
      detectedCount: 0,
      actualCount: 0,
      recordedAt: new Date("2026-10-14T05:10:00Z"),
    });
    expect(recording.frames).toEqual([{ t: 21.3, db: -61.23, flatness: 0.5123, highRatio: 0.6543 }]);
    expect(recording.recordedAt).toBe("2026-10-14T05:10:00.000Z");
    expect(recording.timing).toEqual({ minDurationMs: 150, maxDurationMs: 3000, minGapMs: 600, minHeldMs: 200 });
    expect(isSetRecording(recording)).toBe(true);
  });
});

describe("replayCount", () => {
  it("counts the reps in a recording", () => {
    const recording = buildRecording({
      mic: "Headset",
      thresholds: TH,
      frames: frames(quiet(500), exhale(), quiet(800), exhale(), quiet(500)),
      detectedCount: 2,
      actualCount: 2,
    });
    expect(replayCount(recording)).toBe(2);
  });
});
