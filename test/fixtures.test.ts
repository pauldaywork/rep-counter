import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replayCount } from "../src/recording";
import { isSetRecording } from "../src/store-schema";

// Real sets saved from the "Save set data" button on either page. Each must
// still detect the rep count the user said they did.
const dirs = [new URL("./fixtures/", import.meta.url), new URL("../data-routine/fixtures/", import.meta.url)];
const files = dirs.flatMap((dir) =>
  existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => new URL(name, dir)) : [],
);

/** Sets whose entered count the user wasn't sure of, so they can't score the detector. */
const UNSURE = new Set([
  "set-2026-10-17T08-10-24-181Z.json",
  "set-2026-10-17T08-13-31-060Z.json",
  "set-2026-10-17T08-13-32-766Z.json",
  "set-2026-10-17T08-13-36-636Z.json",
  "set-2026-10-21T05-03-25-921Z.json",
]);

/**
 * Sets the detector still gets wrong, and why. Each is expected to fail, so
 * fixing one fails the test until it is taken off this list.
 */
const KNOWN_WRONG: Record<string, string> = {
  "set-2026-10-17T08-29-11-576Z.json": "counts setup breaths before the rows start",
  "set-2026-10-17T08-30-47-670Z.json": "counts a setup breath before the hip thrusts start",
  "set-2026-10-21T05-19-16-393Z.json": "rejects a soft, short rep as a spike, near its peak for 192 ms",
  "set-2026-10-21T05-21-30-350Z.json": "misses a rep, perhaps among the noise before the reps start",
  "set-2026-10-21T05-25-12-424Z.json": "misses a rep: a quiet one under 1 s, or a long one rejected as low-frequency",
  "set-2026-10-21T05-27-24-675Z.json": "counts a setup noise and misses a quiet rep under 1 s and one more",
  "set-2026-10-21T05-35-31-989Z.json": "counts two short setup noises around the first rep",
  "set-2026-10-22T05-52-04-736Z.json": "loud low-pitched noise for most of the set buries the reps",
};

function check(file: URL): void {
  const recording: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isSetRecording(recording)) throw new Error(`${file.pathname} is not a valid set recording`);
  expect(replayCount(recording)).toBe(recording.actualCount);
}

describe("recorded sets", () => {
  const scored = files.filter((file) => !UNSURE.has(name(file)));
  if (scored.length === 0) {
    it.skip("no sets recorded yet", () => {});
    return;
  }

  for (const file of scored) {
    const why = KNOWN_WRONG[name(file)];
    if (why) it.fails(`${name(file)} detects the actual rep count (known wrong: ${why})`, () => check(file));
    else it(`${name(file)} detects the actual rep count`, () => check(file));
  }
});

function name(file: URL): string {
  return file.pathname.split("/").pop() ?? "";
}
