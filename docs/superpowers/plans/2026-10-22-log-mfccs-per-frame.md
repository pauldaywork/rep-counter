# Log MFCCs Per Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save 19 MFCCs with every audio frame in set logs, calibration logs and fixtures, so there is live-mic data to train and check a rep-vs-noise classifier on before it ever affects the count.

**Architecture:** `FeatureExtractor` (src/features.ts, run in the audio worklet) already computes each frame's power spectrum. It builds a 40-band Slaney mel filter bank over 100 Hz–4 kHz and an orthonormal DCT-II matrix once, in its constructor, and in `analyze()` turns the power spectrum into 40 log-mel energies (dB) and then into MFCCs 1–19 (c0, the loudness, is dropped). The values ride on an optional `mfcc` field of `Frame`, are rounded to 2 decimals with the other fields, and are optional in the schema check, so old logs and fixtures still load. Nothing in the detector reads them.

**Tech Stack:** TypeScript 7.0.2, Vitest 5.0.4, fft.js 4.0.4, Node 24. Reference values from Python 3 with librosa 0.11.0 and numpy 2.4.4 (both already installed system-wide for `python3`).

**Spec:** Taskwarrior task `a6d4e368-5367-4f81-a400-3c2d81304089` (its description and notes; read with `task rc.json.array=on a6d4e368-5367-4f81-a400-3c2d81304089 export`). Background: `docs/ideas/compare-sounds-to-reps.md` and `test/experiments/rep-classifier/README.md`.

## Global Constraints

- Compute the MFCCs by hand in `FeatureExtractor` from its existing power spectrum (mel filter bank over `BAND_LOW_HZ..BAND_HIGH_HZ`, log, DCT-II). Do not add Meyda or any other dependency.
- 40 mel bands, Slaney mel scale (as librosa), keep coefficients 1–19 and drop c0.
- Exact parity with the experiment is not needed; the classifier will be retrained on the logged values.
- `mfcc` is an optional `number[]` on `Frame`, rounded to 2 decimals in `roundFrames`; `isFrame` accepts frames without it.
- MFCCs go on every frame, including `quietFrames` and calibration `exhaleFrames`.
- Out of scope: training or running a classifier, any change to how reps are counted, adding MFCCs to old logs.
- Rep counting must not change: every existing fixture replays to the same count.
- Commits use Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Before you start

This worktree has no `node_modules`. Run `npm ci` once from the worktree root before any test. Run all commands from the worktree root.

## Notes on the maths (read before Task 1)

These are the choices the code and the reference values share. Change one and the reference values in the test no longer match.

