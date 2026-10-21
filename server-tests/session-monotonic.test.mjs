import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';

const base = { id: 'same-session', mode: 'camera', startAt: '2026-10-18T00:00:00.000Z', endAt: '2026-10-18T00:01:00.000Z', durationMs: 60000, validPoseMs: 30000, forwardMs: 10000, lowerMs: 2000, sideMs: 15000, turnMs: 1000, torsoMs: 2000, stillLongestMs: 15000, validEyeMs: 20000, reminders: 2, movements: 3, blinkCount: 8 };
const newer = { ...base, endAt: '2026-10-18T00:02:00.000Z', durationMs: 120000, validPoseMs: 60000, sideMs: 25000 };

test('reversed completion order keeps the newer summary and repeated saves stay idempotent', () => {
  const store = createStore();
  try {
    const latest = store.session(newer);
    assert.deepEqual(store.session(base), latest);
    assert.deepEqual(store.session(newer), latest);
    assert.deepEqual(store.get('sessions', base.id), latest);
    assert.equal(store.list('sessions').length, 1);
  } finally { store.close(); }
});

test('session identity is immutable and conflicting writers receive 409', () => {
  const store = createStore();
  try {
    const saved = store.session(base);
    for (const changes of [{ mode: 'timer' }, { startAt: '2026-10-18T00:00:01.000Z' }]) {
      assert.throws(() => store.session({ ...base, ...changes }), error => error.status === 409);
    }
    assert.deepEqual(store.get('sessions', base.id), saved);
  } finally { store.close(); }
});

test('every accumulated counter and end timestamp independently protect against rollback', () => {
  const store = createStore();
  try {
    const saved = store.session(newer);
    for (const key of ['durationMs','validPoseMs','forwardMs','lowerMs','sideMs','turnMs','torsoMs','stillLongestMs','validEyeMs','reminders','movements','blinkCount']) {
      assert.deepEqual(store.session({ ...newer, [key]: newer[key] - 1 }), saved, key);
    }
    assert.deepEqual(store.session({ ...newer, endAt: base.endAt }), saved);
    assert.deepEqual(store.get('sessions', base.id), saved);
  } finally { store.close(); }
});

test('older clients preserve optional recorded fields and stale shorter payloads remain harmless', () => {
  const store = createStore();
  try {
    const saved = store.session(newer);
    const { sideMs, turnMs, torsoMs, ...oldClient } = newer;
    const updated = store.session({ ...oldClient, endAt: '2026-10-18T00:03:00.000Z', durationMs: 180000 });
    assert.equal(updated.sideMs, sideMs);
    assert.equal(updated.turnMs, turnMs);
    assert.equal(updated.torsoMs, torsoMs);
    assert.equal(updated.durationMs, 180000);
    const stale = { ...oldClient, durationMs: 60000, validPoseMs: 20000, stillLongestMs: 15000 };
    assert.deepEqual(store.session(stale), updated);
    assert.notDeepEqual(updated, saved);
  } finally { store.close(); }
});
