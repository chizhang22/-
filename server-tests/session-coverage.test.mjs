import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';

const session = (id, extra = {}) => ({ id, mode: 'camera', startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date().toISOString(), durationMs: 60000, validPoseMs: 30000, ...extra });

test('old fields remain absent; new feature ratios only use sessions that recorded them', () => {
  const store = createStore();
  try {
    const old = store.session(session('old'));
    assert.equal(Object.hasOwn(old, 'sideMs'), false);
    const oldTrends = store.trends();
    assert.equal(oldTrends.sideMs, null);
    assert.equal(oldTrends.sideRatio, null);
    assert.deepEqual(oldTrends.postureCoverage.side, { observedSessionCount: 0, validPoseMs: 0 });
    store.session(session('new', { sideMs: 15000, turnMs: 0, torsoMs: 10000 }));
    store.session(session('demo', { mode: 'demo', sideMs: 30000 }));
    const trends = store.trends();
    assert.equal(trends.sessionCount, 2);
    assert.equal(trends.sideMs, 15000);
    assert.equal(trends.sideRatio, .5);
    assert.equal(trends.turnMs, 0);
    assert.equal(trends.turnRatio, 0);
    assert.equal(trends.observationCoverage, .5);
    assert.deepEqual(trends.postureCoverage.side, { observedSessionCount: 1, validPoseMs: 30000 });
    assert.equal(Object.hasOwn(store.get('sessions', 'old'), 'sideMs'), false);
  } finally { store.close(); }
});

test('new posture fields validate separately and may legitimately overlap', () => {
  const store = createStore();
  try {
    assert.throws(() => store.session(session('bad', { sideMs: 31000 })), /姿态时长/);
    assert.throws(() => store.session(session('negative', { turnMs: -1 })), /数值/);
    const value = store.session(session('overlap', { sideMs: 30000, turnMs: 30000, torsoMs: 30000 }));
    assert.equal(value.sideMs, 30000);
    store.session(session('empty', { mode: 'timer', validPoseMs: 0, sideMs: 0, turnMs: 0, torsoMs: 0 }));
    assert.equal(store.trends().postureCoverage.side.observedSessionCount, 1);
  } finally { store.close(); }
});