- **Power spectrum:** what `FeatureExtractor` already has: a symmetric Hann window (`0.5 - 0.5·cos(2πi/(n-1))`), fft.js's unnormalised real FFT, `power[k] = re² + im²` for k = 0..n/2.
- **Mel scale (Slaney):** linear below 1 kHz at 200/3 Hz per mel, logarithmic above (`mel = 15 + ln(hz/1000) / (ln 6.4 / 27)`). This is librosa's default (`htk=False`).
- **Filters:** 42 edges evenly spaced in mel from `hzToMel(100)` to `hzToMel(4000)`; filter m is a triangle from edge m to edge m+2 peaking at m+1, scaled by `2 / (right - left)` so each has unit area (librosa's default `norm="slaney"`). The top edge is capped at Nyquist, which only matters below an 8 kHz sample rate.
- **Log:** `10·log10(max(energy, 1e-10))`, as librosa's `power_to_db` with `ref=1`, `amin=1e-10`. No `top_db` clipping: librosa clips per spectrogram, which means nothing for one frame.
- **DCT:** orthonormal DCT-II, `c_k = sqrt(2/40) · Σ_n x_n · cos(π·k·(2n+1)/80)` for k = 1..19. Row 0 is never computed.
- Because c0 is dropped, the overall scale of the power spectrum (window gain, FFT normalisation) only shifts every log-mel band by the same amount and cancels out of c1..c19. Silence gives every band the floor, so all 19 coefficients are 0.

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/mfcc.ts` (create) | 1 | Mel filter bank, DCT matrix and the power-spectrum-to-MFCC step |
| `src/features.ts` (modify) | 1 | `Frame.mfcc`; `FeatureExtractor` builds the filters once and adds `mfcc` to each frame |
| `test/mfcc-reference.py` (create) | 1 | Regenerates the librosa reference values the test checks against |
| `test/features.test.ts` (modify) | 1 | MFCCs match librosa on noise and a three-tone mix; silence; a 16 kHz rate |
| `src/recording.ts` (modify) | 2 | `roundFrames` rounds `mfcc` to 2 decimals and leaves it off frames without one |
| `src/store-schema.ts` (modify) | 2 | `isFrame` accepts an optional array of finite numbers as `mfcc` |
| `test/recording.test.ts` (modify) | 2 | Rounding and schema tests for frames with and without `mfcc` |
| `README.md` (modify) | 2 | Mentions the logged MFCCs in the frame list |

`src/features-worklet.ts`, `src/audio.ts`, `src/logs.ts` and `src/ui.ts` need no change: the worklet posts the whole frame object, and set and calibration logs already round every frame list through `roundFrames`.

---

### Task 1: Compute MFCCs in FeatureExtractor

**Files:**
- Create: `src/mfcc.ts`
- Create: `test/mfcc-reference.py`
- Modify: `src/features.ts` (the `Frame` interface at the top, and the `FeatureExtractor` class)
- Test: `test/features.test.ts`

**Interfaces:**
- Consumes: `BAND_LOW_HZ`, `BAND_HIGH_HZ`, `FeatureExtractor`, `Frame` from `src/features.ts`; `sine`, `whiteNoise` from `test/signals.ts`.
- Produces:
  - `src/mfcc.ts`: `export const MEL_BANDS = 40`, `export const MFCC_COUNT = 19`, `export function melFilterBank(bins: number, binHz: number, lowHz: number, highHz: number, bands?: number): Float64Array[]`, `export function dctMatrix(size: number, count: number): Float64Array[]`, `export function mfccFrom(power: ArrayLike<number>, filters: Float64Array[], dct: Float64Array[]): number[]`.
  - `src/features.ts`: `Frame` gains `mfcc?: number[]` (19 values when present). Every frame `FeatureExtractor.push` returns has it set.

- [ ] **Step 1: Add the reference script**

Create `test/mfcc-reference.py`. It ports the test's seeded noise generator so Python sees exactly the samples TypeScript does, and builds the power spectrum the same way `FeatureExtractor` does, then lets librosa do the mel, log and DCT steps.

```python
"""Reference MFCCs for test/features.test.ts, computed with librosa.

Builds each test signal's power spectrum the way FeatureExtractor does
(symmetric Hann window, unnormalised FFT, |X|^2), then lets librosa apply
the 40-band Slaney mel filter bank over 100 Hz-4 kHz, the dB conversion
and the orthonormal DCT-II, keeping coefficients 1-19.

Run: python3 test/mfcc-reference.py
Values in the test came from librosa 0.11.0 and numpy 2.4.4.
"""

import json

import librosa
import numpy as np

SR, N = 48000, 1024


def mulberry32(seed):
    """test/signals.ts's mulberry32, in 32-bit arithmetic."""
    a = seed & 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & 0xFFFFFFFF

    def next_value():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return next_value


def white_noise(seed, length):
    random = mulberry32(seed)
    return np.array([random() * 2 - 1 for _ in range(length)])


def sine(freq_hz, length, amplitude=0.5):
    return amplitude * np.sin(2 * np.pi * freq_hz * np.arange(length) / SR)


def mfcc(samples):
    window = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / (N - 1))
    power = np.abs(np.fft.rfft(samples * window)) ** 2
    mel = librosa.filters.mel(sr=SR, n_fft=N, n_mels=40, fmin=100, fmax=4000)
    db = librosa.power_to_db(mel @ power, ref=1.0, amin=1e-10, top_db=None)
    coefficients = librosa.feature.mfcc(S=db[:, None], n_mfcc=20, dct_type=2, norm="ortho")
    return [round(float(c), 4) for c in coefficients[1:, 0]]


