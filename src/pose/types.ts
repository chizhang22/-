export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PostureFeatures {
  shoulderTilt: number;
  headOffsetX: number;
  headOffsetY: number;
  torsoLeanX: number;
  bodyScale: number;
  confidence: number;
  hasHips: boolean;
  shoulderCenterX?: number;
  shoulderCenterY?: number;
  headRoll?: number;
  shoulderDepth?: number;
}

export interface Baseline {
  mean: PostureFeatures;
  spread: PostureFeatures;
  sampleCount: number;
}

export type MonitorState =
  | "idle"
  | "not-visible"
  | "monitoring"
  | "drift-pending"
  | "reminder-drift"
  | "reminder-still"
  | "cooldown"
  | "paused";
