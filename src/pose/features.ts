import type { Baseline, Landmark, PostureFeatures } from "./types";

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

const required = [NOSE, LEFT_SHOULDER, RIGHT_SHOULDER] as const;

function point(landmarks: Landmark[], index: number): Landmark | undefined {
  return landmarks[index];
}

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

/** A shoulder line has no direction; reversed landmark ordering describes the same line. */
function shoulderLineAngle(left: Landmark, right: Landmark): number {
  const degrees = Math.atan2(right.y - left.y, right.x - left.x) * 180 / Math.PI;
  return ((degrees + 90) % 180 + 180) % 180 - 90;
}

function visible(landmark: Landmark | undefined, threshold = 0.55): landmark is Landmark {
  return Boolean(landmark && (landmark.visibility ?? 1) >= threshold);
}

export function extractPostureFeatures(landmarks: Landmark[]): PostureFeatures | null {
  if (required.some((index) => !visible(point(landmarks, index)))) return null;

  const nose = point(landmarks, NOSE)!;
  const leftShoulder = point(landmarks, LEFT_SHOULDER)!;
  const rightShoulder = point(landmarks, RIGHT_SHOULDER)!;
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const shoulderWidth = Math.max(distance(leftShoulder, rightShoulder), 0.03);

  const leftHip = point(landmarks, LEFT_HIP);
  const rightHip = point(landmarks, RIGHT_HIP);
  const hasHips = visible(leftHip, 0.45) && visible(rightHip, 0.45);
  const hipMid = hasHips ? midpoint(leftHip, rightHip) : null;
  const leftEar = point(landmarks, 7);
  const rightEar = point(landmarks, 8);
  const hasEars = visible(leftEar) && visible(rightEar) && distance(leftEar, rightEar) > 0.02;

  const visibilityValues = [nose, leftShoulder, rightShoulder]
    .concat(hasHips ? [leftHip, rightHip] : [])
    .map((landmark) => landmark.visibility ?? 1);

  return {
    shoulderTilt: shoulderLineAngle(leftShoulder, rightShoulder),
    headOffsetX: (nose.x - shoulderMid.x) / shoulderWidth,
    headOffsetY: (nose.y - shoulderMid.y) / shoulderWidth,
    torsoLeanX: hipMid ? (shoulderMid.x - hipMid.x) / shoulderWidth : 0,
    bodyScale: shoulderWidth,
    confidence:
      visibilityValues.reduce((total, value) => total + value, 0) / visibilityValues.length,
    hasHips,
    shoulderCenterX: shoulderMid.x,
    shoulderCenterY: shoulderMid.y,
    headRoll: hasEars ? shoulderLineAngle(leftEar, rightEar) : undefined,
    shoulderDepth: (rightShoulder.z - leftShoulder.z) / shoulderWidth,
  };
}

const featureKeys: Array<keyof Pick<
  PostureFeatures,
  "shoulderTilt" | "headOffsetX" | "headOffsetY" | "torsoLeanX" | "bodyScale" |
  "shoulderCenterX" | "shoulderCenterY" | "headRoll" | "shoulderDepth"
>> = ["shoulderTilt", "headOffsetX", "headOffsetY", "torsoLeanX", "bodyScale",
  "shoulderCenterX", "shoulderCenterY", "headRoll", "shoulderDepth"];

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function availableValues(samples: PostureFeatures[], key: typeof featureKeys[number]): number[] {
  return samples.filter(sample => key !== "torsoLeanX" || sample.hasHips)
    .map(sample => sample[key]).filter((value): value is number => value !== undefined && Number.isFinite(value));
}

export function validateBaseline(samples: PostureFeatures[]): { valid: boolean; reason: string | null } {
  if (samples.length < 20) return { valid: false, reason: "请让头部和双肩完整进入画面，继续记录几秒" };
  const bounds: Partial<Record<typeof featureKeys[number], number>> = {
    shoulderTilt: 8, headOffsetX: 0.16, headOffsetY: 0.16,
    torsoLeanX: 0.16, shoulderCenterX: 0.06, shoulderCenterY: 0.06, headRoll: 10,
  };
  for (const [key, limit] of Object.entries(bounds)) {
    const values = availableValues(samples, key as typeof featureKeys[number]).sort((a, b) => a - b);
    if (values.length < samples.length / 2) continue;
    const span = values[Math.floor((values.length - 1) * 0.9)]! - values[Math.floor((values.length - 1) * 0.1)]!;
    if (span > limit) return { valid: false, reason: "刚才身体或摄像头有些晃动，请保持舒服姿态重新记录" };
  }
  const widths = availableValues(samples, "bodyScale").sort((a, b) => a - b);
  if (widths[Math.floor((widths.length - 1) * 0.9)]! / widths[Math.floor((widths.length - 1) * 0.1)]! > 1.15) {
    return { valid: false, reason: "记录时与摄像头的距离变化较大，请坐稳后重新记录" };
  }
  return { valid: true, reason: null };
}

export function createBaseline(samples: PostureFeatures[]): Baseline {
  if (samples.length < 3) throw new Error("至少需要 3 个有效样本才能建立基线");

  const mean = { ...samples[0]! };
  for (const key of featureKeys) {
    const values = availableValues(samples, key);
    if (values.length) mean[key] = median(values);
  }
  mean.confidence = samples.reduce((sum, sample) => sum + sample.confidence, 0) / samples.length;
  mean.hasHips = samples.filter((sample) => sample.hasHips).length >= samples.length / 2;

  const spread = { ...mean };
  for (const key of featureKeys) {
    const values = availableValues(samples, key);
    if (values.length) spread[key] = 1.4826 * median(values.map(value => Math.abs(value - mean[key]!)));
  }
  spread.confidence = 0;
  spread.hasHips = mean.hasHips;

  return { mean, spread, sampleCount: samples.length };
}

