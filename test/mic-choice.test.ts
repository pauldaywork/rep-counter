import { describe, expect, it } from "vitest";
import { pickMic } from "../src/mic-choice";

describe("pickMic", () => {
  const labels = ["Laptop mic", "Headset (Bluetooth)"];

  it("keeps the current choice while it is connected", () => {
    expect(pickMic(labels, "Laptop mic", "Headset (Bluetooth)")).toBe("Laptop mic");
  });

  it("falls back to the last used mic", () => {
    expect(pickMic(labels, "Gone mic", "Headset (Bluetooth)")).toBe("Headset (Bluetooth)");
    expect(pickMic(labels, null, "Headset (Bluetooth)")).toBe("Headset (Bluetooth)");
  });

  it("falls back to the first mic", () => {
    expect(pickMic(labels, null, "Gone mic")).toBe("Laptop mic");
  });

  it("returns null when there are no mics", () => {
    expect(pickMic([], "Laptop mic", "Laptop mic")).toBeNull();
  });
});
