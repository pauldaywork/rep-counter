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