export interface DeviationResult {
  score: number;
  drifted: boolean;
  cause: "closer" | "side" | "lower" | "torso" | "turn" | "stable";
  activeCauses: Array<Exclude<DeviationResult["cause"], "stable">>;
  position: "left" | "right" | "stable";
  scores: Record<Exclude<DeviationResult["cause"], "stable">, number>;
}

function adaptiveThreshold(spread: number | undefined, minimum: number): number {
  return Math.max(minimum, Math.min((spread ?? 0) * 3, minimum * 1.5));
}

function angleDifference(a: number, b: number): number {
  return Math.abs(((a - b + 90) % 180 + 180) % 180 - 90);
}

export function compareWithBaseline(
  current: PostureFeatures,
  baseline: Baseline,
): DeviationResult {
  const mean = baseline.mean;
  const spread = baseline.spread;

  const closer = Math.max(0, Math.log(current.bodyScale / mean.bodyScale)) /
    adaptiveThreshold(spread.bodyScale / Math.max(mean.bodyScale, 0.01), 0.11);
  const side = Math.abs(current.headOffsetX - mean.headOffsetX) /
    adaptiveThreshold(spread.headOffsetX, 0.16);
  const lower = Math.max(0, current.headOffsetY - mean.headOffsetY) /
    adaptiveThreshold(spread.headOffsetY, 0.16);
  const shoulder = angleDifference(current.shoulderTilt, mean.shoulderTilt) /
    adaptiveThreshold(spread.shoulderTilt, 8);
  const headRoll = current.headRoll !== undefined && mean.headRoll !== undefined
    ? angleDifference(current.headRoll, mean.headRoll) / adaptiveThreshold(spread.headRoll, 10) : 0;
  const torso = current.hasHips && mean.hasHips
    ? Math.abs(current.torsoLeanX - mean.torsoLeanX) / adaptiveThreshold(spread.torsoLeanX, 0.16)
    : 0;

  // Width shrink alone also occurs when moving the chair away; require depth evidence.
  const narrowed = Math.max(0, 1 - current.bodyScale / mean.bodyScale) / 0.12;
  const depthChange = current.shoulderDepth !== undefined && mean.shoulderDepth !== undefined
    ? Math.abs(current.shoulderDepth - mean.shoulderDepth) / adaptiveThreshold(spread.shoulderDepth, 0.45) : 0;
  const turn = Math.min(narrowed, depthChange);
  const values = { closer, side: Math.max(side, shoulder, headRoll), lower, torso, turn };
  const centerChange = current.shoulderCenterX !== undefined && mean.shoulderCenterX !== undefined
    ? (current.shoulderCenterX - mean.shoulderCenterX) / Math.max(mean.bodyScale, 0.03) : 0;
  const [cause, score] = Object.entries(values).reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    ["stable", 0] as [string, number],
  );

  return {
    score,
    drifted: score >= 1,
    cause: score >= 1 ? cause as DeviationResult["cause"] : "stable",
    activeCauses: (Object.keys(values) as Array<Exclude<DeviationResult["cause"], "stable">>).filter(key => values[key] >= 1),
    position: Math.abs(centerChange) < 0.3 ? "stable" : centerChange < 0 ? "left" : "right",
    scores: values,
  };
}

export function calculateMotion(
  previous: Landmark[] | null,
  current: Landmark[],
): number {
  if (!previous) return 0;
  const indices = [0, 11, 12, 23, 24];
  const leftShoulder = current[LEFT_SHOULDER];
  const rightShoulder = current[RIGHT_SHOULDER];
  if (!leftShoulder || !rightShoulder) return 0;
  const scale = Math.max(distance(leftShoulder, rightShoulder), 0.03);

  const movements = indices.flatMap((index) => {
    const before = previous[index];
    const after = current[index];
    if (!before || !after || (before.visibility ?? 1) < 0.55 || (after.visibility ?? 1) < 0.55) return [];
    return [distance(before, after) / scale];
  });

  return movements.length
    ? movements.reduce((sum, value) => sum + value, 0) / movements.length
    : 0;
}

/** Compare a smooth recent posture with a one-second anchor; keep a bounded window. */
export class PostureMotionWindow {
  private samples: Array<{ timestamp: number; points: Landmark[] }> = [];
  private smoothed: Landmark[] | null = null;
  reset(): void { this.samples = []; this.smoothed = null; }
  update(timestamp: number, points: Landmark[]): number {
    if (this.samples.length && timestamp - this.samples[this.samples.length - 1]!.timestamp > 500) this.reset();
    const previous = this.smoothed;
    this.smoothed = points.map((point, index) => ({ ...point,
      x: previous?.[index] ? previous[index]!.x * 0.75 + point.x * 0.25 : point.x,
      y: previous?.[index] ? previous[index]!.y * 0.75 + point.y * 0.25 : point.y,
    }));
    this.samples.push({ timestamp, points: this.smoothed });
    while (this.samples.length > 1 && this.samples[1]!.timestamp < timestamp - 1_000) this.samples.shift();
    return calculateMotion(this.samples[0]!.points, this.smoothed);
  }
}

export function armsRaised(landmarks: Landmark[]): boolean {
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const leftShoulder = landmarks[LEFT_SHOULDER];
  const rightShoulder = landmarks[RIGHT_SHOULDER];
  if (![leftWrist, rightWrist, leftShoulder, rightShoulder].every((p) => visible(p, 0.45))) {
    return false;
  }
  return leftWrist!.y < leftShoulder!.y - 0.035 && rightWrist!.y < rightShoulder!.y - 0.035;
}
