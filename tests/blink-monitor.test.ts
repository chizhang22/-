import { describe, expect, it } from "vitest";
import { BlinkMonitor } from "../src/eye/blink-monitor";

function addBlink(monitor: BlinkMonitor, timestamp: number): number {
  monitor.update(timestamp, 0.05, 0.05, 1);
  monitor.update(timestamp + 100, 0.9, 0.88, 1);
  monitor.update(timestamp + 220, 0.05, 0.04, 1);
  return timestamp + 220;
}

describe("blink monitor", () => {
  it("excludes paused and missing-frame intervals from valid time and blink cycles", () => {
    const monitor = new BlinkMonitor();
    monitor.update(0, 0.05, 0.05);
    monitor.update(100, 0.9, 0.9);
    monitor.interrupt();
    monitor.update(20_000, 0.05, 0.05);
    monitor.update(20_100, 0.05, 0.05);
    expect(monitor.summary().blinkCount).toBe(0);
    expect(monitor.summary().validMinutes).toBeCloseTo(200 / 60_000);
    monitor.update(40_000, 0.05, 0.05);
    expect(monitor.summary().validMinutes).toBeCloseTo(200 / 60_000);
  });
  it("counts a complete close-open cycle", () => {
    const monitor = new BlinkMonitor();
    addBlink(monitor, 0);
    expect(monitor.summary().blinkCount).toBe(1);
  });

  it("ignores asymmetric low-confidence samples", () => {
    const monitor = new BlinkMonitor();
    monitor.update(0, 0.05, 0.05, 1);
    monitor.update(100, 0.95, 0.1, 0.15);
    monitor.update(220, 0.05, 0.05, 1);
    expect(monitor.summary().blinkCount).toBe(0);
  });

  it("resets all accumulated values", () => {
    const monitor = new BlinkMonitor();
    addBlink(monitor, 0);
    monitor.reset();
    expect(monitor.summary().blinkCount).toBe(0);
    expect(monitor.summary().validMinutes).toBe(0);
  });

  it("shows one end-of-session suggestion after repeated low-blink windows", () => {
    const monitor = new BlinkMonitor();
    for (let timestamp = 0; timestamp <= 240_000; timestamp += 100) {
      const minute = Math.floor(timestamp / 60_000);
      const interval = minute < 2 ? 5_000 : 30_000;
      const phase = timestamp % interval;
      const blinkScore = phase === 100 ? 0.9 : 0.05;
      monitor.update(timestamp, blinkScore, blinkScore, 1);
    }
    const summary = monitor.summary();
    expect(summary.validMinutes).toBeGreaterThanOrEqual(3.9);
    expect(summary.lowBlinkWindows).toBeGreaterThanOrEqual(2);
    expect(summary.showRestSuggestion).toBe(true);
  });
});
