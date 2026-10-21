import { describe, expect, it } from "vitest";
import { describeObservation, type ObservationView } from "../src/ui/observation-view";
const base: ObservationView = { running: true, paused: false, background: false, timer: false, demo: false, calibrated: true, calibrating: false, valid: true, hasHips: false, changes: ["side"], position: "stable", elapsedMs: 1500, thresholdMs: 30000, cooldownMs: 0, quiet: false, reminderVisible: false };
describe("live observation copy", () => {
  it("shows actual observation in background and a recovery action after failures", () => {
    const hidden=describeObservation({...base,background:true});
    expect(hidden.title).toContain("倾斜"); expect(hidden.reason).toContain("后台正在采样");
    expect(hidden.quality).toContain("头肩可见");
    expect(describeObservation({...base,failed:true}).reason).toContain("重新连接");
  });
  it("continues showing observed change during cooldown and quiet hours", () => {
    expect(describeObservation({...base,cooldownMs:10000}).title).toBe("头肩向一侧倾斜");
    expect(describeObservation({...base,cooldownMs:10000}).reason).toContain("缓冲");
    expect(describeObservation({...base,quiet:true}).reason).toContain("免打扰");
  });
  it("keeps body translation descriptive and distinguishes missing observation", () => {
    expect(describeObservation({...base,changes:[],position:"left"}).title).toContain("位置变了");
    expect(describeObservation({...base,valid:false}).title).toBe("画面待恢复");
    expect(describeObservation({...base,timer:true}).duration).toBe("—");
  });
});
