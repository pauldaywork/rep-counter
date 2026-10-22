import { describe, expect, it } from "vitest";
import { FeatureExtractor, frameSizeFor, rmsDb, type Frame } from "../src/features";
import { sine, whiteNoise } from "./signals";

const SR = 48000;

function oneFrame(signal: Float64Array): Frame {
  const frames = new FeatureExtractor(SR).push(signal);
  expect(frames).toHaveLength(1);
  return frames[0];
}

// From test/mfcc-reference.py (librosa 0.11.0).
const NOISE_MFCC = [
  -1.236, -0.6384, -2.2306, -0.4316, -5.3139, -1.0252, -9.7165, -4.7557, 3.1732, 0.1804, -4.7393, -4.6294, -8.2369,
  0.0573, 1.9681, -5.588, -0.393, 2.4455, -7.8833,
];
const TONES_MFCC = [
  76.9347, 84.256, 28.2012, 83.0701, -61.0399, -11.1096, 65.9761, -72.8534, -13.0914, -6.1078, 17.3407, -73.0218,
  21.3487, -3.2099, -12.6955, -22.9709, 22.0718, -0.6629, -22.239,
];

function expectMfcc(actual: number[] | undefined, expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual!.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 3));
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

describe("FeatureExtractor MFCCs", () => {
  it("matches librosa on white noise", () => {
    expectMfcc(oneFrame(whiteNoise(1, 1024)).mfcc, NOISE_MFCC);
  });

  it("matches librosa on a mix of 300 Hz, 1.5 kHz and 3.2 kHz tones", () => {
    const low = sine(300, SR, 1024, 0.3);
    const mid = sine(1500, SR, 1024, 0.2);
    const high = sine(3200, SR, 1024, 0.1);
    expectMfcc(oneFrame(low.map((v, i) => v + mid[i] + high[i])).mfcc, TONES_MFCC);
  });

  it("gives 19 zeros for silence, where every band sits at the floor", () => {
    const mfcc = oneFrame(new Float64Array(1024)).mfcc;
    expect(mfcc).toHaveLength(19);
    for (const value of mfcc!) expect(value).toBeCloseTo(0, 9);
  });

  it("gives 19 finite values at 16 kHz, where some low bands hold no FFT bin", () => {
    const frames = new FeatureExtractor(16000).push(whiteNoise(2, 256));
    expect(frames).toHaveLength(1);
    expect(frames[0].mfcc).toHaveLength(19);
    expect(frames[0].mfcc!.every(Number.isFinite)).toBe(true);
  });
});