print("whiteNoise(1, 1024):", json.dumps(mfcc(white_noise(1, N))))
tones = sine(300, N, 0.3) + sine(1500, N, 0.2) + sine(3200, N, 0.1)
print("300 + 1500 + 3200 Hz:", json.dumps(mfcc(tones)))
```

Run it: `python3 test/mfcc-reference.py`

Expected output (these are the values the test uses):

```
whiteNoise(1, 1024): [-1.236, -0.6384, -2.2306, -0.4316, -5.3139, -1.0252, -9.7165, -4.7557, 3.1732, 0.1804, -4.7393, -4.6294, -8.2369, 0.0573, 1.9681, -5.588, -0.393, 2.4455, -7.8833]
300 + 1500 + 3200 Hz: [76.9347, 84.256, 28.2012, 83.0701, -61.0399, -11.1096, 65.9761, -72.8534, -13.0914, -6.1078, 17.3407, -73.0218, 21.3487, -3.2099, -12.6955, -22.9709, 22.0718, -0.6629, -22.239]
```

- [ ] **Step 2: Write the failing tests**

In `test/features.test.ts`, add the two reference lists and a helper after `oneFrame`:

```ts
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
```

Then add this `describe` block at the end of the file:

```ts
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
```

(`toBeCloseTo(0, 9)` rather than `toEqual(0)` because the DCT can give `-0` or a value like `1e-15`.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/features.test.ts`
Expected: the four new tests FAIL, each on `toHaveLength` because `mfcc` is undefined; the existing tests pass.

- [ ] **Step 4: Create `src/mfcc.ts`**

```ts
// MFCCs from a frame's power spectrum, laid out as librosa does by default:
// a Slaney mel scale, unit-area triangular filters, dB, then an orthonormal
// DCT-II.

export const MEL_BANDS = 40;
/** Coefficients 1..19; c0, the overall level, is left out. */
export const MFCC_COUNT = 19;

const MEL_ENERGY_FLOOR = 1e-10;

// Slaney's mel scale: linear below 1 kHz, logarithmic above.
const HZ_PER_MEL = 200 / 3;
const LOG_HZ = 1000;
const LOG_MEL = LOG_HZ / HZ_PER_MEL;
const LOG_STEP = Math.log(6.4) / 27;

function hzToMel(hz: number): number {
  return hz < LOG_HZ ? hz / HZ_PER_MEL : LOG_MEL + Math.log(hz / LOG_HZ) / LOG_STEP;
}

function melToHz(mel: number): number {
  return mel < LOG_MEL ? mel * HZ_PER_MEL : LOG_HZ * Math.exp(LOG_STEP * (mel - LOG_MEL));
}

/**
 * Triangular filters spaced evenly in mel over lowHz..highHz, each scaled
 * to unit area. `filters[m][k]` is band m's weight on FFT bin k.
 */
export function melFilterBank(
  bins: number,
  binHz: number,
  lowHz: number,
  highHz: number,
  bands = MEL_BANDS,
): Float64Array[] {
  const lowMel = hzToMel(lowHz);
  const stepMel = (hzToMel(highHz) - lowMel) / (bands + 1);
  const edges = Array.from({ length: bands + 2 }, (_, i) => melToHz(lowMel + i * stepMel));
  return Array.from({ length: bands }, (_, m) => {
    const [left, centre, right] = [edges[m], edges[m + 1], edges[m + 2]];
    const scale = 2 / (right - left);
    return Float64Array.from({ length: bins }, (_, k) => {
      const hz = k * binHz;
      return scale * Math.max(0, Math.min((hz - left) / (centre - left), (right - hz) / (right - centre)));
    });
  });
}

/** Rows 1..count of the orthonormal DCT-II of a `size`-point signal. */
export function dctMatrix(size: number, count: number): Float64Array[] {
  const scale = Math.sqrt(2 / size);
  return Array.from({ length: count }, (_, row) =>
    Float64Array.from({ length: size }, (_, n) => scale * Math.cos((Math.PI * (row + 1) * (2 * n + 1)) / (2 * size))),
  );
}

export function mfccFrom(power: ArrayLike<number>, filters: Float64Array[], dct: Float64Array[]): number[] {
  const logMel = filters.map((filter) => {
    let energy = 0;
    for (let k = 0; k < filter.length; k++) energy += filter[k] * power[k];
    return 10 * Math.log10(Math.max(energy, MEL_ENERGY_FLOOR));
  });
  return dct.map((row) => {
    let sum = 0;
    for (let n = 0; n < row.length; n++) sum += row[n] * logMel[n];
    return sum;
  });
}
```

