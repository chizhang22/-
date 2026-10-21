import http from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createStore, InputError } from './store.mjs';
import { createAgent, readConfig } from './agent.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
function localUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && LOOPBACK.has(url.hostname) && !url.username && !url.password; } catch { return false; } }
function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)); }
async function readBody(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new InputError('请求需使用 application/json', 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 65536) throw new InputError('本次数据超过 64KB，请缩短后重试', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('数据格式有误'); }
}
export function createApp({ store = createStore(), agent = createAgent(store) } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      if (!localUrl(`http://${request.headers.host}`)) throw new InputError('仅接受本机请求', 403);
      if (request.headers.origin && (!localUrl(request.headers.origin) || !['4174', String(request.socket.localPort)].includes(new URL(request.headers.origin).port))) throw new InputError('该页面来源尚未授权', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new InputError('仅接受本机页面请求', 403);
      if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); response.end(); return; }
      const path = new URL(request.url, 'http://127.0.0.1').pathname; const method = request.method;
      if (method === 'GET' && path === '/api/health') return json(response, 200, agent.health());
      if (method === 'GET' && path === '/api/dashboard') return json(response, 200, store.dashboard());
      if (method === 'GET' && path === '/api/export') { response.setHeader('content-disposition', 'attachment; filename="zuobiaoxi-data.json"'); return json(response, 200, store.exportData()); }
      if (method === 'POST' && path === '/api/sessions') return json(response, 200, store.session(await readBody(request)));
      if (method === 'POST' && path === '/api/feedback') return json(response, 201, store.feedback(await readBody(request)));
      if (method === 'PATCH' && path === '/api/preferences') return json(response, 200, store.updatePreferences(await readBody(request)));
      if (method === 'POST' && path === '/api/chat') return json(response, 200, await agent.chat(await readBody(request)));
      const record = /^\/api\/(feedback|memories)\/([^/]+)$/.exec(path);
      if (record && method === 'PATCH') return json(response, 200, record[1] === 'feedback' ? store.editFeedback(record[2], await readBody(request)) : store.editMemory(record[2], await readBody(request)));
      if (record && method === 'DELETE') { record[1] === 'feedback' ? store.deleteFeedback(record[2]) : store.deleteMemory(record[2]); return json(response, 200, { ok: true }); }
      const action = /^\/api\/actions\/([^/]+)\/(confirm|undo)$/.exec(path);
      if (action && method === 'POST') { await readBody(request); return json(response, 200, store.action(action[1], action[2] === 'undo')); }
      throw new InputError('找不到这个接口', 404);
    } catch (error) { if (!response.headersSent) json(response, error instanceof InputError ? error.status : 500, { error: error instanceof InputError ? error.message : '本机服务处理失败，请稍后重试' }); else response.end(); }
  });
  server.requestTimeout = 120000; server.headersTimeout = 15000;
  return { server, store, agent };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { Object.assign(process.env, parseEnv(readFileSync(resolve(ROOT, '.env'), 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const dataDir = resolve(process.env.ZBX_DATA_DIR || resolve(ROOT, 'data')); mkdirSync(dataDir, { recursive: true });
  const store = createStore(process.env.ZBX_DB_PATH || resolve(dataDir, 'zuobiaoxi.sqlite'));
  const app = createApp({ store, agent: createAgent(store, readConfig()) });
  const port = Number(process.env.ZBX_API_PORT || 4175);
  app.server.listen(port, '127.0.0.1', () => console.log(`坐标系本机服务：http://127.0.0.1:${port} · 数据保存在本机`));
  const stop = () => app.server.close(() => { store.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
