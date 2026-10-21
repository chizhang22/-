import type { MonitorState } from "./types";

export interface MonitorConfig {
  driftDurationMs: number;
  stillDurationMs: number;
  cooldownMs: number;
  movementThreshold: number;
}

export interface MonitorInput {
  timestamp: number;
  hasPose: boolean;
  drifted: boolean;
  motion: number;
  driftKind?: string;
  driftScore?: number;
  remindersAllowed?: boolean;
}

export interface MonitorOutput {
  state: MonitorState;
  reminder: "drift" | "still" | null;
  driftProgress: number;
  stillProgress: number;
  observedDrift: boolean;
  driftElapsedMs: number;
  cooldownRemainingMs: number;
}

export const normalConfig: MonitorConfig = {
  driftDurationMs: 30_000,
  stillDurationMs: 30 * 60_000,
  cooldownMs: 5 * 60_000,
  movementThreshold: 0.06,
};

export const demoConfig: MonitorConfig = {
  driftDurationMs: 6_000,
  stillDurationMs: 20_000,
  cooldownMs: 12_000,
  movementThreshold: 0.012,
};

const LOSS_GRACE_MS = 1_500;
const RECOVERY_DWELL_MS = 2_000;
const ENTRY_DWELL_MS = 800;

export class PostureMonitor {
  private driftElapsedMs = 0;
  private stillElapsedMs = 0;
  private recoveryElapsedMs = 0;
  private observedDrift = false;
  private previousDeviation = false;
  private previousRecovery = false;
  private previousVisible = false;
  private lastTimestamp: number | null = null;
  private lossStartedAt: number | null = null;
  private cooldownUntil = 0;
  private paused = false;
  private pendingReminder: MonitorOutput["reminder"] = null;

  constructor(private config: MonitorConfig) {}

  setConfig(config: MonitorConfig, timestamp = performance.now()): void {
    this.config = config;
    this.reset(timestamp);
  }

  private clearObservation(): void {
    this.pendingReminder = null;
    this.driftElapsedMs = 0;
    this.stillElapsedMs = 0;
    this.recoveryElapsedMs = 0;
    this.observedDrift = false;
    this.previousDeviation = false;
    this.previousRecovery = false;
    this.previousVisible = false;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.clearObservation();
    this.lastTimestamp = null;
    this.lossStartedAt = null;
    this.pendingReminder = null;
  }

  reset(_timestamp: number): void {
    this.clearObservation();
    this.lastTimestamp = null;
    this.lossStartedAt = null;
    this.cooldownUntil = 0;
    this.paused = false;
    this.pendingReminder = null;
  }

  resolveReminder(timestamp: number): void {
    this.pendingReminder = null;
    this.cooldownUntil = timestamp + this.config.cooldownMs;
    // Acknowledging a reminder does not establish a new posture or a physical break.
  }

  cancelPendingReminder(): void {
    this.pendingReminder = null;
  }

  update(input: MonitorInput): MonitorOutput {
    const { timestamp, hasPose, motion } = input;
    if (this.paused) return this.output("paused", null, timestamp);
    const gap = this.lastTimestamp === null ? 0 : Math.max(0, timestamp - this.lastTimestamp);
    if (gap > LOSS_GRACE_MS) this.clearObservation();
    const elapsed = this.previousVisible && hasPose && gap <= LOSS_GRACE_MS ? gap : 0;
    this.lastTimestamp = timestamp;

    if (!hasPose) {
      this.pendingReminder = null;
      if (this.lossStartedAt === null) this.lossStartedAt = timestamp;
      if (timestamp - this.lossStartedAt > LOSS_GRACE_MS) this.clearObservation();
      this.previousVisible = false;
      this.previousRecovery = false;
      this.recoveryElapsedMs = 0;
      return this.output("not-visible", null, timestamp);
    }
    if (this.lossStartedAt !== null && timestamp - this.lossStartedAt > LOSS_GRACE_MS) {
      this.clearObservation();
    }
    this.lossStartedAt = null;

    const deviation = input.drifted || (this.observedDrift && (input.driftScore ?? 0) >= 0.8);
    if (deviation) {
      if (this.observedDrift && this.previousDeviation) this.driftElapsedMs += elapsed;
      this.observedDrift = true;
      this.recoveryElapsedMs = 0;
    } else if (this.observedDrift) {
      if (this.driftElapsedMs < ENTRY_DWELL_MS) {
        this.observedDrift = false;
        this.driftElapsedMs = 0;
      }
      if (this.previousRecovery) this.recoveryElapsedMs += elapsed;
      if (this.recoveryElapsedMs >= RECOVERY_DWELL_MS) {
        this.observedDrift = false;
        this.driftElapsedMs = 0;
        this.recoveryElapsedMs = 0;
      }
    }
    this.previousRecovery = !deviation;
    this.previousDeviation = deviation;
    this.previousVisible = true;
    this.stillElapsedMs = motion >= this.config.movementThreshold ? 0 : this.stillElapsedMs + elapsed;

    // Reminder eligibility follows the current observation, not an earlier queued event.
    if (input.remindersAllowed === false
      || (this.pendingReminder === "drift" && !deviation)
      || (this.pendingReminder === "still" && motion >= this.config.movementThreshold)) {
      this.pendingReminder = null;
    }

    if (input.remindersAllowed === false) {
      return this.output(this.observedDrift ? "drift-pending" : "monitoring", null, timestamp);
    }

    if (this.pendingReminder) {
      return this.output(this.pendingReminder === "drift" ? "reminder-drift" : "reminder-still", this.pendingReminder, timestamp);
    }
    if (timestamp < this.cooldownUntil) return this.output("cooldown", null, timestamp);
    if (this.observedDrift && deviation && this.driftElapsedMs >= this.config.driftDurationMs) {
      this.pendingReminder = "drift";
      return this.output("reminder-drift", "drift", timestamp);
    }
    if (this.stillElapsedMs >= this.config.stillDurationMs) {
      this.pendingReminder = "still";
      return this.output("reminder-still", "still", timestamp);
    }
    return this.output(this.observedDrift ? "drift-pending" : "monitoring", null, timestamp);
  }

  private output(state: MonitorState, reminder: MonitorOutput["reminder"], timestamp: number): MonitorOutput {
    return {
      state, reminder,
      driftProgress: Math.min(1, this.driftElapsedMs / this.config.driftDurationMs),
      stillProgress: Math.min(1, this.stillElapsedMs / this.config.stillDurationMs),
      observedDrift: this.observedDrift && this.driftElapsedMs >= ENTRY_DWELL_MS,
      driftElapsedMs: this.driftElapsedMs,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - timestamp),
    };
  }
}
