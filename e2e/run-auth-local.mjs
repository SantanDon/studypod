import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import dotenv from 'dotenv';

const root = process.cwd();
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const directory = resolve(root, '.ai-bridge/studypod-renewal-20261012/release-gate/auth-local', runId);
await mkdir(directory, { recursive: true });
const credentials = { email: `qa-${randomBytes(8).toString('hex')}@studypod.invalid`, password: `QA-${randomBytes(24).toString('hex')}` };
const env = { ...process.env };
// Override every dotenv key Vite or the backend could load in this run.
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', 'backend/.env']) {
  try { for (const key of Object.keys(dotenv.parse(await readFile(resolve(root, file))))) env[key] = ''; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const key of Object.keys(env)) if (/(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(key)) env[key] = '';
Object.assign(env, {
  PLAYWRIGHT_NO_COPY_PROMPT: '1', NODE_ENV: 'development', VERCEL: '', PORT: '4018',
  TURSO_DATABASE_URL: pathToFileURL(resolve(directory, 'acceptance.db')).href,
  TURSO_AUTH_TOKEN: '', JWT_SECRET: randomBytes(48).toString('hex'),
  TOKENLLM7_ENABLED: 'false', OVHCLOUD_ENABLED: 'false', OLLAMA_BASE_URL: '',
  VITE_API_URL: '/api', STUDYPOD_AUTH_BASE_URL: 'http://127.0.0.1:4178',
  STUDYPOD_AUTH_BUILD_DIR: resolve(directory, 'dist'),
  STUDYPOD_AUTH_MUTATIONS_ALLOWED: 'dedicated-test-data', STUDYPOD_AUTH_SIGNUP: '1',
  STUDYPOD_AUTH_TERMS_ACCEPTED: '1', STUDYPOD_AUTH_EMAIL: credentials.email,
  STUDYPOD_AUTH_PASSWORD: credentials.password,
  STUDYPOD_AUTH_SECOND_EMAIL: `qa-${randomBytes(8).toString('hex')}@studypod.invalid`,
  STUDYPOD_AUTH_SECOND_PASSWORD: `QA-${randomBytes(24).toString('hex')}`,
});
await writeFile(resolve(directory, 'credentials.private.json'), JSON.stringify({ ...credentials, secondEmail: env.STUDYPOD_AUTH_SECOND_EMAIL, secondPassword: env.STUDYPOD_AUTH_SECOND_PASSWORD }));
await writeFile(resolve(directory, 'empty.env'), '');
env.DOTENV_CONFIG_PATH = resolve(directory, 'empty.env');
const children = [];
const handles = [];
async function launch(args, name) {
  const handle = await open(resolve(directory, `${name}.log`), 'w'); handles.push(handle);
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', handle.fd, handle.fd], windowsHide: true });
  children.push(child); return child;
}
async function finished(child) {
  return await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', code => accept(code)); });
}
async function free(port) {
  await new Promise((accept, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(accept)); });
}
async function ready(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Isolated server exited; inspect its private local log');
    try { if ((await fetch(url)).ok) return; } catch { /* readiness */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Isolated server readiness timed out');
}
try {
  await free(4018); await free(4178);
  // Never replace assets being served to an already-open development notebook.
  if (await finished(await launch(['node_modules/vite/bin/vite.js', 'build', '--outDir', env.STUDYPOD_AUTH_BUILD_DIR], 'build')) !== 0) throw new Error('Build failed');
  const backend = await launch(['backend/src/server.js'], 'backend');
  await ready('http://127.0.0.1:4018/api/health', backend);
  const preview = await launch(['node_modules/vite/bin/vite.js', 'preview', '--config', 'e2e/auth-preview.config.ts'], 'preview');
  await ready('http://127.0.0.1:4178', preview);
  for (const mobile of [false, true]) {
    env.STUDYPOD_AUTH_MOBILE = mobile ? '1' : '0';
    env.STUDYPOD_AUTH_SIGNUP = mobile ? '0' : '1';
    env.STUDYPOD_AUTH_ARTIFACTS = resolve(directory, mobile ? 'mobile' : 'desktop');
    const code = await finished(await launch(['node_modules/@playwright/test/cli.js', 'test', '--config', 'e2e/auth.config.ts'], mobile ? 'mobile' : 'desktop'));
    if (code !== 0) throw new Error(`${mobile ? 'Mobile' : 'Desktop'} authenticated gate failed`);
  }
  console.log(`Authenticated local desktop/mobile gate passed. Receipts: ${directory}`);
} catch (error) {
  console.error(`${error.message}. Receipts: ${directory}`); process.exitCode = 1;
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  await Promise.all(handles.map(h => h.close()));
}