- [ ] **Step 5: Wire it into `src/features.ts`**

Add the import below the `fft.js` import:

```ts
import { dctMatrix, MEL_BANDS, MFCC_COUNT, melFilterBank, mfccFrom } from "./mfcc";
```

Add the field to the end of the `Frame` interface:

```ts
  /** MFCCs 1..19 over BAND_LOW_HZ..BAND_HIGH_HZ; logged for a future classifier, not used to count. Older logs lack it. */
  mfcc?: number[];
```

In `FeatureExtractor`, add two fields after `private readonly power: Float64Array;`:

```ts
  private readonly melFilters: Float64Array[];
  private readonly dct: Float64Array[];
```

and at the end of the constructor, after `this.power = new Float64Array(n / 2 + 1);`:

```ts
    this.melFilters = melFilterBank(n / 2 + 1, sampleRate / n, BAND_LOW_HZ, Math.min(BAND_HIGH_HZ, sampleRate / 2));
    this.dct = dctMatrix(MEL_BANDS, MFCC_COUNT);
```

Replace the `return` line at the end of `analyze()` with:

```ts
    return {
      t: (this.samplesSeen / this.sampleRate) * 1000,
      db: rmsDb(this.buffer),
      flatness,
      highRatio,
      mfcc: mfccFrom(this.power, this.melFilters, this.dct),
    };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/features.test.ts`
Expected: PASS, all tests, including the four new ones.

- [ ] **Step 7: Run the whole suite and the type check**

Run: `npm test && npm run typecheck`
Expected: both pass. `test/fixtures.test.ts` must still pass unchanged: fixtures without `mfcc` replay to the same counts because the detector never reads it.

- [ ] **Step 8: Commit**

```bash
git add src/mfcc.ts src/features.ts test/features.test.ts test/mfcc-reference.py
git commit -m "feat(features): compute 19 MFCCs for every frame

Each frame now carries MFCCs 1-19 from a 40-band Slaney mel filter
bank over 100 Hz-4 kHz, built from the power spectrum the extractor
already has. They are for training a rep-vs-noise classifier on live
mic data and are not used to count. The test checks them against
librosa on the same spectrum.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Keep the MFCCs in logs and fixtures

**Files:**
- Modify: `src/recording.ts` (`roundFrames`)
- Modify: `src/store-schema.ts` (`isFrame`)
- Modify: `README.md` (the frame list at the top)
- Test: `test/recording.test.ts`

**Interfaces:**
- Consumes: `Frame` with `mfcc?: number[]` from Task 1 (`src/features.ts`); `buildRecording`, `roundFrames` from `src/recording.ts`; `isSetRecording` from `src/store-schema.ts`.
- Produces: `roundFrames(frames: Frame[]): Frame[]` keeps `mfcc` rounded to 2 decimals and adds no `mfcc` key to frames without one. `isSetRecording`, `isSetLog` and `isCalibrationLog` accept frames with or without `mfcc`, and reject an `mfcc` that is not an array of finite numbers.

- [ ] **Step 1: Write the failing tests**

In `test/recording.test.ts`, add `roundFrames` to the import from `../src/recording`:

```ts
import { buildRecording, replayCount, roundFrames } from "../src/recording";
```

Add these blocks after the `buildRecording` describe block:

```ts
describe("roundFrames", () => {
  it("rounds each MFCC to 2 decimals", () => {
    const [frame] = roundFrames([
      { t: 21.33333, db: -61.23456, flatness: 0.512345, highRatio: 0.654321, mfcc: [12.3456, -0.006, -7.891] },
    ]);
    expect(frame).toEqual({ t: 21.3, db: -61.23, flatness: 0.5123, highRatio: 0.6543, mfcc: [12.35, -0.01, -7.89] });
  });

  it("adds no mfcc to a frame that has none", () => {
    const [frame] = roundFrames([{ t: 21.3, db: -60, flatness: 0.5, highRatio: 0.6 }]);
    expect(frame).not.toHaveProperty("mfcc");
  });
});

