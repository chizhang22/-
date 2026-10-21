import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const DEFAULT_PREFERENCES = Object.freeze({ reminderMinutes: 30, driftMinutes: 0.5, snoozeUntil: null, quietHours: [], fontScale: 1 });
export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('请提交有效的数据对象'); return value; }
export function shortText(value, max = 4000, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`文本长度应为 1–${max} 字符`);
  return value.trim();
}
function number(value, min, max) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new InputError(`数值应在 ${min}–${max} 之间`); return value; }
function timestamp(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new InputError('请提供有效日期'); return new Date(value).toISOString(); }
export function validatePreferences(input) {
  object(input); const out = {}; const allowed = Object.keys(DEFAULT_PREFERENCES);
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new InputError(`未知设置：${key}`);
  if ('reminderMinutes' in input) out.reminderMinutes = number(input.reminderMinutes, 1, 180);
  if ('driftMinutes' in input) out.driftMinutes = number(input.driftMinutes, 0.25, 30);
  if ('fontScale' in input) out.fontScale = number(input.fontScale, 0.8, 1.6);
  if ('snoozeUntil' in input) out.snoozeUntil = input.snoozeUntil === null ? null : timestamp(input.snoozeUntil);
  if ('quietHours' in input) {
    if (!Array.isArray(input.quietHours) || input.quietHours.length > 8) throw new InputError('免打扰时段最多 8 组');
    out.quietHours = input.quietHours.map(item => { object(item); if (![item.start, item.end].every(v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v))) throw new InputError('时段请使用 HH:mm 格式'); return { start: item.start, end: item.end }; });
  }
  if (!Object.keys(out).length) throw new InputError('请提供需要修改的设置');
  return out;
}

