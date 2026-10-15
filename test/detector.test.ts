import { describe, expect, it } from "vitest";
import { Detector, type DetectorEvent, type Thresholds } from "../src/detector";
import type { Frame } from "../src/features";
import { exhale, frames, quiet, type Segment } from "./frames";

const TH: Thresholds = { onDb: -40, offDb: -50, minFlatness: 0.3, minHighRatio: 0.3 };

function run(input: Frame[]): DetectorEvent[] {
  const detector = new Detector(TH);
  return input.map((f) => detector.push(f)).filter((e): e is DetectorEvent => e !== null);
}

describe("Detector", () => {
  it("counts a clean exhale when it ends", () => {
    expect(run(frames(quiet(500), exhale(400), quiet(500)))).toEqual([{ kind: "rep", t: 920, durationMs: 400 }]);
  });

  it("rejects a clank as too short", () => {
    const events = run(frames(quiet(500), { ms: 80, db: -20 }, quiet(500)));
    expect(events).toEqual([{ kind: "rejected", t: 600, reason: expect.stringMatching(/^too short/) }]);
  });

  it("rejects a clap whose echo outlasts the minimum length as a spike", () => {
    // Like a logged clap: a sharp peak, then a tail fading 3 dB per frame.
    const tail = Array.from({ length: 14 }, (_, i): Segment => ({ ms: 20, db: -8 - 3 * i }));
    const events = run(frames(quiet(500), ...tail, quiet(500)));
    expect(events).toEqual([{ kind: "rejected", t: 800, reason: expect.stringMatching(/^spike/) }]);
  });

  it("counts an exhale that bursts at the start and then holds lower", () => {
    const events = run(frames(quiet(500), { ms: 40, db: -15 }, exhale(400, -24), quiet(500)));
    expect(events.map((e) => e.kind)).toEqual(["rep"]);
  });

  it("rejects a grunt as tonal", () => {
    const events = run(frames(quiet(500), { ms: 400, db: -25, flatness: 0.05 }, quiet(500)));
    expect(events).toEqual([{ kind: "rejected", t: 920, reason: expect.stringMatching(/^tonal/) }]);
  });

  it("rejects a thud as low-frequency", () => {
    const events = run(frames(quiet(500), { ms: 300, db: -25, highRatio: 0.1 }, quiet(500)));
    expect(events).toEqual([{ kind: "rejected", t: 820, reason: expect.stringMatching(/^low-frequency/) }]);
  });

  it("ignores a quiet inhale that never reaches onDb", () => {
    expect(run(frames(quiet(500), { ms: 600, db: -45 }, quiet(500)))).toEqual([]);
  });

  it("rejects a second exhale that starts within 600 ms of the last rep", () => {
    const events = run(frames(quiet(500), exhale(), quiet(300), exhale(), quiet(500)));
    expect(events.map((e) => e.kind)).toEqual(["rep", "rejected"]);
    expect(events[1]).toMatchObject({ reason: expect.stringMatching(/^too soon/) });
  });

  it("counts two exhales 700 ms apart", () => {
    const events = run(frames(quiet(500), exhale(), quiet(700), exhale(), quiet(500)));
    expect(events.map((e) => e.kind)).toEqual(["rep", "rep"]);
  });

  it("counts an exhale that dips between offDb and onDb once", () => {
    const events = run(frames(quiet(500), exhale(200), { ms: 60, db: -45 }, exhale(200), quiet(500)));
    expect(events).toEqual([{ kind: "rep", t: 980, durationMs: 460 }]);
  });

  it("rejects sustained noise as too long, then counts the next exhale", () => {
    const events = run(frames(quiet(500), exhale(3000), quiet(800), exhale(), quiet(500)));
    expect(events.map((e) => e.kind)).toEqual(["rejected", "rep"]);
    expect(events[0]).toMatchObject({ reason: expect.stringMatching(/^too long/) });
  });
});
