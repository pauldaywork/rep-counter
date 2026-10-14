# Rep Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Chrome website that counts exercise reps by detecting one loud exhale per rep through a Bluetooth headset microphone.

**Architecture:** An AudioWorklet turns mic audio into ~21 ms feature frames (level, spectral flatness, high-frequency ratio). A pure hysteresis detector, with thresholds from a per-mic calibration, turns frames into rep or rejection events. A Vite dev-server plugin saves calibrations and set recordings as JSON files in the project.

**Tech Stack:** TypeScript 7.0.2, Vite 8.3.4, Vitest 5.0.4, fft.js 4.0.4, @types/node 26.6.5. Node 24. No UI framework.

**Spec:** `docs/superpowers/specs/2026-10-14-rep-counter-design.md`

## Global Constraints

- Chrome only. No fallbacks, polyfills or testing for other browsers; Chrome behaviour may be relied on.
- Runs only under the Vite dev server at `http://localhost:5173`, with `strictPort: true`.
- Detection relies only on audio from 100 Hz to 4 kHz (`BAND_LOW_HZ`/`BAND_HIGH_HZ`).
- `getUserMedia` constraints: `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`.
- Calibrations persist only in `data/calibration.json`, keyed by mic **label**. Never use `localStorage`, `sessionStorage` or IndexedDB.
- No audio plays during a set. The only sound is the completion chime.
- Detector timing: `minDurationMs` 150, `maxDurationMs` 1500, `minGapMs` 600.
- Calibration: 3 s quiet, then 3 exhales; `onOffsetDb = 0.5 × span`, `offOffsetDb = 0.3 × span`, `minFlatness`/`minHighRatio` = 0.7 × the lowest exhale mean.
- Per-set quiet check: 2 s; the re-based noise floor is not saved.
- TypeScript `strict`. Pin exact dependency versions.
- Commits use Conventional Commits (`feat(scope): …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Task | Responsibility |
|---|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts` | 1, 4 | Tooling and dev server config |
| `src/features.ts` | 1 | `Frame` type, feature maths, `FeatureExtractor` framing |
| `test/signals.ts` | 1 | Seeded test signal generators |
| `src/detector.ts` | 2 | Hysteresis rep detector |
| `test/frames.ts` | 2 | Synthetic `Frame` sequence builder for tests |
| `src/calibration.ts` | 3 | Noise floor, exhale segmentation, threshold derivation |
| `src/store-schema.ts` | 4 | Persisted JSON types and validators |
| `vite-plugin-store.ts` | 4 | `/api/calibration`, `/api/fixtures` file endpoints |
| `src/store.ts` | 4 | Browser client for the endpoints |
| `src/recording.ts` | 5 | Build set recordings, replay them through the detector |
| `test/fixtures.test.ts` | 5 | Regression test over saved real sets |
| `src/features-worklet.ts` | 6 | AudioWorklet processor posting frames |
| `src/audio.ts` | 6 | Mic permission, listing, capture session |
| `src/rep-set.ts`, `src/mic-choice.ts` | 7 | Set count state, dropdown selection rule |
| `index.html`, `src/style.css`, `src/meter.ts`, `src/chime.ts`, `src/ui.ts`, `src/main.ts` | 8 | The page |

---

### Task 1: Scaffold the project and the feature maths

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`
- Create: `src/features.ts`
- Create: `test/signals.ts`
- Test: `test/features.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Frame { t: number; db: number; flatness: number; highRatio: number }` (`t` is ms since the mic session started, at the end of the frame)
  - `BAND_LOW_HZ = 100`, `BAND_HIGH_HZ = 4000`, `HIGH_SPLIT_HZ = 1000`
  - `frameSizeFor(sampleRate: number): number`
  - `rmsDb(samples: ArrayLike<number>): number`
  - `spectralFeatures(power: ArrayLike<number>, binHz: number): { flatness: number; highRatio: number }`
  - `class FeatureExtractor { constructor(sampleRate: number); readonly frameSize: number; push(block: ArrayLike<number>): Frame[] }`
  - Test helpers: `mulberry32(seed)`, `sine(freqHz, sampleRate, length, amplitude?)`, `whiteNoise(seed, length, amplitude?)`

- [ ] **Step 1: Create the tooling files**

`package.json`:

```json
{
  "name": "rep-counter",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fft.js": "4.0.4"
  },
  "devDependencies": {
    "@types/node": "26.6.5",
    "typescript": "7.0.2",
    "vite": "8.3.4",
    "vitest": "5.0.4"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["vite/client", "node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "test", "vite.config.ts", "vite-plugin-store.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5173, strictPort: true },
  // fft.js is CommonJS and only imported from the AudioWorklet, which
  // Vite's dependency scan does not see. Pre-bundle it up front so the
  // first mic start does not trigger a re-optimise and page reload.
  optimizeDeps: { include: ["fft.js"] },
  // AudioWorklet.addModule loads module scripts, so bundle workers as ES modules.
  worker: { format: "es" },
  test: { include: ["test/**/*.test.ts"] },
});
```

Run: `npm install`
Expected: installs without errors and creates `package-lock.json`.

- [ ] **Step 2: Write the test signal helpers**

`test/signals.ts`:

```ts
/** Small seeded PRNG so noise-based tests are deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sine(freqHz: number, sampleRate: number, length: number, amplitude = 0.5): Float64Array {
  return Float64Array.from({ length }, (_, i) => amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
}

export function whiteNoise(seed: number, length: number, amplitude = 1): Float64Array {
  const random = mulberry32(seed);
  return Float64Array.from({ length }, () => amplitude * (random() * 2 - 1));
}
```

- [ ] **Step 3: Write the failing tests**

`test/features.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run test/features.test.ts`
Expected: FAIL, because `../src/features` does not exist.

- [ ] **Step 5: Implement `src/features.ts`**

```ts
import FFT from "fft.js";

/** Features of one ~21 ms slice of mic audio. */
export interface Frame {
  /** ms since the mic session started, at the end of this frame */
  t: number;
  /** RMS level in dBFS */
  db: number;
  /** spectral flatness over BAND_LOW_HZ..BAND_HIGH_HZ, 0..1 (1 = white noise) */
  flatness: number;
  /** share of in-band energy at or above HIGH_SPLIT_HZ, 0..1 */
  highRatio: number;
}

// A narrowband Bluetooth headset (8 kHz sampling) delivers nothing above
// 4 kHz, so features only look at this band.
export const BAND_LOW_HZ = 100;
export const BAND_HIGH_HZ = 4000;
export const HIGH_SPLIT_HZ = 1000;

const POWER_EPSILON = 1e-12;

/** Power-of-two frame size closest to 1024 samples at 48 kHz (~21 ms). */
export function frameSizeFor(sampleRate: number): number {
  return 2 ** Math.round(Math.log2((sampleRate * 1024) / 48000));
}

export function rmsDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return 20 * Math.log10(Math.max(rms, 1e-10));
}

/** `power[k]` is the power of FFT bin k, and bins are `binHz` apart. */
export function spectralFeatures(
  power: ArrayLike<number>,
  binHz: number,
): { flatness: number; highRatio: number } {
  const lo = Math.max(1, Math.ceil(BAND_LOW_HZ / binHz));
  const hi = Math.min(power.length - 1, Math.floor(BAND_HIGH_HZ / binHz));
  let logSum = 0;
  let sum = 0;
  let highSum = 0;
  for (let k = lo; k <= hi; k++) {
    const p = power[k] + POWER_EPSILON;
    logSum += Math.log(p);
    sum += p;
    if (k * binHz >= HIGH_SPLIT_HZ) highSum += p;
  }
  const count = hi - lo + 1;
  return { flatness: Math.exp(logSum / count) / (sum / count), highRatio: highSum / sum };
}

/** Buffers audio blocks into non-overlapping frames and analyses each one. */
export class FeatureExtractor {
  readonly frameSize: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly buffer: Float64Array;
  private readonly windowed: number[];
  private readonly spectrum: number[];
  private readonly power: Float64Array;
  private filled = 0;
  private samplesSeen = 0;

