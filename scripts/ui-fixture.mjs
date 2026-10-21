// Isolated browser acceptance fixture: no personal database, credentials or API calls.
import { createServer } from 'vite';
import { createApp } from '../server/index.mjs';
import { createStore } from '../server/store.mjs';
import { createAgent, readConfig } from '../server/agent.mjs';

const store = createStore(':memory:');
const app = createApp({ store, agent: createAgent(store, readConfig({ ZBX_API_PROTOCOL: 'openai' })) });
await new Promise(resolve => app.server.listen(4177, '127.0.0.1', resolve));
const vite = await createServer({ configFile: false, server: {
  host: '127.0.0.1', port: 4176, strictPort: true,
  proxy: { '/api': { target: 'http://127.0.0.1:4177', configure(proxy) {
    proxy.on('proxyReq', request => request.setHeader('Origin', 'http://127.0.0.1:4177'));
  } } },
} });
await vite.listen();
console.log('隔离验收：http://127.0.0.1:4176 · 内存数据库 · 模型调用关闭');
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await vite.close(); app.server.close(() => { store.close(); process.exit(0); });
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