export function createStore(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(collection,id));');
  const write = db.prepare('INSERT INTO records(collection,id,payload,created_at) VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload');
  function put(collection, record) { write.run(collection, record.id, JSON.stringify(record), record.createdAt ?? new Date().toISOString()); return record; }
  function get(collection, id) { const row = db.prepare('SELECT payload FROM records WHERE collection=? AND id=?').get(collection, id); return row ? JSON.parse(row.payload) : null; }
  function list(collection, limit = 500) { return db.prepare('SELECT payload FROM records WHERE collection=? ORDER BY created_at DESC,rowid DESC LIMIT ?').all(collection, limit).map(row => JSON.parse(row.payload)); }
  function remove(collection, id) { const result = db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(collection, id); if (!result.changes) throw new InputError('记录已移除或暂时无法找到', 404); }
  function base() { const now = new Date().toISOString(); return { id: randomUUID(), createdAt: now, updatedAt: now }; }
  function preferences() { return { ...DEFAULT_PREFERENCES, ...(get('settings', 'preferences')?.value ?? {}) }; }
  function updatePreferences(input) { const changes = validatePreferences(input); const value = { ...preferences(), ...changes }; put('settings', { id: 'preferences', value }); return value; }
  function invalidate(sourceId) { for (const item of list('memories', 10000)) if (item.sourceIds?.includes(sourceId)) remove('memories', item.id); }
  function feedback(input) {
    object(input); const record = { ...base(), text: shortText(input.text), sessionId: shortText(input.sessionId, 120, true), area: shortText(input.area, 100, true), intensity: input.intensity === undefined || input.intensity === null ? null : number(input.intensity, 0, 10) };
    return put('feedback', record);
  }
  function editFeedback(id, input) {
    object(input); const row = get('feedback', id); if (!row) throw new InputError('找不到这条记录', 404);
    const next = { ...row, updatedAt: new Date().toISOString() };
    if ('text' in input) next.text = shortText(input.text);
    if ('area' in input) next.area = shortText(input.area, 100, true);
    if ('intensity' in input) next.intensity = input.intensity === null ? null : number(input.intensity, 0, 10);
    invalidate(id);
    if (row.sourceMessageId) { invalidate(row.sourceMessageId); const original = get('messages', row.sourceMessageId); if (original) put('messages', { ...original, content: `身体感受已由用户修订：${next.text}`, updatedAt: next.updatedAt }); }
    // Start future model context at the correction so earlier assistant paraphrases cannot restore stale facts.
    put('settings', { id: 'contextCutoff', value: new Date().toISOString() });
    return put('feedback', next);
  }
  function session(input) {
    object(input); const id = shortText(input.id, 120); const startAt = timestamp(input.startAt); const endAt = timestamp(input.endAt);
    if (Date.parse(endAt) < Date.parse(startAt)) throw new InputError('结束时间应晚于开始时间');
    if (!['camera', 'timer', 'demo'].includes(input.mode)) throw new InputError('请提供有效的使用模式');
    const existing = get('sessions', id);
    if (existing && (existing.startAt !== startAt || existing.mode !== input.mode)) throw new InputError('这段记录的开始时间或模式已存在，请使用原记录信息', 409);
    const value = { id, createdAt: startAt, startAt, endAt, mode: input.mode };
    for (const key of ['durationMs','validPoseMs','forwardMs','lowerMs','stillLongestMs','validEyeMs']) value[key] = number(input[key] ?? 0, 0, 86400000);
    // Older sessions never measured these categories: retain absence instead of inventing zeroes.
    for (const key of ['sideMs','turnMs','torsoMs']) {
      if (input[key] !== undefined) value[key] = number(input[key], 0, 86400000);
      else if (existing?.[key] !== undefined) value[key] = existing[key];
    }
    for (const key of ['reminders','movements','blinkCount']) value[key] = number(input[key] ?? 0, 0, 1000000);
    for (const key of ['validPoseMs','validEyeMs','stillLongestMs']) if (value[key] > value.durationMs) throw new InputError(`${key} 应在本次时长内`);
    for (const key of ['forwardMs','lowerMs','sideMs','turnMs','torsoMs']) if (input[key] !== undefined && value[key] > value.validPoseMs) throw new InputError('姿态时长应在有效观察时间内');
    // Completion retries can arrive out of order across browser tabs. Session counters
    // only accumulate: an old request must never roll back an already newer summary.
    const cumulativeFields = ['durationMs','validPoseMs','forwardMs','lowerMs','sideMs','turnMs','torsoMs','stillLongestMs','validEyeMs','reminders','movements','blinkCount'];
    if (existing && (Date.parse(endAt) < Date.parse(existing.endAt) || cumulativeFields.some(key =>
      Number.isFinite(existing[key]) && Number.isFinite(value[key]) && value[key] < existing[key]))) return existing;
    return put('sessions', value);
  }
  function memory(input) {
    object(input); const text = shortText(input.text, 1000); const kind = input.kind ?? 'stated';
    if (!['stated', 'pattern'].includes(kind)) throw new InputError('记忆类型无效');
    const sourceIds = Array.isArray(input.sourceIds) ? input.sourceIds.slice(0, 20).map(v => shortText(v, 120)) : [];
    return put('memories', { ...base(), text, kind, sourceIds });
  }
  function message(role, content) { return put('messages', { ...base(), role, content: shortText(content, 20000) }); }
  function propose(changes, reason) { const valid = validatePreferences(changes); const current = preferences(); const previous = Object.fromEntries(Object.keys(valid).map(key => [key, current[key]])); return put('actions', { ...base(), changes: valid, previous, reason: shortText(reason, 1000), status: 'pending' }); }
  function action(id, undo = false) {
    const row = get('actions', id); if (!row) throw new InputError('找不到这项操作', 404);
    if (!undo && row.status === 'confirmed') return { action: row, preferences: preferences() };
    if (row.status !== (undo ? 'confirmed' : 'pending')) throw new InputError('这项操作的状态已经更新，请刷新后查看', 409);
    if (Date.now() - Date.parse(row.createdAt) > 86400000) throw new InputError('该设置提案已超过一天，请重新提出', 409);
    const current = preferences(); const expected = undo ? row.changes : row.previous;
    for (const key of Object.keys(expected)) if (JSON.stringify(current[key]) !== JSON.stringify(expected[key])) throw new InputError('相关设置已发生变化，请在设置栏直接调整', 409);
    const prefs = updatePreferences(undo ? row.previous : row.changes);
    put('actions', { ...row, status: undo ? 'undone' : 'confirmed', updatedAt: new Date().toISOString() });
    return { action: get('actions', id), preferences: prefs };
  }
  function history(days = 7) {
    number(days, 1, 365); const cutoff = Date.now() - days * 86400000;
    const sessions = list('sessions', 10000);
    const demoIds = new Set(sessions.filter(s => s.mode === 'demo').map(s => s.id));
    return { sessions: sessions.filter(s => s.mode !== 'demo' && Date.parse(s.startAt) >= cutoff), feedback: list('feedback', 10000).filter(f => Date.parse(f.createdAt) >= cutoff && !demoIds.has(f.sessionId)), memories: list('memories', 100), preferences: preferences() };
  }
  function trends(days = 7) {
    const data = history(days); const sums = Object.fromEntries(['durationMs','validPoseMs','forwardMs','lowerMs','validEyeMs','blinkCount','reminders','movements'].map(key => [key, data.sessions.reduce((sum, item) => sum + (Number(item[key]) || 0), 0)]));
    const postureCoverage = {};
    const newMeasures = {};
    for (const kind of ['side', 'turn', 'torso']) {
      const key = `${kind}Ms`;
      const observed = data.sessions.filter(item => Number.isFinite(item[key]) && item.validPoseMs > 0);
      const validPoseMs = observed.reduce((sum, item) => sum + item.validPoseMs, 0);
      const durationMs = observed.reduce((sum, item) => sum + item[key], 0);
      postureCoverage[kind] = { observedSessionCount: observed.length, validPoseMs };
      newMeasures[key] = observed.length ? durationMs : null;
      newMeasures[`${kind}Ratio`] = validPoseMs ? durationMs / validPoseMs : null;
    }
    return { days, sessionCount: data.sessions.length, sourceIds: data.sessions.slice(0, 100).map(s => s.id), sourceIdsTruncated: data.sessions.length > 100, ...sums, ...newMeasures, postureCoverage,
      observationCoverage: sums.durationMs ? sums.validPoseMs / sums.durationMs : null,
      forwardRatio: sums.validPoseMs ? sums.forwardMs / sums.validPoseMs : null, lowerRatio: sums.validPoseMs ? sums.lowerMs / sums.validPoseMs : null, blinkPerMinute: sums.validEyeMs ? sums.blinkCount / (sums.validEyeMs / 60000) : null,
      note: '演示数据已排除；姿态比例按各项目已记录的有效观察时长计算。侧倾、转身、躯干变化在旧记录中留空，覆盖次数见 postureCoverage。多种姿态变化可能同时出现，时长有重叠。眨眼为摄像头估计，身体感受为用户自述。' };
  }
  function dashboard() { return { sessions: list('sessions', 300), feedback: list('feedback', 300), memories: list('memories', 200), preferences: preferences(), messages: list('messages', 100).reverse(), actions: list('actions', 30) }; }
  return { close: () => db.close(), get, list, put, session, feedback, editFeedback, preferences, updatePreferences, memory, message, propose, action, history, trends, dashboard,
    contextMessages(limit = 12) { const cutoff = get('settings', 'contextCutoff')?.value; return list('messages', limit).filter(m => !cutoff || m.createdAt > cutoff).reverse(); },
    deleteFeedback(id) { const row = get('feedback', id); remove('feedback', id); invalidate(id); if (row?.sourceMessageId) { invalidate(row.sourceMessageId); const original = get('messages', row.sourceMessageId); if (original) put('messages', { ...original, content: '这条身体感受已由用户删除。', updatedAt: new Date().toISOString() }); } put('settings', { id: 'contextCutoff', value: new Date().toISOString() }); },
    editMemory(id, input) { const row = get('memories', id); if (!row) throw new InputError('找不到这条记忆', 404); put('settings', { id: 'contextCutoff', value: new Date().toISOString() }); return put('memories', { ...row, text: shortText(input.text, 1000), kind: 'stated', sourceIds: [], updatedAt: new Date().toISOString() }); },
    deleteMemory(id) { remove('memories', id); put('settings', { id: 'contextCutoff', value: new Date().toISOString() }); },
    exportData() { return { exportedAt: new Date().toISOString(), schemaVersion: 1, sessions: list('sessions', 100000), feedback: list('feedback', 100000), memories: list('memories', 100000), messages: list('messages', 100000), actions: list('actions', 100000), preferences: preferences() }; }
  };
}
