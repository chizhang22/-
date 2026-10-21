import { describe, expect, it } from "vitest";
import {
  compareWithBaseline,
  createBaseline,
  extractPostureFeatures,
  calculateMotion,
  PostureMotionWindow,
  validateBaseline,
} from "../src/pose/features";
import type { Landmark, PostureFeatures } from "../src/pose/types";

function landmarks(offsetX = 0, scale = 1): Landmark[] {
  const result = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  result[0] = { x: 0.5 + offsetX, y: 0.24, z: 0, visibility: 1 };
  result[11] = { x: 0.4 - (scale - 1) * 0.1, y: 0.42, z: 0, visibility: 1 };
  result[12] = { x: 0.6 + (scale - 1) * 0.1, y: 0.42, z: 0, visibility: 1 };
  result[23] = { x: 0.44, y: 0.72, z: 0, visibility: 1 };
  result[24] = { x: 0.56, y: 0.72, z: 0, visibility: 1 };
  return result;
}

describe("posture features", () => {
  it("separates whole-body translation from an actionable posture deviation", () => {
    const base = extractPostureFeatures(landmarks())!;
    const baseline = createBaseline([base, base, base]);
    const translated = landmarks().map(point => ({ ...point, x: point.x + 0.1 }));
    const result = compareWithBaseline(extractPostureFeatures(translated)!, baseline);
    expect(result.position).toBe("right");
    expect(result.drifted).toBe(false);
    expect(result.activeCauses).toEqual([]);
  });

  it("requires shoulder depth evidence along with width shrink to flag turning", () => {
    const base = extractPostureFeatures(landmarks())!;
    const baseline = createBaseline([base, base, base]);
    const away = { ...base, bodyScale: base.bodyScale * 0.75 };
    expect(compareWithBaseline(away, baseline).cause).toBe("stable");
    expect(compareWithBaseline({ ...away, shoulderDepth: 0.8 }, baseline).cause).toBe("turn");
  });

  it("observes ear-line tilt with hips outside the frame", () => {
    const pose = landmarks();
    pose[7] = { x: 0.45, y: 0.25, z: 0, visibility: 1 };
    pose[8] = { x: 0.55, y: 0.25, z: 0, visibility: 1 };
    pose[23]!.visibility = 0;
    pose[24]!.visibility = 0;
    const base = extractPostureFeatures(pose)!;
    const baseline = createBaseline([base, base, base]);
    pose[8]!.y += 0.04;
    const current = extractPostureFeatures(pose)!;
    expect(current.hasHips).toBe(false);
    expect(compareWithBaseline(current, baseline).activeCauses).toContain("side");
  });

  it("rejects unstable calibration while resisting isolated outliers", () => {
    const base = extractPostureFeatures(landmarks())!;
    const stable = Array.from({ length: 30 }, () => ({ ...base }));
    stable[3]!.shoulderTilt = 30;
    expect(validateBaseline(stable).valid).toBe(true);
    const baseline = createBaseline(stable);
    expect(baseline.mean.shoulderTilt).toBe(0);
    expect(compareWithBaseline({ ...base, shoulderTilt: 12 }, baseline).drifted).toBe(true);
    const shifting = stable.map((sample, index) => ({ ...sample, shoulderTilt: index % 2 ? 15 : -15 }));
    expect(validateBaseline(shifting).valid).toBe(false);
  });
  it("smooths small pose jitter while detecting a slow whole-body adjustment", () => {
    const motion = new PostureMotionWindow();
    let largestJitter = 0;
    for (let step = 0; step < 30; step++) {
      const points = landmarks().map(point => ({ ...point, x: point.x + (step % 2 ? 0.0005 : -0.0005) }));
      largestJitter = Math.max(largestJitter, motion.update(step * 80, points));
    }
    expect(largestJitter).toBeLessThan(0.06);
    motion.reset();
    let movement = 0;
    for (let step = 0; step < 30; step++) {
      const points = landmarks().map(point => ({ ...point, x: point.x + step * 0.002 }));
      movement = motion.update(step * 80, points);
    }
    expect(movement).toBeGreaterThan(0.06);
  });
  it("keeps reversed shoulder ordering continuous around a horizontal line", () => {
    const samples = [-0.0001, 0.0001, -0.0001, 0.0001].map(offset => {
      const pose = landmarks();
      pose[11] = { x: 0.6, y: 0.42, z: 0, visibility: 1 };
      pose[12] = { x: 0.4, y: 0.42 + offset, z: 0, visibility: 1 };
      return extractPostureFeatures(pose)!;
    });
    const baseline = createBaseline(samples);
    expect(Math.abs(baseline.mean.shoulderTilt)).toBeLessThan(0.1);
    expect(baseline.spread.shoulderTilt).toBeLessThan(0.1);
    for (const sample of samples) {
      expect(compareWithBaseline(sample, baseline).drifted).toBe(false);
      expect(compareWithBaseline(sample, baseline).cause).toBe("stable");
    }
  });
  it("ignores wrist and elbow motion when evaluating stillness", () => {
    const original = landmarks();
    const changed = landmarks();
    for (const index of [13, 14, 15, 16]) changed[index]!.x += 0.3;
    expect(calculateMotion(original, changed)).toBe(0);
  });

  it("does not label moving farther away or raising the head as closer or lower", () => {
    const base = extractPostureFeatures(landmarks())!;
    const baseline = createBaseline([base, base, base]);
    expect(compareWithBaseline({ ...base, bodyScale: base.bodyScale * 0.7 }, baseline).cause).toBe("stable");
    expect(compareWithBaseline({ ...base, headOffsetY: base.headOffsetY - 0.3 }, baseline).cause).toBe("stable");
    expect(compareWithBaseline({ ...base, bodyScale: base.bodyScale * 1.3 }, baseline).cause).toBe("closer");
    expect(compareWithBaseline({ ...base, headOffsetY: base.headOffsetY + 0.3 }, baseline).cause).toBe("lower");
  });
  it("extracts normalized upper-body features", () => {
    const features = extractPostureFeatures(landmarks());
    expect(features).not.toBeNull();
    expect(features!.bodyScale).toBeCloseTo(0.2);
    expect(features!.headOffsetX).toBeCloseTo(0);
    expect(features!.hasHips).toBe(true);
  });

  it("rejects frames without visible shoulders", () => {
    const pose = landmarks();
    pose[11]!.visibility = 0.1;
    expect(extractPostureFeatures(pose)).toBeNull();
  });

  it("compares a shifted pose with a personal baseline", () => {
    const base = extractPostureFeatures(landmarks())!;
    const samples: PostureFeatures[] = Array.from({ length: 20 }, (_, index) => ({
      ...base,
      headOffsetX: base.headOffsetX + (index % 2 ? 0.004 : -0.004),
    }));
    const baseline = createBaseline(samples);
    const shifted = extractPostureFeatures(landmarks(0.08))!;
    const result = compareWithBaseline(shifted, baseline);
    expect(result.drifted).toBe(true);
    expect(result.cause).toBe("side");
  });
});
