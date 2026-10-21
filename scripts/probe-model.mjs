// Prints service metadata only. Credentials stay in the process environment.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
try { Object.assign(process.env, parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const base = process.env.ZBX_BASE_URL || process.env.ANTHROPIC_BASE_URL;
const token = process.env.ZBX_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
if (!base || !token) { console.log(JSON.stringify({ configured: false })); process.exit(0); }
const url = new URL(base.replace(/\/$/, '') + (base.replace(/\/$/, '').endsWith('/v1') ? '/models' : '/v1/models'));
try {
  const headers = { Authorization: `Bearer ${token}` };
  if (process.env.ZBX_API_PROTOCOL !== 'openai') Object.assign(headers, { 'x-api-key': token, 'anthropic-version': '2023-06-01' });
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000), redirect: 'error' });
  const data = await response.json().catch(() => ({}));
  const models = (data.data || data.models || []).map(x => typeof x === 'string' ? x : x.id);
  console.log(JSON.stringify({ host: url.host, status: response.status, requestedModel: process.env.ZBX_MODEL, requestedModelAvailable: models.includes(process.env.ZBX_MODEL), models: models.filter(x => /GLM-5/i.test(x)), modelCount: models.length, errorType: data.error?.type }, null, 2));
} catch (error) { console.log(JSON.stringify({ host: url.host, error: error.name, cause: error.cause?.code })); }
