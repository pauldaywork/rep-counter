// Scores every sound in the set logs against a template of the same
// activity's reps from the other sets, to see whether known setup breaths
// stand out from real reps. Single-set logs have no activity, so each mic's
// single sets are grouped as one. See docs/ideas/compare-sounds-to-reps.md.
// Run with `npm run experiment`; plain `npm test` skips it.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { DEFAULT_TIMING, Detector } from "../../src/detector";

const ROOTS = ["../../data-routine/logs/sets/", "../../data/logs/sets/"].map((dir) => fileURLToPath(new URL(dir, import.meta.url)));

/** Counted sounds known to be setup breaths, by set id and end time in seconds. Add new ones here. */
const SETUP: Record<string, number[]> = {
  "2026-10-17T08-27-52-484Z": [7.6, 11.1],
  "2026-10-17T08-29-32-980Z": [12.7],
  "2026-10-21T05-25-24-624Z": [8.1],
  "2026-10-21T05-34-29-105Z": [8.0, 11.6],
};

type F = { t: number; db: number; flatness: number; highRatio: number };
type Sound = { set: string; activity: string; end: number; kind: string; reason: string; f: Record<string, number>; env: number[]; label: string };

const ENV_POINTS = 10;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const mad = (a: number[]) => { const m = median(a); return median(a.map((x) => Math.abs(x - m))) * 1.4826 || 1e-6; };

function features(buf: F[]): { f: Record<string, number>; env: number[] } {
  const dbs = buf.map((b) => b.db);
  const peak = Math.max(...dbs);
  let step = 0;
  for (let i = 1; i < dbs.length; i++) step += Math.abs(dbs[i] - dbs[i - 1]);
  const mean = (k: keyof F) => buf.reduce((a, b) => a + (b[k] as number), 0) / buf.length;
  const env = Array.from({ length: ENV_POINTS }, (_, i) => dbs[Math.min(dbs.length - 1, Math.floor((i / ENV_POINTS) * dbs.length))] - peak);
  const peakAt = dbs.indexOf(peak) / dbs.length;
  return {
    f: { dur: buf[buf.length - 1].t - buf[0].t, peak, flat: mean("flatness"), high: mean("highRatio"), jitter: step / Math.max(1, dbs.length - 1), peakAt },
    env,
  };
}

function soundsOf(root: string, file: string): Sound[] {
  const j = JSON.parse(readFileSync(root + file, "utf8"));
  const activity: string = j.routine?.activity ?? `single sets, ${j.mic}`;
  const set = file.replace(".json", "");
  const { onDb, offDb } = j.thresholds;
  const det = new Detector(j.thresholds, DEFAULT_TIMING);
  const out: Sound[] = [];
  let buf: F[] = [];
  let active = false;
  for (const fr of j.frames as F[]) {
    if (!active && fr.db >= onDb) { active = true; buf = []; }
    if (active && fr.db >= offDb) buf.push(fr);
    const ev = det.push(fr);
    if (active && fr.db < offDb) active = false;
    if (!ev) continue;
    if (buf.length < 8) continue; // under ~150 ms: too short to describe
    const end = Math.round(ev.t / 100) / 10;
    const setup = (SETUP[set] ?? []).some((t) => Math.abs(t - end) < 0.15);
    const { f, env } = features(buf);
    out.push({ set, activity, end, kind: ev.kind, reason: ev.kind === "rep" ? "" : ev.reason.split(" (")[0], f, env, label: setup ? "SETUP" : ev.kind === "rep" ? "rep" : "rejected" });
    buf = [];
  }
  return out;
}

const ALL_KEYS = ["dur", "peak", "flat", "high", "jitter", "peakAt"];

