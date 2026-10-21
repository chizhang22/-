import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { createAgent, readConfig } from '../server/agent.mjs';
import { createApp } from '../server/index.mjs';

const sample = (overrides = {}) => ({ id: 'session-1', startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date().toISOString(), durationMs: 60000, validPoseMs: 30000, forwardMs: 10000, lowerMs: 5000, stillLongestMs: 20000, reminders: 1, movements: 1, blinkCount: 6, validEyeMs: 30000, mode: 'camera', ...overrides });
test('new profiles use a 30-second posture threshold and preserve saved custom preferences on reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zbx-preferences-test-')); const dbPath = join(dir, 'test.sqlite');
  let store = createStore(dbPath);
  try {
    assert.equal(store.preferences().driftMinutes, 0.5);
    const saved = store.updatePreferences({ driftMinutes: 2.75, reminderMinutes: 45, quietHours: [{ start: '22:00', end: '08:00' }], fontScale: 1.15 });
    store.close(); store = createStore(dbPath);
    assert.deepEqual(store.preferences(), saved);
    for (const threshold of [0.25, 0.5, 1, 5]) {
      assert.deepEqual(store.updatePreferences({ driftMinutes: threshold }), { ...saved, driftMinutes: threshold });
    }
    assert.throws(() => store.updatePreferences({ driftMinutes: 0.1 }), /数值/);
    assert.throws(() => store.updatePreferences({ driftMinutes: 31 }), /数值/);
    store.close(); store = createStore(dbPath);
    assert.deepEqual(store.preferences(), { ...saved, driftMinutes: 5 });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('persistent records, facts remain nullable, edits invalidate derived memory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zbx-db-test-')); const dbPath = join(dir, 'test.sqlite');
  let store = createStore(dbPath);
  try {
    store.session(sample()); const f = store.feedback({ text: '右肩有点酸', sessionId: 'session-1' });
    assert.equal(f.intensity, null); assert.equal(f.area, null);
    store.memory({ text: '肩部不适', kind: 'pattern', sourceIds: [f.id] });
    store.editFeedback(f.id, { text: '右肩现在舒服了' }); assert.equal(store.list('memories').length, 0);
    store.close(); store = createStore(dbPath); assert.equal(store.get('feedback', f.id).text, '右肩现在舒服了');
    assert.equal(store.list('sessions').length, 1);
    store.deleteFeedback(f.id); assert.equal(store.get('feedback', f.id), null);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('statistics exclude demo and use only effective observation denominator', () => {
  const store = createStore();
  try {
    store.session(sample()); store.session(sample({ id: 'demo', mode: 'demo', forwardMs: 30000 }));
    store.feedback({ text: '演示时的一条记录', sessionId: 'demo' }); assert.equal(store.history().feedback.length, 0);
    const result = store.trends(); assert.equal(result.sessionCount, 1); assert.equal(result.forwardRatio, 1 / 3); assert.equal(result.blinkPerMinute, 12);
    assert.throws(() => store.session(sample({ id: 'bad', validPoseMs: 70000 })), /本次时长/);
    assert.throws(() => store.session(sample({ id: 'bad', forwardMs: 40000 })), /有效观察/);
  } finally { store.close(); }
});
test('feedback can link to active session, corrections remove stale agent context and dependent memory', () => {
  const store = createStore();
  try {
    const msg = store.message('user', '今天右肩酸');
    const feedback = store.feedback({ text: '今天右肩酸', sessionId: 'active-session' });
    store.put('feedback', { ...feedback, sourceMessageId: msg.id });
    store.memory({ text: '肩部感受', kind: 'pattern', sourceIds: [msg.id] });
    store.message('assistant', '已记录右肩酸。');
    assert.equal(store.get('sessions', 'active-session'), null);
    store.session(sample({ id: 'active-session' })); assert.equal(store.get('feedback', feedback.id).sessionId, 'active-session');
    store.editFeedback(feedback.id, { text: '实际是左肩酸' });
    assert.equal(store.contextMessages().length, 0); assert.equal(store.list('memories').length, 0);
    assert.equal(store.get('messages', msg.id).content, '身体感受已由用户修订：实际是左肩酸');
    store.deleteFeedback(feedback.id); assert.equal(store.get('messages', msg.id).content, '这条身体感受已由用户删除。');
  } finally { store.close(); }
});
test('preference proposals need confirmation, undo checks concurrent changes', () => {
  const store = createStore();
  try {
    const action = store.propose({ reminderMinutes: 40 }, '少打扰一点');
    assert.equal(store.preferences().reminderMinutes, 30);
    assert.equal(store.action(action.id).preferences.reminderMinutes, 40);
    assert.equal(store.action(action.id, true).preferences.reminderMinutes, 30);
    const second = store.propose({ reminderMinutes: 50 }, '调整'); store.action(second.id); store.updatePreferences({ reminderMinutes: 60 });
    assert.throws(() => store.action(second.id, true), /发生变化/);
    assert.throws(() => store.updatePreferences({ quietHours: [{ start: '25:00', end: '13:00' }] }), /HH:mm/);
    assert.throws(() => store.updatePreferences({ reminderMinutes: 0 }), /数值/);
  } finally { store.close(); }
});
test('live tool loop saves original feeling and creates confirmed-only settings proposal', async () => {
  const store = createStore(); let requests = 0;
  const fakeFetch = async (_url, options) => {
    requests++; const body = JSON.parse(options.body); assert.equal(body.model, 'test-model');
    return { ok: true, json: async () => requests === 1 ? { content: [
      { type: 'tool_use', id: 'a', name: 'save_feedback', input: { quote: '今天右肩酸', area: '右肩', intensity: 8 } },
      { type: 'tool_use', id: 'b', name: 'update_preferences', input: { changes: { reminderMinutes: 40 }, reason: '用户请求' } }
    ] } : { content: [{ type: 'text', text: '已记下右肩感受，提醒设置请点击确认。' }] } };
  };
  try {
    const agent = createAgent(store, readConfig({ ANTHROPIC_AUTH_TOKEN: 'test-secret', ZBX_MODEL: 'test-model' }), fakeFetch);
    const result = await agent.chat({ message: '今天右肩酸，提醒改为40分钟', consent: true });
    assert.equal(result.mode, 'live'); assert.equal(requests, 2); assert.equal(result.actions.length, 1);
    assert.equal(store.list('feedback')[0].text, '今天右肩酸，提醒改为40分钟'); assert.equal(store.list('feedback')[0].intensity, null);
    assert.equal(store.preferences().reminderMinutes, 30); assert.equal(agent.health().connected, true);
    assert.ok(!JSON.stringify(agent.health()).includes('test-secret'));
  } finally { store.close(); }
});
test('tool provenance and missing service fail honestly without synthetic reply', async () => {
  const store = createStore();
  try {
    const agent = createAgent(store, readConfig({}));
    await assert.rejects(agent.chat({ message: '你好' }), /确认/);
    const result = await agent.chat({ message: '今天右肩酸', consent: true }); assert.equal(result.mode, 'unavailable'); assert.equal(store.list('feedback').length, 0);
    await assert.rejects(agent.toolCall('remember_preference', { quote: '喜欢声音' }, '喜欢安静', null, 'm1'), /逐字/);
    await assert.rejects(agent.toolCall('save_feedback', { quote: '肩膀痛' }, '我今天感觉很好', null, 'm2'), /原话/);
    assert.equal(readConfig({ ANTHROPIC_BASE_URL: 'http://remote.example', ANTHROPIC_AUTH_TOKEN: 'x' }).configured, false);
  } finally { store.close(); }
});
test('OpenAI-compatible GLM tool loop preserves transient reasoning and uses function tool messages', async () => {
  const store = createStore(); let requests = 0;
  const config = readConfig({ ZBX_API_PROTOCOL: 'openai', ZBX_BASE_URL: 'https://example.test/v1/', ZBX_API_KEY: 'new-provider-key', ZBX_MODEL: 'GLM-5.3', ANTHROPIC_AUTH_TOKEN: 'old-key', ANTHROPIC_BASE_URL: 'https://old.test' });
  const fakeFetch = async (url, options) => {
    requests++; const body = JSON.parse(options.body);
    assert.equal(url, 'https://example.test/v1/chat/completions'); assert.equal(body.model, 'GLM-5.3');
    assert.equal(options.headers.authorization, 'Bearer new-provider-key'); assert.equal(options.headers['x-api-key'], undefined);
    assert.equal(body.messages[0].role, 'system'); assert.equal(body.tools[0].type, 'function'); assert.equal(body.tools[0].function.parameters.type, 'object');
    if (requests === 1) return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'private-test-reasoning', tool_calls: [
      { id: 'call-a', type: 'function', function: { name: 'save_feedback', arguments: JSON.stringify({ quote: '今天右肩酸', area: '右肩' }) } },
      { id: 'call-b', type: 'function', function: { name: 'get_trends', arguments: '{"days":7}' } }
    ] } }] }) };
    const assistant = body.messages.find(m => m.tool_calls); assert.equal(assistant.reasoning_content, 'private-test-reasoning');
    const toolMessages = body.messages.filter(m => m.role === 'tool'); assert.equal(toolMessages.length, 2);
    assert.equal(toolMessages[0].tool_call_id, 'call-a'); assert.equal(JSON.parse(toolMessages[0].content).area, '右肩');
    assert.equal(toolMessages[1].tool_call_id, 'call-b'); assert.equal(JSON.parse(toolMessages[1].content).sessionCount, 0);
    return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: '已记下今天右肩的感受。', reasoning_content: 'private-final-reasoning' } }] }) };
  };
  try {
    const agent = createAgent(store, config, fakeFetch); const result = await agent.chat({ message: '今天右肩酸，帮我记录并看看最近情况', consent: true });
    assert.equal(result.mode, 'live'); assert.equal(requests, 2); assert.equal(agent.health().protocol, 'openai');
    assert.equal(store.list('feedback').length, 1);
    assert.ok(!JSON.stringify(result).includes('private-')); assert.ok(!JSON.stringify(store.exportData()).includes('private-'));
    assert.equal(readConfig({ ZBX_API_PROTOCOL: 'openai', ANTHROPIC_AUTH_TOKEN: 'old-key' }).configured, false);
  } finally { store.close(); }
});
test('HTTP rejects hostile origins, invalid bodies and supports record CRUD', async () => {
  const store = createStore(); const { server } = createApp({ store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/dashboard`, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${base}/api/dashboard`, { headers: { Origin: 'http://localhost:9999' } })).status, 403);
    assert.equal((await fetch(`${base}/api/dashboard`, { headers: { Origin: 'http://127.0.0.1:4174' } })).status, 200);
    assert.equal((await fetch(`${base}/api/feedback`, { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'bad' })).status, 400);
    const response = await fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '眼睛有点累' }) });
    assert.equal(response.status, 201); const record = await response.json();
    const dash = await (await fetch(`${base}/api/dashboard`)).json(); assert.equal(dash.feedback[0].text, '眼睛有点累');
    assert.equal((await fetch(`${base}/api/feedback/${record.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await (await fetch(`${base}/api/export`)).json()).feedback.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
