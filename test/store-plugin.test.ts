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

it("passes other routes to the next handler", async () => {
  expect((await fetch(`${base}/somewhere-else`)).status).toBe(404);
});
