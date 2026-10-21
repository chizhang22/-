import { describe, expect, it } from "vitest";
import { isQuiet, SessionLedger, type RuntimePreferences } from "../src/session";

describe("session data accounting", () => {
  it("keeps focus time separate from observation and paused time", () => {
    const session = new SessionLedger("camera", 0);
    session.tick(1_000, true);
    session.tick(10_000, false);
    session.tick(11_000, true);
    session.observe(0, true, "closer", false);
    session.observe(100, true, "closer", false);
    session.observe(200, false, "stable", false);
    session.observe(10_000, true, "closer", false);
    session.observe(10_100, true, "closer", false);
    expect(session.durationMs).toBe(2_000);
    expect(session.validPoseMs).toBe(200);
    expect(session.forwardMs).toBe(200);
    expect(session.stillLongestMs).toBe(100);
  });

  it("rejects long observation gaps and never infers data for timer sessions", () => {
    const session = new SessionLedger("timer", 0);
    session.tick(60_000, true);
    const saved = session.summary(1, 0, 0, 0);
    expect(saved.durationMs).toBe(60_000);
    expect(saved.validPoseMs).toBe(0);
    expect(saved.mode).toBe("timer");
    session.observe(1, true, "lower", false);
    session.observe(10_000, true, "lower", false);
    expect(session.validPoseMs).toBe(0);
  });
});

describe("quiet hours", () => {
  const prefs: RuntimePreferences = { reminderMinutes: 30, driftMinutes: 5, snoozeUntil: null, quietHours: [{ start: "22:00", end: "07:00" }], fontScale: 1 };
  it("supports overnight ranges and their boundaries", () => {
    expect(isQuiet(prefs, new Date(2026, 9, 17, 23))).toBe(true);
    expect(isQuiet(prefs, new Date(2026, 9, 17, 6))).toBe(true);
    expect(isQuiet(prefs, new Date(2026, 9, 17, 7))).toBe(false);
    expect(isQuiet(prefs, new Date(2026, 9, 17, 12))).toBe(false);
  });
  it("applies temporary snooze independently", () => {
    const now = new Date(2026, 9, 17, 12);
    expect(isQuiet({ ...prefs, snoozeUntil: new Date(now.getTime() + 1_000).toISOString() }, now)).toBe(true);
  });
});