  constructor(private readonly sampleRate: number) {
    const n = frameSizeFor(sampleRate);
    this.frameSize = n;
    this.fft = new FFT(n);
    this.window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    this.buffer = new Float64Array(n);
    this.windowed = new Array<number>(n).fill(0);
    this.spectrum = this.fft.createComplexArray();
    this.power = new Float64Array(n / 2 + 1);
  }

  push(block: ArrayLike<number>): Frame[] {
    const frames: Frame[] = [];
    for (let i = 0; i < block.length; i++) {
      this.buffer[this.filled++] = block[i];
      this.samplesSeen++;
      if (this.filled === this.frameSize) {
        frames.push(this.analyze());
        this.filled = 0;
      }
    }
    return frames;
  }

  private analyze(): Frame {
    const n = this.frameSize;
    for (let i = 0; i < n; i++) this.windowed[i] = this.buffer[i] * this.window[i];
    this.fft.realTransform(this.spectrum, this.windowed);
    for (let k = 0; k <= n / 2; k++) {
      const re = this.spectrum[2 * k];
      const im = this.spectrum[2 * k + 1];
      this.power[k] = re * re + im * im;
    }
    const { flatness, highRatio } = spectralFeatures(this.power, this.sampleRate / n);
    return { t: (this.samplesSeen / this.sampleRate) * 1000, db: rmsDb(this.buffer), flatness, highRatio };
  }
}
```

`fft.js` ships its own typings as `export = FFT`. TypeScript 7 always enables `esModuleInterop`, so the default import works.

- [ ] **Step 6: Run the tests and the type check**

Run: `npx vitest run test/features.test.ts && npm run typecheck`
Expected: all 7 tests PASS; `tsc` reports no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts src/features.ts test/signals.ts test/features.test.ts
git commit -m "feat(audio): add frame feature extraction

Compute level, spectral flatness and high-frequency share for ~21 ms
frames over the 100 Hz - 4 kHz band a Bluetooth headset delivers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rep detector

**Files:**
- Create: `src/detector.ts`
- Create: `test/frames.ts`
- Test: `test/detector.test.ts`

**Interfaces:**
- Consumes: `Frame` from `src/features.ts`.
- Produces:
  - `interface Thresholds { onDb: number; offDb: number; minFlatness: number; minHighRatio: number }`
  - `interface DetectorTiming { minDurationMs: number; maxDurationMs: number; minGapMs: number }`
  - `DEFAULT_TIMING: DetectorTiming` = `{ minDurationMs: 150, maxDurationMs: 1500, minGapMs: 600 }`
  - `type DetectorEvent = { kind: "rep"; t: number; durationMs: number } | { kind: "rejected"; t: number; reason: string }`
  - `class Detector { constructor(thresholds: Thresholds, timing?: DetectorTiming); push(frame: Frame): DetectorEvent | null }`
  - Test helpers in `test/frames.ts`: `FRAME_MS = 20`, `interface Segment { ms: number; db: number; flatness?: number; highRatio?: number }`, `quiet(ms)`, `exhale(ms?, db?)`, `frames(...segments): Frame[]`

- [ ] **Step 1: Write the frame builder helper**

`test/frames.ts`:

```ts
import type { Frame } from "../src/features";

export const FRAME_MS = 20;

export interface Segment {
  ms: number;
  db: number;
  flatness?: number;
  highRatio?: number;
}

export const quiet = (ms: number): Segment => ({ ms, db: -70 });
export const exhale = (ms = 400, db = -25): Segment => ({ ms, db });

/** Builds a frame sequence, FRAME_MS apart, with the first frame at t = FRAME_MS. */
export function frames(...segments: Segment[]): Frame[] {
  const out: Frame[] = [];
  let t = 0;
  for (const s of segments) {
    for (let i = 0; i < Math.round(s.ms / FRAME_MS); i++) {
      t += FRAME_MS;
      out.push({ t, db: s.db, flatness: s.flatness ?? 0.5, highRatio: s.highRatio ?? 0.6 });
    }
  }
  return out;
}
```

- [ ] **Step 2: Write the failing tests**

`test/detector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Detector, type DetectorEvent, type Thresholds } from "../src/detector";
import type { Frame } from "../src/features";
import { exhale, frames, quiet } from "./frames";

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
    const events = run(frames(quiet(500), exhale(2000), quiet(800), exhale(), quiet(500)));
    expect(events.map((e) => e.kind)).toEqual(["rejected", "rep"]);
    expect(events[0]).toMatchObject({ reason: expect.stringMatching(/^too long/) });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/detector.test.ts`
Expected: FAIL, because `../src/detector` does not exist.

- [ ] **Step 4: Implement `src/detector.ts`**

```ts
import type { Frame } from "./features";

export interface Thresholds {
  /** the gate opens at or above this level */
  onDb: number;
  /** the gate closes below this level */
  offDb: number;
  minFlatness: number;
  minHighRatio: number;
}

export interface DetectorTiming {
  minDurationMs: number;
  maxDurationMs: number;
  /** from the end of the last rep to the start of the next sound */
  minGapMs: number;
}

export const DEFAULT_TIMING: DetectorTiming = { minDurationMs: 150, maxDurationMs: 1500, minGapMs: 600 };

export type DetectorEvent =
  | { kind: "rep"; t: number; durationMs: number }
  | { kind: "rejected"; t: number; reason: string };

/**
 * Hysteresis gate over frame levels. A sound opens the gate at onDb and
 * closes it below offDb; it is then classified as a rep or rejected.
 */
export class Detector {
  private state: "idle" | "active" | "overlong" = "idle";
  private startT = 0;
  private frameCount = 0;
  private flatnessSum = 0;
  private highRatioSum = 0;
  private lastRepT = -Infinity;

  constructor(
    private readonly thresholds: Thresholds,
    private readonly timing: DetectorTiming = DEFAULT_TIMING,
  ) {}

  push(frame: Frame): DetectorEvent | null {
    const { onDb, offDb } = this.thresholds;
    switch (this.state) {
      case "idle":
        if (frame.db >= onDb) {
          this.state = "active";
          this.startT = frame.t;
          this.frameCount = 0;
          this.flatnessSum = 0;
          this.highRatioSum = 0;
          this.accumulate(frame);
        }
        return null;
      case "active":
        if (frame.db < offDb) {
          this.state = "idle";
          return this.classify(frame.t);
        }
        this.accumulate(frame);
        if (frame.t - this.startT > this.timing.maxDurationMs) {
          this.state = "overlong";
          return { kind: "rejected", t: frame.t, reason: `too long (over ${this.timing.maxDurationMs} ms)` };
        }
        return null;
      case "overlong":
        if (frame.db < offDb) this.state = "idle";
        return null;
    }
  }

  private accumulate(frame: Frame): void {
    this.frameCount++;
    this.flatnessSum += frame.flatness;
    this.highRatioSum += frame.highRatio;
  }

