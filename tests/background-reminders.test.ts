import { describe, expect, it } from "vitest";
import { PostureMonitor, type MonitorInput } from "../src/pose/state-machine";

const config = { driftDurationMs: 3_000, stillDurationMs: 5_000, cooldownMs: 2_000, movementThreshold: 0.06 };
const frame = (timestamp: number, overrides: Partial<MonitorInput> = {}): MonitorInput =>
  ({ timestamp, hasPose: true, drifted: true, motion: 0, ...overrides });
function feed(monitor: PostureMonitor, start: number, end: number, overrides: Partial<MonitorInput> = {}) {
  let output = monitor.update(frame(start, overrides));
  for (let timestamp = start + 100; timestamp <= end; timestamp += 100) output = monitor.update(frame(timestamp, overrides));
  return output;
}

describe("reminder eligibility after background and quiet periods", () => {
  it("collects drift during quiet time and checks the current posture when reminders resume", () => {
    const monitor = new PostureMonitor(config);
    expect(feed(monitor, 0, 3_500, { remindersAllowed: false }).reminder).toBeNull();
    expect(monitor.update(frame(3_600)).reminder).toBe("drift");
  });

  it("discards a queued deviation after recovery during quiet time", () => {
    const monitor = new PostureMonitor(config);
    expect(feed(monitor, 0, 3_000).reminder).toBe("drift");
    feed(monitor, 3_100, 5_200, { remindersAllowed: false, drifted: false, motion: 0.1 });
    expect(monitor.update(frame(5_300, { drifted: false, motion: 0.1 })).reminder).toBeNull();
  });

  it("expires pending drift on recovery and observation loss", () => {
    const monitor = new PostureMonitor(config);
    feed(monitor, 0, 3_000);
    expect(monitor.update(frame(3_100, { drifted: false })).reminder).toBeNull();
    expect(monitor.update(frame(3_200)).reminder).toBe("drift");
    expect(monitor.update(frame(3_300, { hasPose: false })).reminder).toBeNull();
    expect(monitor.update(frame(9_000)).reminder).toBeNull();
  });

  it("expires pending stillness as soon as movement is observed", () => {
    const monitor = new PostureMonitor(config);
    expect(feed(monitor, 0, 5_000, { drifted: false }).reminder).toBe("still");
    expect(monitor.update(frame(5_100, { drifted: false, motion: 0.1 })).reminder).toBeNull();
  });

  it("accumulates observed intervals at one frame per second", () => {
    const monitor = new PostureMonitor(config);
    for (let timestamp = 0; timestamp <= 3_000; timestamp += 1_000) {
      const result = monitor.update(frame(timestamp));
      expect(result.driftElapsedMs).toBe(timestamp);
      expect(result.reminder).toBe(timestamp === 3_000 ? "drift" : null);
    }
  });
});
