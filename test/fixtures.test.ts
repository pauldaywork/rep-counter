import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replayCount } from "../src/recording";
import { isSetRecording } from "../src/store-schema";

// Real sets saved from the page's "Save set data" button. Each must still
// detect the rep count the user said they did.
const dir = new URL("./fixtures/", import.meta.url);
const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : [];

describe("recorded sets", () => {
  if (files.length === 0) {
    it.skip("no sets recorded yet", () => {});
    return;
  }

  it.each(files)("%s detects the actual rep count", (name) => {
    const recording: unknown = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    if (!isSetRecording(recording)) throw new Error(`${name} is not a valid set recording`);
    expect(replayCount(recording)).toBe(recording.actualCount);
  });
});
