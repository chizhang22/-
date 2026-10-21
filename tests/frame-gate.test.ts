import { describe, expect, it } from "vitest";
import { FrameGate } from "../src/pose/frame-gate";

describe("video freshness", () => {
  it("skips duplicate frames without reporting a person missing", () => {
    const gate = new FrameGate();
    expect(gate.inspect(1, 0, true)).toBe("fresh");
    expect(gate.inspect(1, 80, true)).toBe("waiting");
    expect(gate.inspect(1.1, 160, true)).toBe("fresh");
    expect(gate.inspect(1.1, 240, true)).toBe("waiting");
  });
  it("marks stalled or unready video unknown after a grace period", () => {
    const gate = new FrameGate();
    expect(gate.inspect(0, 0, false)).toBe("waiting");
    expect(gate.inspect(0, 500, false)).toBe("stale");
    expect(gate.inspect(1, 600, true)).toBe("fresh");
    expect(gate.inspect(1, 1100, true)).toBe("stale");
    gate.reset();
    expect(gate.inspect(1, 1200, true)).toBe("fresh");
  });
});
