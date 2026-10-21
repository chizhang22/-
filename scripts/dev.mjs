import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const script of ['server/index.mjs', 'node_modules/vite/bin/vite.js']) {
  const child = spawn(process.execPath, [script], { cwd: root, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', () => { console.error(`启动失败：${script}`); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log('\n坐标系 Agent 版：http://127.0.0.1:4174\n此窗口运行期间，网页和个人数据库服务可用。按 Ctrl+C 结束。\n');
