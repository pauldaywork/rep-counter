import { describe, expect, it } from "vitest";
import {
  deriveCalibration,
  DIGITAL_SILENCE_DB,
  exhalesComplete,
  MAX_REBASE_DB,
  MIN_SPAN_DB,
  noiseFloor,
  rebasedFloor,
  segmentExhales,
  thresholdsFor,
  WARMUP_MS,
  type Calibration,
} from "../src/calibration";
import type { Frame } from "../src/features";
import { frames, quiet, type Segment } from "./frames";

const FLOOR = -70;
const NOW = new Date("2026-10-14T05:00:00Z");
const breathA: Segment = { ms: 400, db: -30, flatness: 0.5, highRatio: 0.6 };
const breathB: Segment = { ms: 400, db: -34, flatness: 0.4, highRatio: 0.5 };
const breathC: Segment = { ms: 400, db: -32, flatness: 0.45, highRatio: 0.7 };
const threeBreaths = frames(quiet(500), breathA, quiet(600), breathB, quiet(600), breathC, quiet(800));

/** Frames 20 ms apart from t = 20, behind a loud warm-up that noiseFloor must ignore. */
function dbFrames(...dbs: number[]): Frame[] {
  const warmup = Array.from({ length: WARMUP_MS / 20 }, () => -10);
  return [...warmup, ...dbs].map((db, i) => ({ t: (i + 1) * 20, db, flatness: 0.5, highRatio: 0.5 }));
}

function calibrated(): Calibration {
  const result = deriveCalibration(frames(quiet(3000)), threeBreaths, NOW);
  if (!result.ok) throw new Error(result.reason);
  return result.calibration;
}

describe("noiseFloor", () => {
  it("is the median frame level", () => {
    expect(noiseFloor(dbFrames(-70, -60, -80))).toBe(-70);
    expect(noiseFloor(dbFrames(-70, -60, -80, -50))).toBe(-65);
  });

  it("ignores digital silence", () => {
    expect(DIGITAL_SILENCE_DB).toBe(-150);
    expect(noiseFloor(dbFrames(-200, -200, -200, -70, -60, -80))).toBe(-70);
  });

  it("ignores the first 400 ms of audio", () => {
    const loudStart = frames({ ms: 400, db: -20 }, quiet(400));
    expect(noiseFloor(loudStart)).toBe(-70);
  });

  it("throws when only silence remains", () => {
    const silent = frames({ ms: 1000, db: -200 });
    expect(() => noiseFloor(silent)).toThrow(/^The microphone sent only silence\./);
    expect(() => noiseFloor(frames(quiet(400)))).toThrow(/only silence/);
  });

  it("throws when given no frames", () => {
    expect(() => noiseFloor([])).toThrow(/No audio was captured/);
  });
});

describe("rebasedFloor", () => {
  it("passes a measurement near the calibrated floor unchanged", () => {
    expect(rebasedFloor(calibrated(), -65)).toBe(-65);
    expect(rebasedFloor(calibrated(), -70 + MAX_REBASE_DB)).toBe(-60);
  });

  it("clamps to 10 dB either side of the calibrated floor", () => {
    expect(MAX_REBASE_DB).toBe(10);
    expect(rebasedFloor(calibrated(), -40)).toBe(-60);
    expect(rebasedFloor(calibrated(), -200)).toBe(-80);
  });
});

describe("segmentExhales", () => {
  it("finds each exhale with its peak and means", () => {
    const segments = segmentExhales(threeBreaths, FLOOR);
    expect(segments.map((s) => s.peakDb)).toEqual([-30, -34, -32]);
    expect(segments[1]).toMatchObject({ meanFlatness: expect.closeTo(0.4, 6), meanHighRatio: expect.closeTo(0.5, 6) });
  });

  it("drops sounds shorter than 150 ms", () => {
    const withClank = frames(quiet(500), { ms: 60, db: -30 }, quiet(500), breathA, quiet(500));
    expect(segmentExhales(withClank, FLOOR)).toHaveLength(1);
  });
});

describe("deriveCalibration", () => {
  it("derives thresholds from the softest of the exhales", () => {
    // span = -34 - (-70) = 36 dB
    expect(calibrated()).toEqual({
      calibratedAt: "2026-10-14T05:00:00.000Z",
      noiseFloorDb: -70,
      onOffsetDb: expect.closeTo(18, 6),
      offOffsetDb: expect.closeTo(10.8, 6),
      minFlatness: expect.closeTo(0.28, 6),
      minHighRatio: expect.closeTo(0.35, 6),
    });
  });

  it("keeps the three loudest when it hears more than three sounds", () => {
    const fourSounds = frames(
      quiet(500), breathA, quiet(600), breathB, quiet(600), breathC, quiet(600), { ms: 400, db: -55 }, quiet(800),
    );
    const result = deriveCalibration(frames(quiet(3000)), fourSounds, NOW);
    expect(result).toMatchObject({ ok: true, calibration: { onOffsetDb: expect.closeTo(18, 6) } });
  });

  it("asks for a retry when fewer than three exhales are heard", () => {
    const twoBreaths = frames(quiet(500), breathA, quiet(600), breathB, quiet(800));
    const result = deriveCalibration(frames(quiet(3000)), twoBreaths, NOW);
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/^Heard 2 of 3 breaths/) });
  });

  it("fails when the breaths are under 15 dB above the background", () => {
    expect(MIN_SPAN_DB).toBe(15);
    const faint: Segment = { ms: 400, db: -58, flatness: 0.5, highRatio: 0.6 };
    const result = deriveCalibration(frames(quiet(3000)), frames(quiet(500), faint, quiet(600), faint, quiet(600), faint, quiet(800)), NOW);
    expect(result).toEqual({
      ok: false,
      reason: "Breaths were only 12 dB above the background; need 15. Breathe out harder, closer to the mic.",
    });
  });

  it("ignores breaths quieter than 10 dB above the background", () => {
    const soft = frames(quiet(500), { ms: 400, db: -62 }, quiet(600), breathA, quiet(600), breathB, quiet(800));
    expect(deriveCalibration(frames(quiet(3000)), soft, NOW)).toMatchObject({ ok: false });
  });
});

describe("thresholdsFor", () => {
  it("uses the calibrated noise floor by default", () => {
    expect(thresholdsFor(calibrated())).toEqual({
      onDb: expect.closeTo(-52, 6),
      offDb: expect.closeTo(-59.2, 6),
      minFlatness: expect.closeTo(0.28, 6),
      minHighRatio: expect.closeTo(0.35, 6),
    });
  });

  it("re-bases on a new noise floor", () => {
    expect(thresholdsFor(calibrated(), -60)).toMatchObject({
      onDb: expect.closeTo(-42, 6),
      offDb: expect.closeTo(-49.2, 6),
    });
  });
});

describe("exhalesComplete", () => {
  it("waits for three exhales and 600 ms of quiet after the last", () => {
    const two = frames(quiet(500), breathA, quiet(600), breathB, quiet(800));
    const justAfterThird = frames(quiet(500), breathA, quiet(600), breathB, quiet(600), breathC, quiet(300));
    expect(exhalesComplete(two, FLOOR)).toBe(false);
    expect(exhalesComplete(justAfterThird, FLOOR)).toBe(false);
    expect(exhalesComplete(threeBreaths, FLOOR)).toBe(true);
  });
});
