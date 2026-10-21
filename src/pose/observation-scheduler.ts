/** Observation has its own clock: hidden pages often stop animation callbacks.
 * Browsers may still throttle/freeze timers; consumers must reject stale frames.
 */
export class ObservationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  constructor(private readonly sample: (now: number) => void,
    private readonly hidden: () => boolean,
    private readonly onError: (error: unknown) => void) {}

  start(): void { this.active = true; this.wake(); }
  stop(): void {
    this.active = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  wake(): void {
    if (!this.active) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 0);
  }
  private run(): void {
    this.timer = null;
    if (!this.active) return;
    try { this.sample(performance.now()); }
    catch (error) { this.stop(); this.onError(error); return; }
    if (this.active) this.timer = setTimeout(() => this.run(), this.hidden() ? 200 : 80);
  }
}
