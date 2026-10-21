import { describe, expect, it } from "vitest";
import { PostureMonitor, normalConfig } from "../src/pose/state-machine";
import { SessionLedger } from "../src/session";
import { FrameGate } from "../src/pose/frame-gate";
describe("background observation integration", () => {
  it("accumulates fresh 1Hz frames into both deviation and historical counters", () => {
    const monitor=new PostureMonitor(normalConfig), ledger=new SessionLedger("camera",0), frames=new FrameGate();
    let last;
    for(let time=0;time<=31000;time+=1000) {
      ledger.tick(time,true);
      const valid=frames.inspect(time/1000,time,true)==="fresh";
      ledger.observe(time,valid,"side",false,["side","turn"]);
      last=monitor.update({timestamp:time,hasPose:valid,drifted:true,motion:0});
    }
    expect(last?.reminder).toBe("drift"); expect(last?.driftElapsedMs).toBe(31000);
    expect(ledger.sideMs).toBe(31000); expect(ledger.turnMs).toBe(31000); expect(ledger.validPoseMs).toBe(31000);
  });
  it("does not count frozen video or long scheduling gaps as observed deviation", () => {
    const monitor=new PostureMonitor(normalConfig), ledger=new SessionLedger("camera",0), frames=new FrameGate();
    for(let time=0;time<=30000;time+=1000) {
      ledger.tick(time,true);
      const valid=frames.inspect(0,time,true)==="fresh";
      ledger.observe(time,valid,"side",false);
      monitor.update({timestamp:time,hasPose:valid,drifted:true,motion:0});
    }
    expect(ledger.validPoseMs).toBe(0); expect(ledger.durationMs).toBe(30000);
    const resumed=monitor.update({timestamp:90000,hasPose:true,drifted:true,motion:0});
    expect(resumed.driftElapsedMs).toBe(0); expect(resumed.reminder).toBeNull();
  });
});