  private classify(endT: number): DetectorEvent {
    const durationMs = endT - this.startT;
    const flatness = this.flatnessSum / this.frameCount;
    const highRatio = this.highRatioSum / this.frameCount;
    const { minFlatness, minHighRatio } = this.thresholds;
    const { minDurationMs, minGapMs } = this.timing;
    const reject = (reason: string): DetectorEvent => ({ kind: "rejected", t: endT, reason });

    if (durationMs < minDurationMs) return reject(`too short (${Math.round(durationMs)} ms)`);
    if (flatness < minFlatness) return reject(`tonal (flatness ${flatness.toFixed(2)} < ${minFlatness.toFixed(2)})`);
    if (highRatio < minHighRatio) {
      return reject(`low-frequency (high ratio ${highRatio.toFixed(2)} < ${minHighRatio.toFixed(2)})`);
    }
    const gap = this.startT - this.lastRepT;
    if (gap < minGapMs) return reject(`too soon (${Math.round(gap)} ms after the last rep)`);

    this.lastRepT = endT;
    return { kind: "rep", t: endT, durationMs };
  }
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run test/detector.test.ts && npm run typecheck`
Expected: all 9 tests PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/detector.ts test/frames.ts test/detector.test.ts
git commit -m "feat(detector): count exhales with a hysteresis gate

Reject sounds that are too short, tonal, low-frequency, too long or
too soon after the last rep, and report the reason for each.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Calibration maths

**Files:**
- Create: `src/calibration.ts`
- Test: `test/calibration.test.ts`

**Interfaces:**
- Consumes: `Frame` (Task 1); `Thresholds`, `DEFAULT_TIMING` (Task 2); `frames`, `quiet` helpers (Task 2).
- Produces:
  - `interface Calibration { calibratedAt: string; noiseFloorDb: number; onOffsetDb: number; offOffsetDb: number; minFlatness: number; minHighRatio: number }`
  - `interface ExhaleSegment { startT: number; endT: number; peakDb: number; meanFlatness: number; meanHighRatio: number }`
  - `type CalibrationResult = { ok: true; calibration: Calibration } | { ok: false; reason: string }`
  - `REQUIRED_EXHALES = 3`
  - `noiseFloor(frames: Frame[]): number`
  - `segmentExhales(frames: Frame[], noiseFloorDb: number): ExhaleSegment[]`
  - `exhalesComplete(frames: Frame[], noiseFloorDb: number, settleMs?: number): boolean`
  - `deriveCalibration(quiet: Frame[], exhales: Frame[], now?: Date): CalibrationResult`
  - `thresholdsFor(calibration: Calibration, noiseFloorDb?: number): Thresholds`

- [ ] **Step 1: Write the failing tests**

`test/calibration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  deriveCalibration,
  exhalesComplete,
  noiseFloor,
  segmentExhales,
  thresholdsFor,
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

function dbFrames(...dbs: number[]): Frame[] {
  return dbs.map((db, i) => ({ t: (i + 1) * 20, db, flatness: 0.5, highRatio: 0.5 }));
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/calibration.test.ts`
Expected: FAIL, because `../src/calibration` does not exist.

- [ ] **Step 3: Implement `src/calibration.ts`**

```ts
import { DEFAULT_TIMING, type Thresholds } from "./detector";
import type { Frame } from "./features";

/** One mic's calibration, as saved in data/calibration.json. */
export interface Calibration {
  calibratedAt: string;
  noiseFloorDb: number;
  /** thresholds are stored relative to the noise floor so they can be re-based */
  onOffsetDb: number;
  offOffsetDb: number;
  minFlatness: number;
  minHighRatio: number;
}

export interface ExhaleSegment {
  startT: number;
  endT: number;
  peakDb: number;
  meanFlatness: number;
  meanHighRatio: number;
}

export type CalibrationResult = { ok: true; calibration: Calibration } | { ok: false; reason: string };

export const REQUIRED_EXHALES = 3;
const SEGMENT_OPEN_DB = 10;
const SEGMENT_CLOSE_DB = 6;

export function noiseFloor(frames: Frame[]): number {
  if (frames.length === 0) throw new Error("No audio was captured to measure the background noise.");
  const sorted = frames.map((f) => f.db).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Splits calibration audio into sounds with a provisional gate that opens
 * 10 dB above the noise floor. A sound still going at the end is dropped.
 */
export function segmentExhales(frames: Frame[], noiseFloorDb: number): ExhaleSegment[] {
  const openDb = noiseFloorDb + SEGMENT_OPEN_DB;
  const closeDb = noiseFloorDb + SEGMENT_CLOSE_DB;
  const segments: ExhaleSegment[] = [];
  let current: Frame[] = [];

  for (const frame of frames) {
    if (current.length === 0) {
      if (frame.db >= openDb) current.push(frame);
    } else if (frame.db >= closeDb) {
      current.push(frame);
    } else {
      const startT = current[0].t;
      if (frame.t - startT >= DEFAULT_TIMING.minDurationMs) {
        segments.push({
          startT,
          endT: frame.t,
          peakDb: Math.max(...current.map((f) => f.db)),
          meanFlatness: mean(current.map((f) => f.flatness)),
          meanHighRatio: mean(current.map((f) => f.highRatio)),
        });
      }
      current = [];
    }
  }
  return segments;
}

/** True once three exhales were heard and the last ended at least settleMs ago. */
export function exhalesComplete(frames: Frame[], noiseFloorDb: number, settleMs = 600): boolean {
  const segments = segmentExhales(frames, noiseFloorDb);
  if (segments.length < REQUIRED_EXHALES) return false;
  return frames[frames.length - 1].t - segments[segments.length - 1].endT >= settleMs;
}

export function deriveCalibration(quiet: Frame[], exhales: Frame[], now: Date = new Date()): CalibrationResult {
  const noiseFloorDb = noiseFloor(quiet);
  const found = segmentExhales(exhales, noiseFloorDb);
  if (found.length < REQUIRED_EXHALES) {
    return {
      ok: false,
      reason: `Heard ${found.length} of ${REQUIRED_EXHALES} breaths. Breathe out harder, one breath at a time.`,
    };
  }
  const loudest = [...found].sort((a, b) => b.peakDb - a.peakDb).slice(0, REQUIRED_EXHALES);
  // Every segment peaks at least 10 dB above the floor, so span >= 10 dB.
  const span = Math.min(...loudest.map((s) => s.peakDb)) - noiseFloorDb;
  return {
    ok: true,
    calibration: {
      calibratedAt: now.toISOString(),
      noiseFloorDb,
      onOffsetDb: 0.5 * span,
      offOffsetDb: 0.3 * span,
      minFlatness: 0.7 * Math.min(...loudest.map((s) => s.meanFlatness)),
      minHighRatio: 0.7 * Math.min(...loudest.map((s) => s.meanHighRatio)),
    },
  };
}

export function thresholdsFor(calibration: Calibration, noiseFloorDb = calibration.noiseFloorDb): Thresholds {
  return {
    onDb: noiseFloorDb + calibration.onOffsetDb,
    offDb: noiseFloorDb + calibration.offOffsetDb,
    minFlatness: calibration.minFlatness,
    minHighRatio: calibration.minHighRatio,
  };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run test/calibration.test.ts && npm run typecheck`
Expected: all 10 tests PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/calibration.ts test/calibration.test.ts
git commit -m "feat(calibration): derive thresholds from three exhales

Measure the noise floor, segment the exhales, and store thresholds as
offsets from the floor so each set can re-base them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: File-backed store

**Files:**
- Create: `src/store-schema.ts`
- Create: `vite-plugin-store.ts`
- Create: `src/store.ts`
- Modify: `vite.config.ts` (register the plugin)
- Modify: `.gitignore` (ignore `*.tmp`)
- Test: `test/store-plugin.test.ts`

**Interfaces:**
- Consumes: `Calibration` (Task 3), `Thresholds`, `DetectorTiming` (Task 2), `Frame` (Task 1).
- Produces:
  - `interface StoreFile { lastMic?: string; mics: Record<string, Calibration> }`
  - `interface SetRecording { recordedAt: string; mic: string; thresholds: Thresholds; timing: DetectorTiming; frames: Frame[]; detectedCount: number; actualCount: number }`
  - `isCalibration(x: unknown): x is Calibration`, `isStoreFile(x: unknown): x is StoreFile`, `isSetRecording(x: unknown): x is SetRecording`
  - `storePlugin(): Plugin`, `createStoreHandler(root: string): (req, res, next) => Promise<void>`
  - Browser client: `loadStore(): Promise<StoreFile>`, `saveStore(store: StoreFile): Promise<void>`, `saveRecording(recording: SetRecording): Promise<string>` (returns the saved path)

- [ ] **Step 1: Write the failing tests**

`test/store-plugin.test.ts`:

```ts
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStoreHandler } from "../vite-plugin-store";

const calibration = {
  calibratedAt: "2026-10-14T05:00:00.000Z",
  noiseFloorDb: -62.1,
  onOffsetDb: 14.3,
  offOffsetDb: 8.6,
  minFlatness: 0.31,
  minHighRatio: 0.22,
};
const store = { lastMic: "Headset (Bluetooth)", mics: { "Headset (Bluetooth)": calibration } };
const recording = {
  recordedAt: "2026-10-14T05:10:00.000Z",
  mic: "Headset (Bluetooth)",
  thresholds: { onDb: -48, offDb: -54, minFlatness: 0.31, minHighRatio: 0.22 },
  timing: { minDurationMs: 150, maxDurationMs: 1500, minGapMs: 600 },
  frames: [{ t: 21.3, db: -60, flatness: 0.5, highRatio: 0.6 }],
  detectedCount: 0,
  actualCount: 0,
};

let root: string;
let server: Server;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "rep-counter-"));
  const handler = createStoreHandler(root);
  server = createServer((req, res) => {
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

const put = (url: string, body: unknown) =>
  fetch(base + url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const post = (url: string, body: unknown) =>
  fetch(base + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("/api/calibration", () => {
  it("returns an empty store when no file exists", async () => {
    const res = await fetch(`${base}/api/calibration`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mics: {} });
  });

  it("saves and loads a store, leaving no temp files", async () => {
    expect((await put("/api/calibration", store)).status).toBe(200);
    expect(await (await fetch(`${base}/api/calibration`)).json()).toEqual(store);
    expect(JSON.parse(await readFile(path.join(root, "data", "calibration.json"), "utf8"))).toEqual(store);
    expect(await readdir(path.join(root, "data"))).toEqual(["calibration.json"]);
  });

  it("rejects an invalid store without writing it", async () => {
    const res = await put("/api/calibration", { mics: { x: { noiseFloorDb: "loud" } } });
    expect(res.status).toBe(400);
    await expect(readdir(path.join(root, "data"))).rejects.toThrow();
  });

  it("reports a corrupt file instead of replacing it", async () => {
    await mkdir(path.join(root, "data"));
    await writeFile(path.join(root, "data", "calibration.json"), "not json");
    const res = await fetch(`${base}/api/calibration`);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/calibration\.json/);
  });
});

describe("/api/fixtures", () => {
  it("writes a set recording into test/fixtures", async () => {
    const res = await post("/api/fixtures", recording);
    expect(res.status).toBe(200);
    const { path: saved } = await res.json();
    expect(saved).toBe("test/fixtures/set-2026-10-14T05-10-00-000Z.json");
    expect(JSON.parse(await readFile(path.join(root, saved), "utf8"))).toEqual(recording);
  });

  it("rejects an invalid recording", async () => {
    expect((await post("/api/fixtures", { ...recording, actualCount: -1 })).status).toBe(400);
  });
});

it("passes other routes to the next handler", async () => {
  expect((await fetch(`${base}/somewhere-else`)).status).toBe(404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/store-plugin.test.ts`
Expected: FAIL, because `../vite-plugin-store` does not exist.

- [ ] **Step 3: Implement `src/store-schema.ts`**

```ts
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
```

- [ ] **Step 4: Implement `vite-plugin-store.ts`**

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { isSetRecording, isStoreFile, type StoreFile } from "./src/store-schema";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

class BadRequest extends Error {}

/** Serves /api/calibration and /api/fixtures from files in the project. */
export function storePlugin(): Plugin {
  return {
    name: "rep-counter-store",
    configureServer(server) {
      server.middlewares.use(createStoreHandler(server.config.root));
    },
  };
}

export function createStoreHandler(root: string) {
  const calibrationFile = path.join(root, "data", "calibration.json");
  const fixturesDir = path.join(root, "test", "fixtures");

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const route = `${req.method} ${req.url?.split("?")[0]}`;
    try {
      if (route === "GET /api/calibration") {
        send(res, 200, await readStore(calibrationFile));
      } else if (route === "PUT /api/calibration") {
        const body = await readJson(req);
        if (!isStoreFile(body)) throw new BadRequest("The calibration data is not in the expected format.");
        await writeAtomic(calibrationFile, `${JSON.stringify(body, null, 2)}\n`);
        send(res, 200, { ok: true });
      } else if (route === "POST /api/fixtures") {
        const body = await readJson(req);
        if (!isSetRecording(body)) throw new BadRequest("The set recording is not in the expected format.");
        const name = `set-${body.recordedAt.replace(/[^0-9A-Za-z]/g, "-")}.json`;
        await writeAtomic(path.join(fixturesDir, name), `${JSON.stringify(body)}\n`);
        send(res, 200, { path: `test/fixtures/${name}` });
      } else {
        next();
      }
    } catch (err) {
      send(res, err instanceof BadRequest ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

async function readStore(file: string): Promise<StoreFile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { mics: {} };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("data/calibration.json is not valid JSON. Fix or delete it.");
  }
  if (!isStoreFile(parsed)) throw new Error("data/calibration.json is not in the expected format. Fix or delete it.");
  return parsed;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BadRequest("The request body is too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest("The request body is not valid JSON.");
  }
}

/** Writes to a temp file then renames it, so a failed write cannot corrupt the target. */
async function writeAtomic(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, contents);
  await rename(temp, file);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
```

- [ ] **Step 5: Register the plugin and ignore temp files**

Replace `vite.config.ts` with:

```ts
import { defineConfig } from "vitest/config";
import { storePlugin } from "./vite-plugin-store";

export default defineConfig({
  plugins: [storePlugin()],
  server: { port: 5173, strictPort: true },
  // fft.js is CommonJS and only imported from the AudioWorklet, which
  // Vite's dependency scan does not see. Pre-bundle it up front so the
  // first mic start does not trigger a re-optimise and page reload.
  optimizeDeps: { include: ["fft.js"] },
  // AudioWorklet.addModule loads module scripts, so bundle workers as ES modules.
  worker: { format: "es" },
  test: { include: ["test/**/*.test.ts"] },
});
```

Append to `.gitignore`:

```
*.tmp
```

- [ ] **Step 6: Implement the browser client `src/store.ts`**

```ts
import type { SetRecording, StoreFile } from "./store-schema";

export async function loadStore(): Promise<StoreFile> {
  const res = await request("/api/calibration");
  return (await res.json()) as StoreFile;
}

export async function saveStore(store: StoreFile): Promise<void> {
  await request("/api/calibration", { method: "PUT", body: JSON.stringify(store) });
}

/** Saves a set recording and returns its path in the project. */
export async function saveRecording(recording: SetRecording): Promise<string> {
  const res = await request("/api/fixtures", { method: "POST", body: JSON.stringify(recording) });
  return ((await res.json()) as { path: string }).path;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  } catch {
    throw new Error("Couldn't reach the save server. Is `npm run dev` still running?");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res;
}
```

- [ ] **Step 7: Run all tests and the type check**

Run: `npm test && npm run typecheck`
Expected: all tests PASS (features, detector, calibration and the 7 store tests); no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/store-schema.ts src/store.ts vite-plugin-store.ts vite.config.ts .gitignore test/store-plugin.test.ts
git commit -m "feat(store): save calibrations and set recordings to disk

A Vite dev-server plugin reads and writes data/calibration.json and
test/fixtures, so clearing the browser cache cannot lose calibrations.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Set recordings and the regression test

**Files:**
- Create: `src/recording.ts`
- Create: `test/fixtures/.gitkeep` (empty)
- Test: `test/recording.test.ts`, `test/fixtures.test.ts`

**Interfaces:**
- Consumes: `Detector`, `DEFAULT_TIMING`, `Thresholds` (Task 2); `Frame` (Task 1); `SetRecording`, `isSetRecording` (Task 4); `frames`, `quiet`, `exhale` helpers (Task 2).
- Produces:
  - `interface RecordingInput { mic: string; thresholds: Thresholds; frames: Frame[]; detectedCount: number; actualCount: number; recordedAt?: Date }`
  - `buildRecording(input: RecordingInput): SetRecording`
  - `replayCount(recording: SetRecording): number`

- [ ] **Step 1: Write the failing tests**

`test/recording.test.ts`:

```ts
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
    expect(recording.timing).toEqual({ minDurationMs: 150, maxDurationMs: 1500, minGapMs: 600 });
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
```

`test/fixtures.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replayCount } from "../src/recording";
import { isSetRecording } from "../src/store-schema";

// Real sets saved from the page's "Save set data" button. Each must still
// detect the rep count the user said they did.
const dir = new URL("./fixtures/", import.meta.url);
const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : [];

describe("recorded sets", () => {
  if (files.length === 0) {
    it.skip("no sets recorded yet", () => {});
    return;
  }

  it.each(files)("%s detects the actual rep count", (name) => {
    const recording: unknown = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    if (!isSetRecording(recording)) throw new Error(`${name} is not a valid set recording`);
    expect(replayCount(recording)).toBe(recording.actualCount);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/recording.test.ts test/fixtures.test.ts`
Expected: `recording.test.ts` FAILS because `../src/recording` does not exist (`fixtures.test.ts` also fails to import it).

- [ ] **Step 3: Implement `src/recording.ts`**

```ts
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
    frames: input.frames.map((f) => ({
      t: round(f.t, 1),
      db: round(f.db, 2),
      flatness: round(f.flatness, 4),
      highRatio: round(f.highRatio, 4),
    })),
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

function round(value: number, places: number): number {
  return Number(value.toFixed(places));
}
```

Create the empty file `test/fixtures/.gitkeep` so the directory exists in git.

- [ ] **Step 4: Run all tests and the type check**

Run: `npm test && npm run typecheck`
Expected: all tests PASS; "no sets recorded yet" shows as skipped; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/recording.ts test/recording.test.ts test/fixtures.test.ts test/fixtures/.gitkeep
git commit -m "test: replay saved sets through the detector

Each set saved from the page becomes a regression test that checks
the detector still finds the rep count the user reported.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Mic capture through an AudioWorklet

**Files:**
- Create: `src/features-worklet.ts`
- Create: `src/audio.ts`
- Create (temporary harness, replaced in Task 8): `index.html`, `src/main.ts`

**Interfaces:**
- Consumes: `FeatureExtractor`, `Frame` (Task 1).
- Produces:
  - `interface MicSession { readonly label: string; stop(): Promise<void> }`
  - `requestMicPermission(): Promise<void>`
  - `listMics(): Promise<MediaDeviceInfo[]>` (real audio inputs with labels; excludes Chrome's `default` and `communications` aliases)
  - `startMic(deviceId: string, onFrame: (frame: Frame) => void, onEnded: () => void): Promise<MicSession>`

This task needs a browser and a microphone, so it has no unit tests. It is verified by a production build (automated) and a manual check by the user.

- [ ] **Step 1: Write the worklet `src/features-worklet.ts`**

```ts
import { FeatureExtractor } from "./features";

// AudioWorkletGlobalScope globals, which TypeScript's DOM lib does not declare.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class FeaturesProcessor extends AudioWorkletProcessor {
  private readonly extractor = new FeatureExtractor(sampleRate);

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (const frame of this.extractor.push(channel)) this.port.postMessage(frame);
    }
    return true;
  }
}

registerProcessor("features", FeaturesProcessor);
```

- [ ] **Step 2: Write `src/audio.ts`**

```ts
import type { Frame } from "./features";
import workletUrl from "./features-worklet.ts?worker&url";

export interface MicSession {
  readonly label: string;
  stop(): Promise<void>;
}

/** Asks for mic access once, so device labels become visible. */
export async function requestMicPermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

/** Real microphones, without Chrome's "default" and "communications" aliases. */
export async function listMics(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (d) => d.kind === "audioinput" && d.label !== "" && d.deviceId !== "default" && d.deviceId !== "communications",
  );
}

/**
 * Opens a mic with the browser's voice processing off and streams feature
 * frames to onFrame. onEnded fires if the mic goes away (e.g. the headset
 * disconnects) before stop() is called.
 */
export async function startMic(
  deviceId: string,
  onFrame: (frame: Frame) => void,
  onEnded: () => void,
): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  const [track] = stream.getAudioTracks();
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    await context.close();
    throw err;
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "features", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
  });
  node.port.onmessage = (event: MessageEvent<Frame>) => onFrame(event.data);
  source.connect(node);
  await context.resume();

  let stopped = false;
  track.addEventListener("ended", () => {
    if (!stopped) onEnded();
  });

  return {
    label: track.label,
    async stop() {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      source.disconnect();
      for (const t of stream.getTracks()) t.stop();
      await context.close();
    },
  };
}
```

- [ ] **Step 3: Write a temporary test harness**

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Rep Counter</title>
  </head>
  <body>
    <button id="test" type="button">Test mic</button>
    <pre id="out"></pre>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:

```ts
// Temporary harness for checking mic capture; Task 8 replaces this file.
import { listMics, requestMicPermission, startMic } from "./audio";

const out = document.querySelector<HTMLPreElement>("#out")!;

document.querySelector("#test")!.addEventListener("click", async () => {
  await requestMicPermission();
  const mics = await listMics();
  const mic = mics.find((m) => /bluetooth|headset|hands-free/i.test(m.label)) ?? mics[0];
  out.textContent = `Mics:\n${mics.map((m) => m.label).join("\n")}\n\nUsing ${mic.label}`;
  let lastShown = 0;
  await startMic(
    mic.deviceId,
    (f) => {
      if (f.t - lastShown < 250) return;
      lastShown = f.t;
      out.textContent = `Using ${mic.label}\n${f.db.toFixed(1)} dB  flatness ${f.flatness.toFixed(2)}  high ${f.highRatio.toFixed(2)}`;
    },
    () => (out.textContent += "\nMic ended"),
  );
});
```

- [ ] **Step 4: Check that it type-checks and builds**

Run: `npm run typecheck && npx vite build && ls dist/assets`
Expected: no type errors; the build succeeds; `dist/assets` contains a separate `features-worklet-*.js` file next to the main `index-*.js`. Then `rm -rf dist`.

- [ ] **Step 5: Manual check (the user does this, with the headset)**

1. Run `npm run dev` and open `http://localhost:5173` in Chrome.
2. Click **Test mic** and allow microphone access.
3. Expected: the list includes the Bluetooth headset. If it doesn't, switch the headset to its headset (HFP) profile in the system sound settings and reload.
4. Stay quiet. Expected: the dB value sits low and steady (roughly −60 to −80).
5. Breathe out hard into the mic. Expected: dB jumps well up (roughly −40 to −15), and flatness and high rise compared with a hum or a spoken "ahh".
6. Expected: no console errors, and the page does not reload by itself on the first click.

Note the quiet and exhale dB values. They are useful context for tuning later.

- [ ] **Step 6: Commit**

```bash
git add src/features-worklet.ts src/audio.ts index.html src/main.ts
git commit -m "feat(audio): capture mic frames in an AudioWorklet

Open the chosen mic with Chrome's voice processing off and stream
feature frames from the audio thread, so background tabs cannot drop
frames.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Set count and mic choice

**Files:**
- Create: `src/rep-set.ts`, `src/mic-choice.ts`
- Test: `test/rep-set.test.ts`, `test/mic-choice.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class RepSet { constructor(target: number); readonly target: number; readonly count: number; readonly complete: boolean; add(delta: 1 | -1): void }`
  - `pickMic(labels: string[], current: string | null, lastMic: string | undefined): string | null`

- [ ] **Step 1: Write the failing tests**

`test/rep-set.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RepSet } from "../src/rep-set";

describe("RepSet", () => {
  it("counts up to the target and is then complete", () => {
    const set = new RepSet(2);
    set.add(1);
    expect(set).toMatchObject({ count: 1, complete: false });
    set.add(1);
    expect(set).toMatchObject({ count: 2, complete: true });
  });

  it("does not count past the target", () => {
    const set = new RepSet(1);
    set.add(1);
    set.add(1);
    expect(set.count).toBe(1);
  });

  it("does not go below zero", () => {
    const set = new RepSet(3);
    set.add(-1);
    expect(set.count).toBe(0);
  });

  it("rejects a target that is not a whole number of at least 1", () => {
    expect(() => new RepSet(0)).toThrow(RangeError);
    expect(() => new RepSet(2.5)).toThrow(RangeError);
  });
});
```

`test/mic-choice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickMic } from "../src/mic-choice";

describe("pickMic", () => {
  const labels = ["Laptop mic", "Headset (Bluetooth)"];

  it("keeps the current choice while it is connected", () => {
    expect(pickMic(labels, "Laptop mic", "Headset (Bluetooth)")).toBe("Laptop mic");
  });

  it("falls back to the last used mic", () => {
    expect(pickMic(labels, "Gone mic", "Headset (Bluetooth)")).toBe("Headset (Bluetooth)");
    expect(pickMic(labels, null, "Headset (Bluetooth)")).toBe("Headset (Bluetooth)");
  });

  it("falls back to the first mic", () => {
    expect(pickMic(labels, null, "Gone mic")).toBe("Laptop mic");
  });

  it("returns null when there are no mics", () => {
    expect(pickMic([], "Laptop mic", "Laptop mic")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/rep-set.test.ts test/mic-choice.test.ts`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement both modules**

`src/rep-set.ts`:

```ts
/** The rep count for one set, including manual +1/−1 corrections. */
export class RepSet {
  private reps = 0;

  constructor(readonly target: number) {
    if (!Number.isInteger(target) || target < 1) throw new RangeError("The target must be a whole number of at least 1.");
  }

  get count(): number {
    return this.reps;
  }

  get complete(): boolean {
    return this.reps >= this.target;
  }

  add(delta: 1 | -1): void {
    if (delta > 0 && this.complete) return;
    this.reps = Math.max(0, this.reps + delta);
  }
}
```

`src/mic-choice.ts`:

```ts
/**
 * Which mic the dropdown should select after its list changes: the current
 * one if still connected, else the last used one, else the first.
 */
export function pickMic(labels: string[], current: string | null, lastMic: string | undefined): string | null {
  if (current !== null && labels.includes(current)) return current;
  if (lastMic !== undefined && labels.includes(lastMic)) return lastMic;
  return labels[0] ?? null;
}
```

- [ ] **Step 4: Run all tests and the type check**

Run: `npm test && npm run typecheck`
Expected: all tests PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/rep-set.ts src/mic-choice.ts test/rep-set.test.ts test/mic-choice.test.ts
git commit -m "feat: add set count and mic selection rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The page

**Files:**
- Replace: `index.html`, `src/main.ts` (the Task 6 harness)
- Create: `src/style.css`, `src/meter.ts`, `src/chime.ts`, `src/ui.ts`

**Interfaces:**
- Consumes: everything above —
  `requestMicPermission`, `listMics`, `startMic`, `MicSession` (Task 6);
  `deriveCalibration`, `exhalesComplete`, `noiseFloor`, `segmentExhales`, `thresholdsFor`, `REQUIRED_EXHALES`, `Calibration` (Task 3);
  `Detector`, `DetectorEvent`, `Thresholds` (Task 2); `Frame` (Task 1);
  `loadStore`, `saveStore`, `saveRecording` (Task 4); `StoreFile` (Task 4);
  `buildRecording` (Task 5); `RepSet`, `pickMic` (Task 7).
- Produces:
  - `class Meter { constructor(canvas: HTMLCanvasElement); reset(thresholds: Thresholds | null): void; addFrame(frame: Frame): void; addEvent(event: DetectorEvent): void }`
  - `playChime(): Promise<void>`
  - `class App { init(): Promise<void> }`

The page is verified manually by the user in Step 8. There are no unit tests for DOM code; the logic it uses is tested in Tasks 1–7.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rep Counter</title>
  </head>
  <body>
    <main>
      <header>
        <label>Mic <select id="mic"></select></label>
        <span id="cal-status">Not calibrated</span>
        <button id="recalibrate" type="button">Recalibrate</button>
      </header>

      <p id="error" role="alert" hidden></p>

      <section id="set">
        <label>Target reps <input id="target" type="number" min="1" step="1" value="10" /></label>
        <button id="start" type="button">Start set</button>
        <p id="status" aria-live="polite">Ready</p>
        <p id="count"><span id="count-done">0</span> / <span id="count-target">10</span></p>
        <div id="set-controls" hidden>
          <button id="minus" type="button">−1</button>
          <button id="plus" type="button">+1</button>
          <button id="stop" type="button">Stop</button>
        </div>
      </section>

      <details id="tuning" open>
        <summary>Tuning</summary>
        <canvas id="meter"></canvas>
        <ol id="rejections"></ol>
        <form id="save-set" hidden>
          <label>Reps you actually did <input id="actual" type="number" min="0" step="1" /></label>
          <button type="submit">Save set data</button>
          <span id="save-status"></span>
        </form>
      </details>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/style.css`**

```css
:root {
  color-scheme: light dark;
  --bg: #f6f6f4;
  --fg: #1b1b1b;
  --muted: #666;
  --panel: #fff;
  --border: #d8d8d4;
  --accent: #2563eb;
  --error-bg: #fde8e8;
  --error-fg: #9b1c1c;
  --meter-trace: #2563eb;
  --meter-on: #16a34a;
  --meter-off: #ca8a04;
  --meter-rep: #16a34a;
  --meter-reject: #dc2626;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141414;
    --fg: #ececec;
    --muted: #9a9a9a;
    --panel: #1e1e1e;
    --border: #333;
    --accent: #3b82f6;
    --error-bg: #3b1515;
    --error-fg: #fca5a5;
    --meter-trace: #60a5fa;
    --meter-on: #4ade80;
    --meter-off: #facc15;
    --meter-rep: #4ade80;
    --meter-reject: #f87171;
  }
}

[hidden] {
  display: none !important;
}

body {
  margin: 0;
  font: 16px/1.5 system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
}

main {
  max-width: 720px;
  margin: 0 auto;
  padding: 16px;
  display: grid;
  gap: 16px;
}

header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
}

button,
select,
input {
  font: inherit;
  color: var(--fg);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 12px;
}

button {
  cursor: pointer;
}

button:disabled,
select:disabled,
input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

#error {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--error-bg);
  color: var(--error-fg);
}

#set {
  display: grid;
  gap: 12px;
  justify-items: center;
}

#start {
  background: var(--accent);
  border-color: transparent;
  color: #fff;
  font-size: 1.25rem;
  padding: 12px 32px;
}

#status {
  margin: 0;
  font-size: 1.25rem;
  text-align: center;
}

#count {
  margin: 0;
  font-size: clamp(64px, 18vw, 160px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

#set-controls {
  display: flex;
  gap: 12px;
}

#meter {
  display: block;
  width: 100%;
  height: 160px;
  margin-top: 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
}

#rejections {
  color: var(--muted);
  font-size: 0.9rem;
}

#save-set {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
}
```

- [ ] **Step 3: Write `src/meter.ts`**

```ts
import type { DetectorEvent, Thresholds } from "./detector";
import type { Frame } from "./features";

const WINDOW_MS = 10_000;
const MIN_DB = -100;
const MAX_DB = 0;

/** Scrolling 10 s dB trace with threshold lines and rep/rejection markers. */
export class Meter {
  private frames: Frame[] = [];
  private events: DetectorEvent[] = [];
  private thresholds: Thresholds | null = null;
  private drawPending = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  reset(thresholds: Thresholds | null): void {
    this.frames = [];
    this.events = [];
    this.thresholds = thresholds;
    this.scheduleDraw();
  }

  addFrame(frame: Frame): void {
    this.frames.push(frame);
    const cutoff = frame.t - WINDOW_MS;
    while (this.frames.length > 0 && this.frames[0].t < cutoff) this.frames.shift();
    this.events = this.events.filter((e) => e.t >= cutoff);
    this.scheduleDraw();
  }

  addEvent(event: DetectorEvent): void {
    this.events.push(event);
    this.scheduleDraw();
  }

  private scheduleDraw(): void {
    if (this.drawPending) return;
    this.drawPending = true;
    requestAnimationFrame(() => {
      this.drawPending = false;
      this.draw();
    });
  }

  private draw(): void {
    const { canvas } = this;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(canvas);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const now = this.frames.at(-1)?.t ?? 0;
    const x = (t: number) => width - ((now - t) / WINDOW_MS) * width;
    const y = (db: number) => height - ((Math.min(MAX_DB, Math.max(MIN_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB)) * height;

    if (this.thresholds) {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      for (const [db, name] of [
        [this.thresholds.onDb, "--meter-on"],
        [this.thresholds.offDb, "--meter-off"],
      ] as const) {
        ctx.strokeStyle = color(name);
        ctx.beginPath();
        ctx.moveTo(0, y(db));
        ctx.lineTo(width, y(db));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    for (const event of this.events) {
      ctx.strokeStyle = color(event.kind === "rep" ? "--meter-rep" : "--meter-reject");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(event.t), 0);
      ctx.lineTo(x(event.t), height);
      ctx.stroke();
    }

    ctx.strokeStyle = color("--meter-trace");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.frames.forEach((f, i) => (i === 0 ? ctx.moveTo(x(f.t), y(f.db)) : ctx.lineTo(x(f.t), y(f.db))));
    ctx.stroke();
  }
}
```

- [ ] **Step 4: Write `src/chime.ts`**

```ts
const NOTES_HZ = [660, 880, 1320];
const NOTE_S = 0.16;
const DECAY_S = NOTE_S * 1.8;

/** A short rising three-note chime, synthesised so there is no file to load. */
export async function playChime(): Promise<void> {
  const context = new AudioContext();
  await context.resume();
  const start = context.currentTime + 0.05;
  NOTES_HZ.forEach((hz, i) => {
    const t0 = start + i * NOTE_S;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.4, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + DECAY_S);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(t0);
    oscillator.stop(t0 + DECAY_S);
  });
  const totalMs = (0.05 + (NOTES_HZ.length - 1) * NOTE_S + DECAY_S) * 1000 + 100;
  await new Promise((resolve) => setTimeout(resolve, totalMs));
  await context.close();
}
```

- [ ] **Step 5: Write `src/ui.ts`**

```ts
import { listMics, requestMicPermission, startMic, type MicSession } from "./audio";
import {
  deriveCalibration,
  exhalesComplete,
  noiseFloor,
  REQUIRED_EXHALES,
  segmentExhales,
  thresholdsFor,
  type Calibration,
} from "./calibration";
import { playChime } from "./chime";
import { Detector, type DetectorEvent, type Thresholds } from "./detector";
import type { Frame } from "./features";
import { Meter } from "./meter";
import { pickMic } from "./mic-choice";
import { buildRecording } from "./recording";
import { RepSet } from "./rep-set";
import { loadStore, saveRecording, saveStore } from "./store";
import type { StoreFile } from "./store-schema";

const CALIBRATION_QUIET_MS = 3000;
const SET_QUIET_MS = 2000;
const EXHALE_TIMEOUT_MS = 10_000;
const REJECTIONS_SHOWN = 8;

interface FinishedSet {
  mic: string;
  thresholds: Thresholds;
  frames: Frame[];
  detectedCount: number;
}

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The page is missing #${id}.`);
  return element as T;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class App {
  private readonly ui = {
    mic: el<HTMLSelectElement>("mic"),
    calStatus: el<HTMLSpanElement>("cal-status"),
    recalibrate: el<HTMLButtonElement>("recalibrate"),
    error: el<HTMLParagraphElement>("error"),
    target: el<HTMLInputElement>("target"),
    start: el<HTMLButtonElement>("start"),
    status: el<HTMLParagraphElement>("status"),
    countDone: el<HTMLSpanElement>("count-done"),
    countTarget: el<HTMLSpanElement>("count-target"),
    setControls: el<HTMLDivElement>("set-controls"),
    minus: el<HTMLButtonElement>("minus"),
    plus: el<HTMLButtonElement>("plus"),
    stop: el<HTMLButtonElement>("stop"),
    rejections: el<HTMLOListElement>("rejections"),
    saveForm: el<HTMLFormElement>("save-set"),
    actual: el<HTMLInputElement>("actual"),
    saveStatus: el<HTMLSpanElement>("save-status"),
  };
  private readonly meter = new Meter(el<HTMLCanvasElement>("meter"));
  private store: StoreFile = { mics: {} };
  private mics: MediaDeviceInfo[] = [];
  private busy = false;

  private session: MicSession | null = null;
  private activeMic: string | null = null;
  /** Receives frames from the open mic, if anything is listening. */
  private frameSink: ((frame: Frame) => void) | null = null;
  /** Rejects whatever the current flow is waiting on, when the mic is lost. */
  private pending: { reject: (err: Error) => void } | null = null;
  private endSet: ((outcome: "complete" | "stopped") => void) | null = null;
  private currentSet: RepSet | null = null;
  private finishedSet: FinishedSet | null = null;

  async init(): Promise<void> {
    this.ui.start.addEventListener("click", () => void this.run(() => this.runSet()));
    this.ui.recalibrate.addEventListener("click", () => void this.run(() => this.recalibrate()));
    this.ui.mic.addEventListener("change", () => void this.chooseMic());
    this.ui.target.addEventListener("input", () => this.renderCount(0, Number(this.ui.target.value) || 0));
    this.ui.plus.addEventListener("click", () => this.adjust(1));
    this.ui.minus.addEventListener("click", () => this.adjust(-1));
    this.ui.stop.addEventListener("click", () => this.endSet?.("stopped"));
    this.ui.saveForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveSet();
    });

    // Without the saved calibrations, a later save would overwrite the file,
    // so stop here and leave the controls disabled until it is fixed.
    try {
      this.store = await loadStore();
    } catch (err) {
      this.setBusy(true);
      this.showError(`Couldn't load saved calibrations: ${message(err)}`);
      return;
    }
    try {
      await requestMicPermission();
    } catch (err) {
      this.setBusy(true);
      this.showError(`Microphone access is needed to count reps: ${message(err)}`);
      return;
    }
    navigator.mediaDevices.addEventListener("devicechange", () => void this.refreshMics());
    await this.refreshMics();
  }

  // ---- flows ----

  /** Runs one flow at a time, showing any error it ends with. */
  private async run(flow: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.clearError();
    try {
      await flow();
    } catch (err) {
      this.frameSink = null;
      this.currentSet = null;
      await this.closeMic();
      this.ui.setControls.hidden = true;
      this.setStatus("Ready");
      this.showError(message(err));
    } finally {
      this.pending = null;
      this.endSet = null;
      this.setBusy(false);
    }
  }

  private async recalibrate(): Promise<void> {
    await this.calibrate(this.selectedMic());
    this.setStatus("Calibrated. Ready.");
  }

  private async runSet(): Promise<void> {
    const target = Number(this.ui.target.value);
    if (!Number.isInteger(target) || target < 1) throw new Error("Enter a target of at least 1 rep.");
    const mic = this.selectedMic();
    const calibration = this.store.mics[mic] ?? (await this.calibrate(mic));

    await this.openMic(mic);
    this.meter.reset(null);
    this.ui.rejections.replaceChildren();
    this.ui.saveForm.hidden = true;
    this.finishedSet = null;
    this.renderCount(0, target);
    this.setStatus("Stay quiet…");
    const quiet = await this.collect(SET_QUIET_MS);

    const thresholds = thresholdsFor(calibration, noiseFloor(quiet));
    const detector = new Detector(thresholds);
    const set = new RepSet(target);
    const recording: FinishedSet = { mic, thresholds, frames: [], detectedCount: 0 };
    this.currentSet = set;
    this.meter.reset(thresholds);
    this.ui.setControls.hidden = false;
    this.setStatus("Go!");

    this.frameSink = (frame) => {
      recording.frames.push(frame);
      this.meter.addFrame(frame);
      const event = detector.push(frame);
      if (!event) return;
      this.meter.addEvent(event);
      if (event.kind === "rep") {
        recording.detectedCount++;
        this.adjust(1);
      } else {
        this.addRejection(event);
      }
    };

    const outcome = await this.waitForSetEnd();
    this.frameSink = null;
    this.currentSet = null;
    await this.closeMic();
    this.ui.setControls.hidden = true;
    this.finishedSet = recording;
    this.ui.actual.value = String(set.count);
    this.ui.saveStatus.textContent = "";
    this.ui.saveForm.hidden = false;

    if (outcome === "complete") {
      this.setStatus("Set complete");
      await playChime();
    } else {
      this.setStatus("Stopped");
    }
  }

  private async calibrate(mic: string): Promise<Calibration> {
    await this.openMic(mic);
    try {
      this.meter.reset(null);
      this.setStatus("Calibrating: stay quiet…");
      const quiet = await this.collect(CALIBRATION_QUIET_MS);
      const floor = noiseFloor(quiet);

      this.setStatus(`Breathe out hard ${REQUIRED_EXHALES} times, like at the end of a rep`);
      const exhales = await this.collect(EXHALE_TIMEOUT_MS, (frames) => {
        const heard = Math.min(segmentExhales(frames, floor).length, REQUIRED_EXHALES);
        this.setStatus(`Breathe out hard ${REQUIRED_EXHALES} times: heard ${heard}`);
        return exhalesComplete(frames, floor);
      });

      const result = deriveCalibration(quiet, exhales);
      if (!result.ok) throw new Error(`Calibration failed. ${result.reason}`);
      this.store = { ...this.store, lastMic: mic, mics: { ...this.store.mics, [mic]: result.calibration } };
      this.renderCalibration();
      try {
        await saveStore(this.store);
      } catch (err) {
        throw new Error(`Calibrated, but couldn't save it: ${message(err)}`);
      }
      return result.calibration;
    } finally {
      await this.closeMic();
    }
  }

  // ---- mic ----

  private async openMic(label: string): Promise<void> {
    const device = this.mics.find((m) => m.label === label);
    if (!device) throw new Error(`"${label}" is not connected.`);
    this.session = await startMic(
      device.deviceId,
      (frame) => this.frameSink?.(frame),
      () => this.loseMic(label),
    );
    this.activeMic = label;
  }

  private async closeMic(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.activeMic = null;
    await session?.stop();
  }

  private loseMic(label: string): void {
    this.frameSink = null;
    void this.closeMic();
    this.pending?.reject(new Error(`Lost the microphone "${label}". The set was stopped.`));
  }

  /** Collects frames for `ms` of audio time, or until `done` returns true. */
  private collect(ms: number, done?: (frames: Frame[]) => boolean): Promise<Frame[]> {
    return new Promise((resolve, reject) => {
      const frames: Frame[] = [];
      this.pending = { reject };
      this.frameSink = (frame) => {
        frames.push(frame);
        this.meter.addFrame(frame);
        if (frame.t - frames[0].t >= ms || done?.(frames)) {
          this.frameSink = null;
          this.pending = null;
          resolve(frames);
        }
      };
    });
  }

  private waitForSetEnd(): Promise<"complete" | "stopped"> {
    return new Promise((resolve, reject) => {
      this.pending = { reject };
      this.endSet = (outcome) => {
        this.pending = null;
        this.endSet = null;
        resolve(outcome);
      };
    });
  }

  private async refreshMics(): Promise<void> {
    this.mics = await listMics();
    const labels = this.mics.map((m) => m.label);
    if (this.activeMic !== null && !labels.includes(this.activeMic)) this.loseMic(this.activeMic);

    const chosen = pickMic(labels, this.ui.mic.value || null, this.store.lastMic);
    this.ui.mic.replaceChildren(...labels.map((label) => new Option(label, label)));
    if (chosen !== null) this.ui.mic.value = chosen;
    if (labels.length === 0) {
      this.setStatus("No microphone found. Connect the headset and switch it to headset (HFP) mode.");
    }
    this.renderCalibration();
  }

  private async chooseMic(): Promise<void> {
    this.renderCalibration();
    this.store = { ...this.store, lastMic: this.ui.mic.value };
    try {
      await saveStore(this.store);
    } catch (err) {
      this.showError(`Couldn't save the mic choice: ${message(err)}`);
    }
  }

  private selectedMic(): string {
    const mic = this.ui.mic.value;
    if (!mic) throw new Error("Choose a microphone first.");
    return mic;
  }

  // ---- set ----

  private adjust(delta: 1 | -1): void {
    const set = this.currentSet;
    if (!set) return;
    set.add(delta);
    this.renderCount(set.count, set.target);
    if (set.complete) this.endSet?.("complete");
  }

  private async saveSet(): Promise<void> {
    if (!this.finishedSet) return;
    const actualCount = Number(this.ui.actual.value);
    if (!Number.isInteger(actualCount) || actualCount < 0) {
      this.showError("Enter how many reps you actually did.");
      return;
    }
    try {
      const path = await saveRecording(buildRecording({ ...this.finishedSet, actualCount }));
      this.ui.saveStatus.textContent = `Saved to ${path}`;
    } catch (err) {
      this.showError(`Couldn't save the set data: ${message(err)}`);
    }
  }

  // ---- rendering ----

  private renderCount(done: number, target: number): void {
    this.ui.countDone.textContent = String(done);
    this.ui.countTarget.textContent = String(target);
  }

  private renderCalibration(): void {
    const calibration = this.store.mics[this.ui.mic.value];
    this.ui.calStatus.textContent = calibration
      ? `Calibrated ✓ (${new Date(calibration.calibratedAt).toLocaleDateString()})`
      : "Not calibrated";
  }

  private addRejection(event: Extract<DetectorEvent, { kind: "rejected" }>): void {
    const item = document.createElement("li");
    item.textContent = `${(event.t / 1000).toFixed(1)} s: ${event.reason}`;
    this.ui.rejections.prepend(item);
    while (this.ui.rejections.children.length > REJECTIONS_SHOWN) this.ui.rejections.lastElementChild?.remove();
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.ui.start.disabled = busy;
    this.ui.recalibrate.disabled = busy;
    this.ui.mic.disabled = busy;
    this.ui.target.disabled = busy;
  }

  private setStatus(text: string): void {
    this.ui.status.textContent = text;
  }

  private showError(text: string): void {
    this.ui.error.textContent = text;
    this.ui.error.hidden = false;
  }

  private clearError(): void {
    this.ui.error.hidden = true;
  }
}
```

- [ ] **Step 6: Replace `src/main.ts`**

```ts
import "./style.css";
import { App } from "./ui";

void new App().init();
```

- [ ] **Step 7: Run all tests, the type check and a build**

Run: `npm test && npm run typecheck && npx vite build && rm -rf dist`
Expected: all tests PASS; no type errors; the build succeeds.

- [ ] **Step 8: Manual check (the user does this, with the headset)**

Run `npm run dev` and open `http://localhost:5173` in Chrome.

1. **Mic list:** allow mic access. Expected: the dropdown lists the headset and the status reads "Not calibrated".
2. **First set calibrates:** set the target to 5 and click **Start set**. Expected: "Calibrating: stay quiet…" for 3 s, then "Breathe out hard 3 times: heard 0". After three hard exhales the label reads "Calibrated ✓", and `data/calibration.json` exists with the headset's label as the key.
3. **Counting:** after "Stay quiet…" (2 s) and "Go!", do 5 reps with one hard exhale each. Expected: the count rises once per exhale; inhales, setting the weight down and a grunt do not count (they appear in the rejection list or not at all). At 5/5 the chime plays and the status reads "Set complete". The meter shows the trace, both dashed threshold lines and the markers.
4. **Manual corrections:** start another set and use **+1** and **−1**. Expected: the count changes, never goes below 0, and reaching the target with **+1** completes the set.
5. **Save set data:** enter the real rep count and click **Save set data**. Expected: "Saved to test/fixtures/set-….json". Then `npm test` replays it and passes if the detector agreed with you.
6. **Calibration survives:** reload the page, then clear Chrome's browsing data for localhost and reload again. Expected: still "Calibrated ✓"; starting a set does not recalibrate.
7. **Headset reconnects:** turn the headset off. Expected: it leaves the dropdown without a reload. Turn it back on in headset mode. Expected: it reappears and is selected again.
8. **Mic lost mid-set:** start a set and turn the headset off. Expected: the set stops with "Lost the microphone "…". The set was stopped."
9. **Save server down:** stop `npm run dev` with the page still open and change the mic in the dropdown. Expected: an error saying it couldn't reach the save server.

- [ ] **Step 9: Commit**

```bash
git add index.html src/style.css src/meter.ts src/chime.ts src/ui.ts src/main.ts
git commit -m "feat(ui): add the rep counter page

Calibrate on first use, count reps live with a level meter and
rejection list, play a chime when the set is done, and save sets as
test fixtures.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| Environment: Chrome only, port 5173 strict | 1, 4 |
| Audio pipeline: constraints, worklet, frames, 100 Hz–4 kHz band | 1, 6 |
| Detector: hysteresis, classification order, overlong handling | 2 |
| Calibration: quiet, segmentation, derivation, per-set re-base | 3, 8 |
| Persistence: plugin endpoints, atomic writes, label keys, lastMic, errors | 4, 8 |
| UI: dropdown and devicechange, lost mic, set controls, completion chime, tuning panel | 7, 8 |
| Testing: features, detector, calibration, fixture replay, store plugin | 1–5 |
