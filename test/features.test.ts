import { describe, expect, it } from "vitest";
import { FeatureExtractor, frameSizeFor, rmsDb, type Frame } from "../src/features";
import { sine, whiteNoise } from "./signals";

const SR = 48000;

function oneFrame(signal: Float64Array): Frame {
  const frames = new FeatureExtractor(SR).push(signal);
  expect(frames).toHaveLength(1);
  return frames[0];
}

describe("frameSizeFor", () => {
  it("gives power-of-two frames of about 21 ms", () => {
    expect(frameSizeFor(48000)).toBe(1024);
    expect(frameSizeFor(44100)).toBe(1024);
    expect(frameSizeFor(96000)).toBe(2048);
    expect(frameSizeFor(16000)).toBe(256);
  });
});

describe("rmsDb", () => {
  it("measures a full-scale sine at about -3 dBFS", () => {
    expect(rmsDb(sine(1000, SR, 4800, 1))).toBeCloseTo(-3.01, 1);
  });

  it("measures silence as very low", () => {
    expect(rmsDb(new Float64Array(1024))).toBeLessThan(-150);
  });
});

describe("FeatureExtractor", () => {
  it("emits one frame per 1024 samples, timed at the frame end", () => {
    const extractor = new FeatureExtractor(SR);
    const frames: Frame[] = [];
    for (let i = 0; i < 16; i++) frames.push(...extractor.push(new Float64Array(128)));
    expect(frames.map((f) => f.t)).toEqual([expect.closeTo(21.333, 2), expect.closeTo(42.667, 2)]);
  });

  it("scores white noise as flat and mostly high-frequency", () => {
    // A single-frame periodogram of white noise scores about 0.56, not 1.
    const frame = oneFrame(whiteNoise(1, 1024));
    expect(frame.flatness).toBeGreaterThan(0.4);
    expect(frame.highRatio).toBeGreaterThan(0.65);
    expect(frame.highRatio).toBeLessThan(0.9);
  });

  it("scores a pure tone as not flat", () => {
    expect(oneFrame(sine(1000, SR, 1024)).flatness).toBeLessThan(0.01);
  });

  it("scores a 200 Hz hum as having almost no high-frequency energy", () => {
    expect(oneFrame(sine(200, SR, 1024)).highRatio).toBeLessThan(0.01);
  });
});
