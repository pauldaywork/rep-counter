import { describe, expect, it } from "vitest";
import { pickMic } from "../src/mic-choice";

describe("pickMic", () => {
  const labels = ["Laptop mic", "Headset (Bluetooth)"];

  it("prefers the last used mic over the current one", () => {
    expect(pickMic(labels, "Laptop mic", "Headset (Bluetooth)")).toBe("Headset (Bluetooth)");
    expect(pickMic(labels, "Gone mic", "Headset (Bluetooth)")).toBe("Headset (Bluetooth)");
    expect(pickMic(labels, null, "Headset (Bluetooth)")).toBe("Headset (Bluetooth)");
  });

  it("keeps the current choice when the last used mic is absent", () => {
    expect(pickMic(labels, "Headset (Bluetooth)", "Gone mic")).toBe("Headset (Bluetooth)");
    expect(pickMic(labels, "Headset (Bluetooth)", undefined)).toBe("Headset (Bluetooth)");
  });

  it("falls back to the first mic", () => {
    expect(pickMic(labels, null, "Gone mic")).toBe("Laptop mic");
  });

  it("returns null when there are no mics", () => {
    expect(pickMic([], "Laptop mic", "Laptop mic")).toBeNull();
  });
});
