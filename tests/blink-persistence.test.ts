import { describe, expect, it } from "vitest";
import { BlinkMonitor } from "../src/eye/blink-monitor";

function observe(monitor: BlinkMonitor, start: number, duration: number, blinkEvery = 5_000) {
  for (let offset = 0; offset <= duration; offset += 100) {
    const score = offset % blinkEvery === 100 ? 0.9 : 0.05;
    monitor.update(start + offset, score, score);
  }
}

describe("blink observation coverage and checkpoints", () => {
  it("preserves partial windows across interruptions without counting the missing interval", () => {
    const monitor = new BlinkMonitor();
    observe(monitor, 0, 30_000);
    monitor.interrupt();
    observe(monitor, 90_000, 30_000);
    const snapshot = monitor.snapshot();
    expect(snapshot.validMs).toBe(60_000);
    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.windows[0]?.blinks).toBe(12);
  });

  it("excludes sparse samples from both valid time and low-blink warnings", () => {
    const monitor = new BlinkMonitor();
    observe(monitor, 0, 120_000);
    const before = monitor.summary();
    for (let timestamp = 121_000; timestamp <= 420_000; timestamp += 1_000) {
      monitor.update(timestamp, timestamp % 2_000 ? 0.9 : 0.05, timestamp % 2_000 ? 0.9 : 0.05);
    }
    expect(monitor.summary()).toEqual(before);
    expect(monitor.summary().showRestSuggestion).toBe(false);
  });

  it("requires a fresh complete blink cycle after a missing interval", () => {
    const monitor = new BlinkMonitor();
    monitor.update(0, 0.05, 0.05);
    monitor.update(100, 0.9, 0.9);
    monitor.update(1_000, 0.9, 0.9);
    monitor.update(1_100, 0.05, 0.05);
    expect(monitor.summary().blinkCount).toBe(0);
    monitor.update(1_200, 0.9, 0.9);
    monitor.update(1_300, 0.05, 0.05);
    expect(monitor.summary().blinkCount).toBe(1);
  });

  it("restores scalar observations and windows but never an in-flight blink or clock", () => {
    const monitor = new BlinkMonitor();
    observe(monitor, 0, 75_000);
    monitor.update(75_100, 0.9, 0.9);
    const restored = new BlinkMonitor();
    expect(restored.restore(JSON.parse(JSON.stringify(monitor.snapshot())))).toBe(true);
    expect(restored.summary()).toEqual(monitor.summary());
    restored.update(500_000, 0.05, 0.05);
    expect(restored.summary()).toEqual(monitor.summary());
    restored.update(500_100, 0.05, 0.05);
    expect(restored.summary().validMinutes).toBeCloseTo(monitor.summary().validMinutes + 100 / 60_000);
  });

  it("rejects malformed checkpoints without destroying current observation", () => {
    const monitor = new BlinkMonitor();
    observe(monitor, 0, 1_000);
    const before = monitor.snapshot();
    expect(monitor.restore({ ...before, validMs: -1 })).toBe(false);
    expect(monitor.restore({ ...before, windows: [{ validMs: Infinity, blinks: 1 }] })).toBe(false);
    expect(monitor.snapshot()).toEqual(before);
  });
});