describe("isSetRecording frames", () => {
  const withFrame = (frame: unknown) => ({
    ...buildRecording({ mic: "Headset", thresholds: TH, frames: [], detectedCount: 0, actualCount: 0 }),
    frames: [frame],
  });
  const base = { t: 21.3, db: -60, flatness: 0.5, highRatio: 0.6 };

  it("accepts frames with or without MFCCs", () => {
    expect(isSetRecording(withFrame(base))).toBe(true);
    expect(isSetRecording(withFrame({ ...base, mfcc: [1.5, -2.25, 0] }))).toBe(true);
  });

  it("rejects an mfcc that is not a list of numbers", () => {
    expect(isSetRecording(withFrame({ ...base, mfcc: "1.5" }))).toBe(false);
    expect(isSetRecording(withFrame({ ...base, mfcc: [1.5, "2"] }))).toBe(false);
    expect(isSetRecording(withFrame({ ...base, mfcc: [1.5, null] }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/recording.test.ts`
Expected: FAIL: "rounds each MFCC to 2 decimals" (the rounded frame has no `mfcc`) and "rejects an mfcc that is not a list of numbers" (the schema ignores the field). The others pass already.

- [ ] **Step 3: Round `mfcc` in `roundFrames`**

In `src/recording.ts`, replace the body of `roundFrames` with:

```ts
  return frames.map((f) => ({
    t: round(f.t, 1),
    db: round(f.db, 2),
    flatness: round(f.flatness, 4),
    highRatio: round(f.highRatio, 4),
    ...(f.mfcc && { mfcc: f.mfcc.map((c) => round(c, 2)) }),
  }));
```

- [ ] **Step 4: Accept an optional `mfcc` in `isFrame`**

In `src/store-schema.ts`, replace `isFrame` with:

```ts
function isFrame(x: unknown): x is Frame {
  // mfcc was added later, so frames saved before it lack it.
  return (
    isRecord(x) &&
    isNumber(x.t) &&
    isNumber(x.db) &&
    isNumber(x.flatness) &&
    isNumber(x.highRatio) &&
    (x.mfcc === undefined || (Array.isArray(x.mfcc) && x.mfcc.every(isNumber)))
  );
}
```

Leave the length unchecked so a later change to the coefficient count does not invalidate saved logs.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/recording.test.ts`
Expected: PASS.

- [ ] **Step 6: Describe the field in the README**

In `README.md`, replace the opening paragraph and list (from "The app listens to the microphone" through the `highRatio` bullet) with:

```markdown
The app listens to the microphone and counts each exhale as a rep. Audio is
split into frames about 20 ms apart. Each frame gives three numbers, measured
over 100 Hz to 4 kHz, since a Bluetooth headset sends nothing higher:

- **level** (`db`): how loud the frame is
- **flatness**: how noise-like the sound is, rather than a clear tone; breath
  is noisy, a grunt or hum is tonal
- **high ratio** (`highRatio`): the share of the sound's energy above 1 kHz;
  breath is hissy, a thud is low

Each frame also carries 19 MFCCs (`mfcc`) over the same band: the shape of
its spectrum on 40 mel bands, without the overall level. They don't affect
the count. They are logged to train and check a classifier that tells reps
from other sounds; see `docs/ideas/compare-sounds-to-reps.md`. Logs and
fixtures from before 22 October 2026 don't have them.
```

- [ ] **Step 7: Run the whole suite and the type check**

Run: `npm test && npm run typecheck`
Expected: both pass, with every fixture in `test/fixtures` and `data-routine/fixtures` replaying to the same result as before.

- [ ] **Step 8: Check every saved log still passes the schema**

Nothing in the tests loads the logs under `data/logs` and `data-routine/logs`, and `npm run report` reads them without validating. Check them once by hand (not committed):

```bash
npx tsx -e '
import { readdirSync, readFileSync } from "node:fs";
import { isCalibrationLog, isSetLog } from "./src/store-schema.ts";
let bad = 0, total = 0;
for (const root of ["data/logs", "data-routine/logs"]) {
  for (const [kind, check] of [["sets", isSetLog], ["calibrations", isCalibrationLog]] as const) {
    for (const name of readdirSync(`${root}/${kind}`).filter((n) => n.endsWith(".json"))) {
      total++;
      if (!check(JSON.parse(readFileSync(`${root}/${kind}/${name}`, "utf8")))) { bad++; console.log("invalid:", root, kind, name); }
    }
  }
}
console.log(`${total - bad}/${total} logs valid`);'
```

Expected: `N/N logs valid`. If any log is listed as invalid, run the same command on `main` (in `/home/paul/Projects/rep-counter`): a log that was already invalid there is not this task's problem, but one that newly fails is.

- [ ] **Step 9: Commit**

```bash
git add src/recording.ts src/store-schema.ts test/recording.test.ts README.md
git commit -m "feat(logs): save each frame's MFCCs in logs and fixtures

Set logs, calibration logs and fixtures keep the MFCCs rounded to 2
decimals, which makes them about three times bigger. Frames without
MFCCs still load, so older logs and fixtures replay as before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Check it in the app (with the user)

This needs a microphone and a person exhaling, so the implementer cannot do it alone. Prepare the commands, then ask the user to do the in-app part and report back. Commit nothing new in this task unless the user wants the resulting logs tracked: that is their call, as the repo's `chore: log the … sets` commits show.

**Files:** none changed.

- [ ] **Step 1: Ask the user to log a calibration and a set, and save one as a fixture**

Ask the user to run `npm run dev`, open `http://localhost:5173`, calibrate, do a short set, enter the actual count, and press **Save set data**.

- [ ] **Step 2: Check the newest logs and fixture carry 19 MFCCs on every frame**

Run:

```bash
node -e '
const fs = require("fs");
const newest = (dir) => dir + "/" + fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().at(-1);
for (const [file, keys] of [
  [newest("data/logs/sets"), ["quietFrames", "frames"]],
  [newest("data/logs/calibrations"), ["quietFrames", "exhaleFrames"]],
  [newest("test/fixtures"), ["frames"]],
]) {
  const log = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of keys) {
    const frames = log[key];
    const ok = frames.filter((f) => Array.isArray(f.mfcc) && f.mfcc.length === 19).length;
    console.log(file, key, ok + "/" + frames.length, "frames with 19 MFCCs");
  }
}'
```

Expected: every line reads `N/N frames with 19 MFCCs` with N > 0.

- [ ] **Step 3: Check the new files pass the schema and replay**

Rerun Task 2's Step 8 command (it now includes the new set and calibration logs), then `npm test`, which replays the new fixture.
Expected: every log valid and the tests pass. If the new fixture's set was miscounted by the detector, `test/fixtures.test.ts` fails on it as on any miscounted fixture: tell the user rather than adding it to the expected failures yourself.

- [ ] **Step 4: Report to the user**

Tell the user the file sizes of the new set log and fixture next to an older one (`ls -l`), so they can see the roughly threefold growth the task predicted.
