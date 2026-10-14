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
