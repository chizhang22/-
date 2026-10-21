export interface BlinkSummary {
  blinkCount: number;
  validMinutes: number;
  blinksPerMinute: number | null;
  baselineRate: number | null;
  lowBlinkWindows: number;
  showRestSuggestion: boolean;
}

interface MinuteWindow {
  validMs: number;
  blinks: number;
}

export interface BlinkMonitorSnapshot {
  version: 1;
  blinkCount: number;
  validMs: number;
  currentWindow: MinuteWindow;
  windows: MinuteWindow[];
}

export class BlinkMonitor {
  private blinkCount = 0;
  private eyeState: "open" | "closed" | "unknown" = "unknown";
  private closedAt: number | null = null;
  private lastTimestamp: number | null = null;
  private validMs = 0;
  private currentWindow: MinuteWindow = { validMs: 0, blinks: 0 };
  private windows: MinuteWindow[] = [];

  reset(): void {
    this.blinkCount = 0;
    this.eyeState = "unknown";
    this.closedAt = null;
    this.lastTimestamp = null;
    this.validMs = 0;
    this.currentWindow = { validMs: 0, blinks: 0 };
    this.windows = [];
  }

  update(timestamp: number, leftBlink: number, rightBlink: number, confidence = 1): void {
    if (!Number.isFinite(timestamp) || !Number.isFinite(leftBlink) || !Number.isFinite(rightBlink)
      || !Number.isFinite(confidence) || confidence < 0.55) {
      this.interrupt();
      return;
    }

    if (this.lastTimestamp !== null) {
      const gap = timestamp - this.lastTimestamp;
      const delta = gap >= 0 && gap <= 250 ? gap : 0;
      if (!delta) { this.eyeState = "unknown"; this.closedAt = null; }
      this.validMs += delta;
      this.currentWindow.validMs += delta;
    }
    this.lastTimestamp = timestamp;

    const average = (leftBlink + rightBlink) / 2;
    const isClosed = average >= 0.58 && Math.min(leftBlink, rightBlink) >= 0.35;
    const isOpen = average <= 0.28;

    // Reacquire an open eye after a gap before accepting a complete blink cycle.
    if (this.eyeState === "unknown" && isOpen) this.eyeState = "open";

    if (this.eyeState === "open" && isClosed) {
      this.eyeState = "closed";
      this.closedAt = timestamp;
    } else if (this.eyeState === "closed" && isOpen) {
      const duration = this.closedAt === null ? 0 : timestamp - this.closedAt;
      if (duration >= 60 && duration <= 850) {
        this.blinkCount += 1;
        this.currentWindow.blinks += 1;
      }
      this.eyeState = "open";
      this.closedAt = null;
    }

    // Windows use valid observation time. Switching apps preserves partial windows;
    // sparse intervals contribute neither time nor inferred blink events.
    if (this.currentWindow.validMs >= 60_000) {
      this.windows.push(this.currentWindow);
      if (this.windows.length > 240) this.windows.splice(2, 1);
      this.currentWindow = { validMs: 0, blinks: 0 };
    }
  }

  interrupt(): void {
    this.lastTimestamp = null;
    this.eyeState = "unknown";
    this.closedAt = null;
  }

  snapshot(): BlinkMonitorSnapshot {
    return {
      version: 1,
      blinkCount: this.blinkCount,
      validMs: this.validMs,
      currentWindow: { ...this.currentWindow },
      windows: this.windows.map((window) => ({ ...window })),
    };
  }

  restore(snapshot: unknown): boolean {
    if (!snapshot || typeof snapshot !== "object") return false;
    const data = snapshot as Partial<BlinkMonitorSnapshot>;
    const validNumber = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
    const validWindow = (value: unknown): value is MinuteWindow => {
      if (!value || typeof value !== "object") return false;
      const window = value as MinuteWindow;
      return validNumber(window.validMs) && window.validMs <= 60_250
        && validNumber(window.blinks) && Number.isInteger(window.blinks);
    };
    if (data.version !== 1 || !validNumber(data.blinkCount) || !Number.isInteger(data.blinkCount)
      || !validNumber(data.validMs) || !validWindow(data.currentWindow)
      || !Array.isArray(data.windows) || data.windows.length > 240 || !data.windows.every(validWindow)) return false;
    this.blinkCount = data.blinkCount;
    this.validMs = data.validMs;
    this.currentWindow = { ...data.currentWindow };
    this.windows = data.windows.map((window) => ({ ...window }));
    this.interrupt();
    return true;
  }

  summary(): BlinkSummary {
    const completeWindows = [...this.windows];
    if (this.currentWindow.validMs >= 45_000) completeWindows.push(this.currentWindow);

    const usableRates = completeWindows
      .filter((window) => window.validMs >= 45_000)
      .map((window) => window.blinks / (window.validMs / 60_000));
    const baselineRates = usableRates.slice(0, 2);
    const baselineRate = baselineRates.length >= 2
      ? baselineRates.reduce((total, rate) => total + rate, 0) / baselineRates.length
      : null;
    const laterRates = baselineRate === null ? [] : usableRates.slice(2);
    const lowBlinkWindows = baselineRate === null
      ? 0
      : laterRates.filter((rate) => rate < baselineRate * 0.55).length;
    const validMinutes = this.validMs / 60_000;

    return {
      blinkCount: this.blinkCount,
      validMinutes,
      blinksPerMinute: validMinutes >= 0.5 ? this.blinkCount / validMinutes : null,
      baselineRate,
      lowBlinkWindows,
      showRestSuggestion: validMinutes >= 3 && lowBlinkWindows >= 2,
    };
  }
}
