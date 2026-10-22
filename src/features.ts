import FFT from "fft.js";
import { dctMatrix, MEL_BANDS, MFCC_COUNT, melFilterBank, mfccFrom } from "./mfcc";

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
  /** MFCCs 1..19 over BAND_LOW_HZ..BAND_HIGH_HZ; logged for a future classifier, not used to count. Older logs lack it. */
  mfcc?: number[];
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
  private readonly melFilters: Float64Array[];
  private readonly dct: Float64Array[];
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
    this.melFilters = melFilterBank(n / 2 + 1, sampleRate / n, BAND_LOW_HZ, Math.min(BAND_HIGH_HZ, sampleRate / 2));
    this.dct = dctMatrix(MEL_BANDS, MFCC_COUNT);
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
    return {
      t: (this.samplesSeen / this.sampleRate) * 1000,
      db: rmsDb(this.buffer),
      flatness,
      highRatio,
      mfcc: mfccFrom(this.power, this.melFilters, this.dct),
    };
  }
}
