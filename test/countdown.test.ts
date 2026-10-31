import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { countdown } from "../src/countdown";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("ticks the whole seconds left, then finishes when the time is up", async () => {
  const ticks: number[] = [];
  const timer = countdown(3, (left) => ticks.push(left));
  expect(ticks).toEqual([3]);
  await vi.advanceTimersByTimeAsync(2999);
  expect([...new Set(ticks)]).toEqual([3, 2, 1]);
  await vi.advanceTimersByTimeAsync(1);
  await expect(timer.finished).resolves.toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("finishes early, without ticking again, when stopped", async () => {
  const ticks: number[] = [];
  const timer = countdown(60, (left) => ticks.push(left));
  await vi.advanceTimersByTimeAsync(1000);
  timer.stop();
  const ticked = ticks.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(ticks.length).toBe(ticked);
  await expect(timer.finished).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("finishes at once for no time, without ticking or leaving a timer", async () => {
  const ticks: number[] = [];
  const timer = countdown(0, (left) => ticks.push(left));
  await expect(timer.finished).resolves.toBe(true);
  expect(ticks).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("stays finished when stopped after the time is up", async () => {
  const timer = countdown(1, () => {});
  await vi.advanceTimersByTimeAsync(1000);
  timer.stop();
  await expect(timer.finished).resolves.toBe(true);
});
