export type SessionMode = "camera" | "timer" | "demo";

export interface SessionLedgerSnapshot {
  version: 1;
  id: string;
  startAt: string;
  mode: SessionMode;
  durationMs: number;
  validPoseMs: number;
  forwardMs: number;
  lowerMs: number;
  sideMs: number;
  turnMs: number;
  torsoMs: number;
  stillLongestMs: number;
}

const durationFields = ['durationMs', 'validPoseMs', 'forwardMs', 'lowerMs', 'sideMs', 'turnMs', 'torsoMs', 'stillLongestMs'] as const;

export interface RuntimePreferences {
  reminderMinutes: number;
  driftMinutes: number;
  snoozeUntil: string | null;
  quietHours: Array<{ start: string; end: string }>;
  fontScale: number;
}

export function isQuiet(preferences: RuntimePreferences, now = new Date()): boolean {
  if (preferences.snoozeUntil && Date.parse(preferences.snoozeUntil) > now.getTime()) return true;
  const minute = now.getHours() * 60 + now.getMinutes();
  const parse = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return preferences.quietHours.some(({ start, end }) => {
    const from = parse(start), to = parse(end);
    return from === to || (from < to ? minute >= from && minute < to : minute >= from || minute < to);
  });
}

/** Only accepted consecutive observations contribute to observed duration. */
export class SessionLedger {
  readonly id: string;
  readonly startAt: string;
  durationMs = 0;
  validPoseMs = 0;
  forwardMs = 0;
  lowerMs = 0;
  sideMs = 0;
  turnMs = 0;
  torsoMs = 0;
  stillLongestMs = 0;
  private stillMs = 0;
  private lastClock: number;
  private lastPose: number | null = null;
  private previousCauses = new Set<string>();
  private previousMoving = false;

  constructor(readonly mode: SessionMode, timestamp: number, identity?: { id: string; startAt: string }) {
    this.lastClock = timestamp;
    this.id = identity?.id ?? crypto.randomUUID();
    this.startAt = identity?.startAt ?? new Date().toISOString();
  }

  /** A lightweight checkpoint: frames, landmarks and calibration never enter storage. */
  snapshot(): SessionLedgerSnapshot {
    return { version: 1, id: this.id, startAt: this.startAt, mode: this.mode,
      durationMs: this.durationMs, validPoseMs: this.validPoseMs, forwardMs: this.forwardMs,
      lowerMs: this.lowerMs, sideMs: this.sideMs, turnMs: this.turnMs, torsoMs: this.torsoMs,
      stillLongestMs: this.stillLongestMs };
  }

  static restore(input: unknown, timestamp: number): SessionLedger | null {
    if (!input || typeof input !== 'object' || !Number.isFinite(timestamp)) return null;
    const value = input as Partial<SessionLedgerSnapshot>;
    if (value.version !== 1 || typeof value.id !== 'string' || !value.id || value.id.length > 120 ||
      typeof value.startAt !== 'string' || !Number.isFinite(Date.parse(value.startAt)) ||
      !['camera', 'timer', 'demo'].includes(value.mode ?? '')) return null;
    for (const key of durationFields) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key]! < 0 || value[key]! > 86400000) return null;
    if (value.validPoseMs! > value.durationMs! || value.stillLongestMs! > value.validPoseMs! ||
      ['forwardMs', 'lowerMs', 'sideMs', 'turnMs', 'torsoMs'].some(key => Number(value[key as keyof SessionLedgerSnapshot]) > value.validPoseMs!)) return null;
    const ledger = new SessionLedger(value.mode!, timestamp, { id: value.id, startAt: value.startAt });
    for (const key of durationFields) ledger[key] = value[key]!;
    // Resume from a fresh sample pair; the time while the page was closed stays unobserved.
    return ledger;
  }

  tick(timestamp: number, active: boolean): void {
    if (active) this.durationMs += Math.max(0, timestamp - this.lastClock);
    this.lastClock = timestamp;
  }

  interrupt(): void { this.lastPose = null; this.stillMs = 0; this.previousCauses.clear(); }

  observe(timestamp: number, valid: boolean, cause: string, moving: boolean, activeCauses?: readonly string[]): void {
    if (!valid) { this.interrupt(); return; }
    const gap = this.lastPose === null ? 0 : timestamp - this.lastPose;
    const delta = gap >= 0 && gap <= 1500 ? gap : 0;
    const causes = new Set(activeCauses ?? [cause]);
    this.validPoseMs += delta;
    for (const [kind, field] of [['closer', 'forwardMs'], ['lower', 'lowerMs'], ['side', 'sideMs'], ['turn', 'turnMs'], ['torso', 'torsoMs']] as const) {
      if (causes.has(kind) && this.previousCauses.has(kind)) this[field] += delta;
    }
    this.stillMs = moving || this.previousMoving || delta === 0 ? 0 : this.stillMs + delta;
    this.stillLongestMs = Math.max(this.stillLongestMs, this.stillMs);
    this.lastPose = timestamp;
    this.previousCauses = causes;
    this.previousMoving = moving;
  }

  summary(reminders: number, movements: number, blinkCount: number, validEyeMs: number) {
    return { id: this.id, startAt: this.startAt, endAt: new Date().toISOString(), mode: this.mode,
      durationMs: Math.round(this.durationMs), validPoseMs: Math.round(this.validPoseMs),
      forwardMs: Math.round(this.forwardMs), lowerMs: Math.round(this.lowerMs),
      sideMs: Math.round(this.sideMs), turnMs: Math.round(this.turnMs), torsoMs: Math.round(this.torsoMs),
      stillLongestMs: Math.round(this.stillLongestMs), reminders, movements, blinkCount,
      validEyeMs: Math.round(validEyeMs) };
  }
}
