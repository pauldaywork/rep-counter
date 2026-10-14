import { describe, expect, it } from "vitest";
import { RepSet } from "../src/rep-set";

describe("RepSet", () => {
  it("counts up to the target and is then complete", () => {
    const set = new RepSet(2);
    set.add(1);
    expect(set).toMatchObject({ count: 1, complete: false });
    set.add(1);
    expect(set).toMatchObject({ count: 2, complete: true });
  });

  it("does not count past the target", () => {
    const set = new RepSet(1);
    set.add(1);
    set.add(1);
    expect(set.count).toBe(1);
  });

  it("does not go below zero", () => {
    const set = new RepSet(3);
    set.add(-1);
    expect(set.count).toBe(0);
  });

  it("rejects a target that is not a whole number of at least 1", () => {
    expect(() => new RepSet(0)).toThrow(RangeError);
    expect(() => new RepSet(2.5)).toThrow(RangeError);
  });
});
