import { describe, expect, it } from "vitest";
import { PostureMonitor, normalConfig, type MonitorInput } from "../src/pose/state-machine";

const config = { driftDurationMs: 3_000, stillDurationMs: 20_000, cooldownMs: 2_000, movementThreshold: 0.01 };
function frame(timestamp: number, overrides: Partial<MonitorInput> = {}): MonitorInput {
  return { timestamp, hasPose: true, drifted: true, motion: 0, ...overrides };
}
function feed(monitor: PostureMonitor, start: number, end: number, overrides: Partial<MonitorInput> = {}) {
  let result = monitor.update(frame(start, overrides));
  for (let time = start + 100; time <= end; time += 100) result = monitor.update(frame(time, overrides));
  return result;
}

describe("posture monitor", () => {
  it("defaults to a 30-second reminder while showing a stable change within one second", () => {
    const monitor = new PostureMonitor(normalConfig);
    expect(feed(monitor, 0, 700).observedDrift).toBe(false);
    const live = monitor.update(frame(800));
    expect(live.observedDrift).toBe(true);
    expect(live.reminder).toBeNull();
    expect(feed(monitor, 900, 29_900).reminder).toBeNull();
    expect(monitor.update(frame(30_000)).reminder).toBe("drift");
  });

  it("retains duration when deviation categories alternate", () => {
    const monitor = new PostureMonitor(config);
    for (let time = 0; time < 3_000; time += 100) {
      expect(monitor.update(frame(time, { driftKind: time % 200 ? "side" : "lower" })).reminder).toBeNull();
    }
    expect(monitor.update(frame(3_000, { driftKind: "torso" })).reminder).toBe("drift");
  });

  it("still reminds after repeated brief losses and changing classifications", () => {
    const monitor = new PostureMonitor(normalConfig);
    let result = monitor.update(frame(0));
    for (let time = 100; time <= 31_000; time += 100) {
      result = monitor.update(frame(time, {
        hasPose: time < 10_000 || time % 10_000 >= 200,
        driftKind: time % 200 ? "lower" : "side",
      }));
    }
    expect(result.reminder).toBe("drift");
    expect(result.driftElapsedMs).toBe(30_100);
  });

  it("filters an isolated entry spike", () => {
    const monitor = new PostureMonitor(config);
    feed(monitor, 0, 300);
    const settled = monitor.update(frame(400, { drifted: false, driftScore: 0.3 }));
    expect(settled.observedDrift).toBe(false);
    expect(settled.driftElapsedMs).toBe(0);
  });

  it("retains a confirmed segment through threshold jitter and pauses recovery time", () => {
    const monitor = new PostureMonitor(config);
    feed(monitor, 0, 1_000);
    const boundary = feed(monitor, 1_100, 1_500, { drifted: false, driftScore: 0.9 });
    expect(boundary.driftElapsedMs).toBe(1_500);
    const recovery = feed(monitor, 1_600, 1_800, { drifted: false, driftScore: 0.3 });
    expect(recovery.observedDrift).toBe(true);
    expect(recovery.driftElapsedMs).toBe(1_500);
    const resumed = feed(monitor, 1_900, 3_400);
    expect(resumed.reminder).toBe("drift");
  });

  it("ends a segment after two seconds of continuous recovery", () => {
    const monitor = new PostureMonitor(config);
    feed(monitor, 0, 1_000);
    expect(feed(monitor, 1_100, 3_000, { drifted: false }).observedDrift).toBe(true);
    const recovered = monitor.update(frame(3_100, { drifted: false }));
    expect(recovered.observedDrift).toBe(false);
    expect(recovered.driftElapsedMs).toBe(0);
    expect(feed(monitor, 3_200, 4_000).reminder).toBeNull();
  });

  it("keeps duration over a short observation loss and excludes missing time", () => {
    const monitor = new PostureMonitor(config);
    feed(monitor, 0, 1_000);
    expect(monitor.update(frame(1_100, { hasPose: false })).state).toBe("not-visible");
    monitor.update(frame(1_500, { hasPose: false }));
    expect(monitor.update(frame(1_600)).driftElapsedMs).toBe(1_000);
    expect(feed(monitor, 1_700, 3_500).reminder).toBeNull();
    expect(monitor.update(frame(3_600)).reminder).toBe("drift");
  });

  it("resets after prolonged loss even when missing samples keep arriving", () => {
    const monitor = new PostureMonitor(config);
    feed(monitor, 0, 1_000);
    feed(monitor, 1_100, 3_000, { hasPose: false });
    const result = monitor.update(frame(3_100));
    expect(result.driftElapsedMs).toBe(0);
    expect(result.observedDrift).toBe(false);
  });

  it("rejects unobserved time after a long gap or pause", () => {
    const monitor = new PostureMonitor(config);
    feed(monitor, 0, 1_000);
    expect(monitor.update(frame(20_000)).driftElapsedMs).toBe(0);
    monitor.setPaused(true);
    expect(monitor.update(frame(40_000)).state).toBe("paused");
    monitor.setPaused(false);
    expect(monitor.update(frame(60_000)).reminder).toBeNull();
  });

  it("continues live posture updates during a reminder and cooldown", () => {
    const monitor = new PostureMonitor(config);
    expect(feed(monitor, 0, 3_000).reminder).toBe("drift");
    monitor.resolveReminder(3_000);
    const during = monitor.update(frame(3_100));
    expect(during.state).toBe("cooldown");
    expect(during.observedDrift).toBe(true);
    expect(during.driftElapsedMs).toBe(3_100);
    expect(during.cooldownRemainingMs).toBe(1_900);
    expect(during.reminder).toBeNull();
    expect(feed(monitor, 3_200, 4_900).reminder).toBeNull();
    expect(monitor.update(frame(5_000)).reminder).toBe("drift");
    expect(feed(monitor, 5_100, 7_100, { drifted: false }).observedDrift).toBe(false);
  });

  it("counts stillness only across observed intervals and resets it on movement", () => {
    const monitor = new PostureMonitor({ ...config, stillDurationMs: 2_000 });
    feed(monitor, 0, 1_000, { drifted: false });
    monitor.update(frame(1_100, { drifted: false, motion: 0.1 }));
    expect(feed(monitor, 1_200, 3_000, { drifted: false }).reminder).toBeNull();
    expect(monitor.update(frame(3_100, { drifted: false })).reminder).toBe("still");
  });
});
