import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCalibrationLog, buildSetLog } from "../src/logs";
import { createStoreHandler, ROUTINE_STORE } from "../vite-plugin-store";

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
  // Chained as the plugin chains them, so each store sees the other's routes.
  const handler = createStoreHandler(root);
  const routineHandler = createStoreHandler(root, ROUTINE_STORE);
  server = createServer((req, res) => {
    void handler(req, res, () => {
      void routineHandler(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
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

  it("rejects a body that is not sent as JSON", async () => {
    const res = await fetch(`${base}/api/fixtures`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(recording),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Expected a JSON request body.");
  });

  it("rejects an invalid recording", async () => {
    expect((await post("/api/fixtures", { ...recording, actualCount: -1 })).status).toBe(400);
  });
});

describe("/api/logs", () => {
  const setLog = buildSetLog({
    startedAt: new Date("2026-10-15T05:00:00.000Z"),
    endedAt: new Date("2026-10-15T05:01:00.000Z"),
    mic: "Headset (Bluetooth)",
    target: 5,
    outcome: "complete",
    dingOnRep: true,
    calibration,
    quietFloorDb: -61,
    quietFrames: recording.frames,
    thresholds: recording.thresholds,
    detectedCount: 5,
    finalCount: 5,
    events: [
      { kind: "rep", t: 900, durationMs: 400 },
      { kind: "rejected", t: 1200, reason: "too short (80 ms)" },
    ],
    adjustments: [{ t: 1500, delta: -1 }],
    frames: recording.frames,
  });
  const calibrationLog = buildCalibrationLog({
    startedAt: new Date("2026-10-15T04:59:00.000Z"),
    mic: "Headset (Bluetooth)",
    ok: false,
    reason: "Heard 2 of the 3 breaths.",
    noiseFloorDb: -61,
    segments: [{ startT: 100, endT: 500, peakDb: -30, meanFlatness: 0.4, meanHighRatio: 0.5 }],
    quietFrames: recording.frames,
    exhaleFrames: recording.frames,
  });

  it("writes a set log and replaces it when saved again", async () => {
    const url = `/api/logs/sets/${setLog.id}`;
    const res = await put(url, setLog);
    expect(res.status).toBe(200);
    expect((await res.json()).path).toBe("data/logs/sets/2026-10-15T05-00-00-000Z.json");
    expect((await put(url, { ...setLog, actualCount: 4 })).status).toBe(200);
    const file = path.join(root, "data", "logs", "sets", `${setLog.id}.json`);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ ...setLog, actualCount: 4 });
  });

  it("writes a calibration log", async () => {
    expect((await put(`/api/logs/calibrations/${calibrationLog.id}`, calibrationLog)).status).toBe(200);
    const file = path.join(root, "data", "logs", "calibrations", `${calibrationLog.id}.json`);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(calibrationLog);
  });

  it("rejects a log whose id does not match the url", async () => {
    expect((await put("/api/logs/sets/other-id", setLog)).status).toBe(400);
  });

  it("rejects a log of the wrong kind", async () => {
    expect((await put(`/api/logs/sets/${calibrationLog.id}`, calibrationLog)).status).toBe(400);
  });

  it("writes an attempt's audio next to its log", async () => {
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    const res = await fetch(`${base}/api/logs/sets/${setLog.id}.webm`, {
      method: "PUT",
      headers: { "content-type": "audio/webm;codecs=opus" },
      body: audio,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).path).toBe("data/logs/sets/2026-10-15T05-00-00-000Z.webm");
    expect(await readFile(path.join(root, "data", "logs", "sets", `${setLog.id}.webm`))).toEqual(audio);
  });

  it("rejects audio that is not sent as WebM, or is empty", async () => {
    const url = `${base}/api/logs/calibrations/${calibrationLog.id}.webm`;
    const wrongType = await fetch(url, { method: "PUT", headers: { "content-type": "text/plain" }, body: "x" });
    expect(wrongType.status).toBe(400);
    const empty = await fetch(url, { method: "PUT", headers: { "content-type": "audio/webm" }, body: "" });
    expect(empty.status).toBe(400);
  });

  it("does not route ids that could escape the logs folder", async () => {
    expect((await put("/api/logs/sets/..%2F..%2Fcalibration", setLog)).status).toBe(404);
  });

  it("accepts a set log that says where it sits in a workout, and rejects a bad one", async () => {
    const routine = { runId: "2026-10-15T04-58-00-000Z", workout: "Legs", activity: "Squat", set: 2, sets: 3 };
    expect((await put(`/api/logs/sets/${setLog.id}`, { ...setLog, routine })).status).toBe(200);
    expect((await put(`/api/logs/sets/${setLog.id}`, { ...setLog, routine: { ...routine, set: 0 } })).status).toBe(400);
  });

  it("keeps the routine page's logs, audio and fixtures in data-routine", async () => {
    const res = await put(`/api/routine/logs/sets/${setLog.id}`, setLog);
    expect((await res.json()).path).toBe("data-routine/logs/sets/2026-10-15T05-00-00-000Z.json");
    await readFile(path.join(root, "data-routine", "logs", "sets", `${setLog.id}.json`), "utf8");
    const audio = await fetch(`${base}/api/routine/logs/sets/${setLog.id}.webm`, {
      method: "PUT",
      headers: { "content-type": "audio/webm" },
      body: Buffer.from([1, 2, 3]),
    });
    expect((await audio.json()).path).toBe("data-routine/logs/sets/2026-10-15T05-00-00-000Z.webm");
    const fixture = await post("/api/routine/fixtures", recording);
    expect((await fixture.json()).path).toBe("data-routine/fixtures/set-2026-10-14T05-10-00-000Z.json");
    await expect(readdir(path.join(root, "data"))).rejects.toThrow();
  });
});

describe("/api/routine", () => {
  it("keeps its own calibration, apart from data/calibration.json", async () => {
    expect((await put("/api/routine/calibration", store)).status).toBe(200);
    expect(JSON.parse(await readFile(path.join(root, "data-routine", "calibration.json"), "utf8"))).toEqual(store);
    expect(await (await fetch(`${base}/api/calibration`)).json()).toEqual({ mics: {} });
  });

  it("returns no workouts when none are saved, then saves and loads them", async () => {
    expect(await (await fetch(`${base}/api/routine/workouts`)).json()).toEqual({ workouts: [] });
    const library = {
      lastWorkout: "w2",
      workouts: [
        { id: "w1", name: "Legs", activities: [{ name: "Squat", reps: 10, sets: 3 }], restSeconds: 45 },
        { id: "w2", name: "Arms", activities: [], restSeconds: 60, alternateSets: true },
      ],
    };
    expect((await put("/api/routine/workouts", library)).status).toBe(200);
    expect(await (await fetch(`${base}/api/routine/workouts`)).json()).toEqual(library);
    expect(JSON.parse(await readFile(path.join(root, "data-routine", "workouts.json"), "utf8"))).toEqual(library);
  });

  it("rejects workouts with a nameless activity, no sets, a blank name, a non-boolean alternate-sets flag or a repeated id", async () => {
    const legs = { id: "w1", name: "Legs", activities: [{ name: "Squat", reps: 10, sets: 3 }], restSeconds: 60 };
    const bad = [
      { workouts: [{ ...legs, activities: [{ name: " ", reps: 10, sets: 3 }] }] },
      { workouts: [{ ...legs, activities: [{ name: "Squat", reps: 10, sets: 0 }] }] },
      { workouts: [{ ...legs, restSeconds: -5 }] },
      { workouts: [{ ...legs, alternateSets: "yes" }] },
      { workouts: [{ ...legs, name: "" }] },
      { workouts: [legs, { ...legs, name: "Legs again" }] },
    ];
    for (const library of bad) expect((await put("/api/routine/workouts", library)).status).toBe(400);
  });

  it("reports a corrupt workout file instead of replacing it", async () => {
    await mkdir(path.join(root, "data-routine"), { recursive: true });
    await writeFile(path.join(root, "data-routine", "workouts.json"), "{oops");
    const res = await fetch(`${base}/api/routine/workouts`);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("data-routine/workouts.json is not valid JSON. Fix or delete it.");
  });
});

it("passes other routes to the next handler", async () => {
  expect((await fetch(`${base}/somewhere-else`)).status).toBe(404);
});
