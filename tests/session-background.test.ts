import { describe, expect, it } from 'vitest';
import { SessionLedger } from '../src/session';
import { recordedDuration } from '../src/agent-panel';

describe('background session accounting and checkpoints', () => {
  it('accepts one-second observations and tracks concurrent causes independently', () => {
    const ledger = new SessionLedger('camera', 0);
    ledger.tick(3000, true);
    for (const timestamp of [0, 1000, 2000, 3000]) ledger.observe(timestamp, true, 'side', false, ['side', 'turn', 'torso']);
    expect(ledger.summary(0, 0, 0, 0)).toMatchObject({ validPoseMs: 3000, sideMs: 3000, turnMs: 3000, torsoMs: 3000, forwardMs: 0 });
  });

  it('excludes long gaps and interrupted observations', () => {
    const ledger = new SessionLedger('camera', 0);
    ledger.observe(0, true, 'side', false);
    ledger.observe(1500, true, 'side', false);
    ledger.observe(3001, true, 'side', false);
    ledger.observe(4001, false, 'side', false);
    ledger.observe(5001, true, 'side', false);
    ledger.observe(6001, true, 'side', false);
    expect(ledger.validPoseMs).toBe(2500);
    expect(ledger.sideMs).toBe(2500);
  });

  it('preserves identity and aggregate data while excluding time spent closed', () => {
    const ledger = new SessionLedger('camera', 0);
    ledger.tick(2000, true);
    ledger.observe(0, true, 'side', false);
    ledger.observe(1000, true, 'side', false);
    const snapshot = ledger.snapshot();
    const restored = SessionLedger.restore(JSON.parse(JSON.stringify(snapshot)), 500_000)!;
    expect(restored.snapshot()).toEqual(snapshot);
    restored.tick(501_000, true);
    restored.observe(501_000, true, 'side', false);
    expect(restored.durationMs).toBe(3000);
    expect(restored.validPoseMs).toBe(1000);
    restored.observe(502_000, true, 'side', false);
    expect(restored.sideMs).toBe(2000);
    expect(Object.keys(snapshot)).toEqual(['version','id','startAt','mode','durationMs','validPoseMs','forwardMs','lowerMs','sideMs','turnMs','torsoMs','stillLongestMs']);
  });

  it('rejects corrupted checkpoints and inconsistent counters', () => {
    const ledger = new SessionLedger('camera', 0);
    expect(SessionLedger.restore(null, 0)).toBeNull();
    expect(SessionLedger.restore({ ...ledger.snapshot(), mode: 'other' }, 0)).toBeNull();
    expect(SessionLedger.restore({ ...ledger.snapshot(), durationMs: -1 }, 0)).toBeNull();
    expect(SessionLedger.restore({ ...ledger.snapshot(), validPoseMs: 1000 }, 0)).toBeNull();
    expect(SessionLedger.restore({ ...ledger.snapshot(), sideMs: 1000 }, 0)).toBeNull();
  });

  it('shows missing old fields distinctly from recorded zeroes', () => {
    expect(recordedDuration(undefined)).toBe('未记录');
    expect(recordedDuration(null)).toBe('未记录');
    expect(recordedDuration(0)).toBe('0.0 分钟');
    expect(recordedDuration(60000)).toBe('1.0 分钟');
  });
});
