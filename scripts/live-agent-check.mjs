// Explicit opt-in integration check. Uses fictional input and an in-memory DB.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createStore } from '../server/store.mjs';
import { createAgent, readConfig } from '../server/agent.mjs';
if (!process.argv.includes('--live')) { console.log('真实模型验证会产生 API 用量。显式传入 --live 后运行，测试数据只保存在内存。'); process.exit(0); }
Object.assign(process.env, parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')));
const store = createStore();
const agent = createAgent(store, readConfig());
const result = await agent.chat({ consent: true, message: '请帮我记下今天的感受：写材料时右肩有点紧。请查询最近七天的使用记录；另外请提议把活动提醒间隔改为45分钟。' });
const data = store.dashboard();
const action = data.actions.find(a => a.status === 'pending');
const before = store.preferences().reminderMinutes;
if (action) store.action(action.id);
const after = store.preferences().reminderMinutes;
if (action) store.action(action.id, true);
console.log(JSON.stringify({ mode: result.mode, model: agent.health().model, protocol: agent.health().protocol,
  toolNames: result.toolCalls.map(call => call.name), reply: result.reply,
  feedbackSaved: data.feedback.length, unknownIntensityKeptNull: data.feedback[0]?.intensity === null,
  proposed: Boolean(action), beforeConfirm: before, afterConfirm: after,
  afterUndo: store.preferences().reminderMinutes }, null, 2));
store.close();
if (result.mode !== 'live' || !data.feedback.length || !action || after !== 45 || before !== 30) process.exitCode = 1;
