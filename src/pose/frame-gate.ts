/** A repeated video frame is not evidence that a person has left the picture. */
export class FrameGate {
  private videoTime: number | null = null;
  private advancedAt: number | null = null;
  reset(): void { this.videoTime = null; this.advancedAt = null; }
  inspect(videoTime: number, timestamp: number, ready: boolean): "fresh" | "waiting" | "stale" {
    if (this.advancedAt === null) this.advancedAt = timestamp;
    if (ready && Number.isFinite(videoTime) && videoTime !== this.videoTime) {
      this.videoTime = videoTime;
      this.advancedAt = timestamp;
      return "fresh";
    }
    return timestamp - this.advancedAt >= 500 ? "stale" : "waiting";
  }
}
