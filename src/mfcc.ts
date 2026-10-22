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