function score(s: Sound, template: Sound[], keys: string[]): { total: number; parts: Record<string, number> } {
  const parts: Record<string, number> = {};
  for (const k of keys) {
    const vals = template.map((t) => t.f[k]);
    parts[k] = (s.f[k] - median(vals)) / mad(vals);
  }
  const medEnv = Array.from({ length: ENV_POINTS }, (_, i) => median(template.map((t) => t.env[i])));
  const envDist = (e: number[]) => Math.sqrt(e.reduce((a, x, i) => a + (x - medEnv[i]) ** 2, 0) / ENV_POINTS);
  const dists = template.map((t) => envDist(t.env));
  parts.env = (envDist(s.env) - median(dists)) / mad(dists);
  const total = Math.sqrt(Object.values(parts).reduce((a, z) => a + Math.min(z * z, 100), 0) / Object.keys(parts).length);
  return { total, parts };
}

/** Scores each activity's sounds against its reps in the other sets, using the given features. */
function report(all: Sound[], keys: string[]): string {
  let out = "";
  for (const activity of [...new Set(all.map((s) => s.activity))]) {
    const mine = all.filter((s) => s.activity === activity);
    const scored = mine
      .map((s) => {
        const template = mine.filter((t) => t.set !== s.set && t.label === "rep");
        return { s, ...(template.length >= 10 ? score(s, template, keys) : { total: NaN, parts: {} }) };
      })
      .filter((x) => !Number.isNaN(x.total));
    const reps = scored.filter((x) => x.s.label === "rep").map((x) => x.total).sort((a, b) => a - b);
    if (reps.length === 0) continue;
    const pct = (p: number) => reps[Math.min(reps.length - 1, Math.floor(p * reps.length))].toFixed(2);
    out += `\n== ${activity}: ${reps.length} counted reps scored, score p50 ${pct(0.5)} p90 ${pct(0.9)} p95 ${pct(0.95)} max ${pct(1)}\n`;
    for (const x of scored.filter((x) => x.s.label === "SETUP")) {
      const rank = reps.filter((r) => r < x.total).length / reps.length;
      out += `  SETUP ${x.s.set.slice(11, 19)} @${x.s.end}: score ${x.total.toFixed(2)} (above ${(rank * 100).toFixed(0)}% of reps)  ${fmt(x)}\n`;
    }
    const worst = scored.filter((x) => x.s.label === "rep").sort((a, b) => b.total - a.total).slice(0, 6);
    out += "  least rep-like counted reps:\n";
    for (const x of worst) out += `    ${x.s.set.slice(11, 19)} @${x.s.end}: ${x.total.toFixed(2)}  ${fmt(x)}\n`;
    const rej = scored.filter((x) => x.s.label === "rejected").sort((a, b) => a.total - b.total);
    out += `  rejected sounds: ${rej.length}, below rep p90: ${rej.filter((x) => x.total < Number(pct(0.9))).length}; most rep-like:\n`;
    for (const x of rej.slice(0, 8)) out += `    ${x.s.set.slice(11, 19)} @${x.s.end} ${x.s.reason}: ${x.total.toFixed(2)}  ${fmt(x)}\n`;
  }
  return out;
}

it.runIf(process.env.EXPERIMENT)("rep template", () => {
  const all = ROOTS.flatMap((root) => readdirSync(root).filter((n) => n.endsWith(".json")).sort().flatMap((n) => soundsOf(root, n)));
  console.log(
    "#### Scoring with loudness\n" + report(all, ALL_KEYS) +
      "\n#### Scoring without loudness\n" + report(all, ALL_KEYS.filter((k) => k !== "peak")),
  );
});

function fmt(x: { s: Sound; parts: Record<string, number> }): string {
  const f = x.s.f;
  const big = Object.entries(x.parts).filter(([, z]) => Math.abs(z) >= 2).map(([k, z]) => `${k}${z > 0 ? "+" : ""}${z.toFixed(1)}`).join(" ");
  return `[${(f.dur / 1000).toFixed(1)}s ${f.peak.toFixed(0)}dB fl${f.flat.toFixed(2)} hi${f.high.toFixed(2)} jit${f.jitter.toFixed(1)}] ${big}`;
}
