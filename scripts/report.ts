// Summarises data/logs for reviewing how well detection works.
// Run with `npm run report`. Uses only Node built-ins so Node runs it directly.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface SetLog {
  id: string;
  startedAt: string;
  mic: string;
  target: number;
  outcome: string;
  error?: string;
  dingOnRep: boolean;
  quietFloorDb: number;
  thresholds: { onDb: number; offDb: number };
  detectedCount: number;
  finalCount: number;
  actualCount: number | null;
  events: { kind: string; reason?: string }[];
  adjustments: { delta: number }[];
}

interface CalibrationLog {
  id: string;
  startedAt: string;
  mic: string;
  ok: boolean;
  reason?: string;
  noiseFloorDb: number;
  calibration?: { onOffsetDb: number; minFlatness: number; minHighRatio: number };
  segments: unknown[];
}

const logsDir = path.join(import.meta.dirname, "..", "data", "logs");

async function readLogs<T>(kind: string): Promise<T[]> {
  let names: string[];
  try {
    names = (await readdir(path.join(logsDir, kind))).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(path.join(logsDir, kind, n), "utf8")) as T));
}

const when = (iso: string) => new Date(iso).toLocaleString();
const db = (n: number) => `${n.toFixed(1)} dB`;

/** "too short (80 ms)" → "too short", so reasons can be tallied. */
const reasonKind = (reason = "") => reason.replace(/\s*\(.*$/, "");

function tally(items: string[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, n]) => `${item} ×${n}`).join(", ");
}

/** Names the attempt's audio file, which shares the log's id. */
function audioNote(kind: string, id: string): string {
  const file = path.join(logsDir, kind, `${id}.webm`);
  return existsSync(file) ? `\n    audio: ${path.relative(process.cwd(), file)}` : "";
}

const calibrations = await readLogs<CalibrationLog>("calibrations");
console.log(`Calibrations (${calibrations.length})`);
for (const c of calibrations) {
  const result = c.ok && c.calibration
    ? `ok: breaths ${db(c.calibration.onOffsetDb / 0.5)} above background, ` +
      `minFlatness ${c.calibration.minFlatness.toFixed(3)}, minHighRatio ${c.calibration.minHighRatio.toFixed(2)}`
    : `FAILED: ${c.reason}`;
  console.log(
    `  ${when(c.startedAt)}  ${c.mic}  background ${db(c.noiseFloorDb)}  ${c.segments.length} sounds  ${result}` +
      audioNote("calibrations", c.id),
  );
}

const sets = await readLogs<SetLog>("sets");
console.log(`\nSets (${sets.length})`);
for (const s of sets) {
  const plus = s.adjustments.filter((a) => a.delta > 0).length;
  const minus = s.adjustments.length - plus;
  const actual = s.actualCount === null ? "actual not entered" : `actual ${s.actualCount}`;
  console.log(
    `  ${when(s.startedAt)}  ${s.mic}  target ${s.target}  detected ${s.detectedCount}  ` +
      `final ${s.finalCount} (+${plus} −${minus})  ${actual}  ${s.outcome}${s.error ? `: ${s.error}` : ""}` +
      `${s.dingOnRep ? "  ding" : ""}${audioNote("sets", s.id)}`,
  );
  console.log(`    background ${db(s.quietFloorDb)}  on ${db(s.thresholds.onDb)}  off ${db(s.thresholds.offDb)}`);
  const rejected = s.events.filter((e) => e.kind === "rejected").map((e) => reasonKind(e.reason));
  if (rejected.length > 0) console.log(`    rejected: ${tally(rejected)}`);
}

const judged = sets.filter((s) => s.actualCount !== null);
if (judged.length > 0) {
  const actual = judged.reduce((sum, s) => sum + (s.actualCount ?? 0), 0);
  const missed = judged.reduce((sum, s) => sum + Math.max(0, (s.actualCount ?? 0) - s.detectedCount), 0);
  const extra = judged.reduce((sum, s) => sum + Math.max(0, s.detectedCount - (s.actualCount ?? 0)), 0);
  console.log(`\nAcross ${judged.length} sets with an actual count: ${actual} reps, ${missed} missed, ${extra} extra.`);
}
