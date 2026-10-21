import { afterEach, describe, expect, it, vi } from "vitest";
import { ObservationScheduler } from "../src/pose/observation-scheduler";

afterEach(() => vi.useRealTimers());
describe("independent observation clock", () => {
  it("samples hidden pages without animation callbacks and cancels on stop", () => {
    vi.useFakeTimers(); let hidden = false;
    const sample = vi.fn(), error = vi.fn();
    const scheduler = new ObservationScheduler(sample, () => hidden, error);
    scheduler.start(); vi.advanceTimersByTime(160);
    expect(sample).toHaveBeenCalledTimes(3);
    hidden = true; scheduler.wake(); vi.advanceTimersByTime(1000);
    expect(sample).toHaveBeenCalledTimes(9);
    scheduler.stop(); vi.advanceTimersByTime(1000);
    expect(sample).toHaveBeenCalledTimes(9);
    expect(error).not.toHaveBeenCalled();
  });
  it("keeps one timer across repeated wakes and offers recovery after errors", () => {
    vi.useFakeTimers(); const error = vi.fn();
    const sample = vi.fn().mockImplementationOnce(() => { throw new Error("camera lost"); });
    const scheduler = new ObservationScheduler(sample, () => false, error);
    scheduler.start(); scheduler.wake(); scheduler.wake(); vi.advanceTimersByTime(1000);
    expect(error).toHaveBeenCalledTimes(1); expect(sample).toHaveBeenCalledTimes(1);
    scheduler.start(); vi.advanceTimersByTime(80);
    expect(sample).toHaveBeenCalledTimes(3); scheduler.stop();
  });
});
