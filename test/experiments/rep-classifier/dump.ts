import { readFileSync, writeFileSync } from "node:fs";
import { Detector, DEFAULT_TIMING } from "../../../src/detector";
// Every gate-opened sound of 150 ms or more, with the current detector's verdict, from each log.
const out: any[] = [];
for (const p of process.argv.slice(3)) {
  const r = JSON.parse(readFileSync(p, "utf8"));
  if (!r.frames || !r.thresholds) continue;
  const id = p.split("/").pop()!.replace(".json", "");
  const d = new Detector(r.thresholds, DEFAULT_TIMING);
  const { onDb, offDb } = r.thresholds;
  let s: any[] | null = null;
  for (const f of r.frames) {
    if (s && f.db >= offDb) s.push(f);
    const e = d.push(f);
    if (!s && f.db >= onDb) s = [f];
    else if (s && f.db < offDb) {
      const dur = f.t - s[0].t, peak = Math.max(...s.map((x) => x.db));
      if (dur >= 150) out.push({ id, start: s[0].t / 1000, end: f.t / 1000, dur, peak, kind: e?.kind ?? "rejected", reason: (e as any)?.reason ?? "", mic: r.mic, actual: r.actualCount ?? null, detected: r.detectedCount });
      s = null;
    }
  }
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(out.length, "sounds");
