import { randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const state = resolve(process.env.STUDYPOD_AUDIO_STATE || join(homedir(), '.local/share/studypod-audio'));
const origin = new URL(process.argv[2] || (await readFile(join(state, 'origin'), 'utf8')).trim());
if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/' ||
    !origin.hostname.endsWith('.sprites.app') ||
    origin.hostname.startsWith('studypod-passage-finder-')) {
  throw new Error('Supply the HTTPS origin of the dedicated audio Sprite.');
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.umask(0o077);
await mkdir(state, { recursive: true, mode: 0o700 });

// Publish only complete keys. Concurrent starts must select the same identity.
const keyfile = join(state, 'signing-key');
try {
  await readFile(keyfile);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const temporary = join(state, 'new-key-' + randomUUID());
  await writeFile(temporary, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 });
  try {
    await link(temporary, keyfile);
  } catch (linkError) {
    if (linkError.code !== 'EEXIST') throw linkError;
  } finally {
    await unlink(temporary);
  }
}

process.chdir(repo);
Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT: process.env.PORT || '8080',
  STUDYPOD_BIND_HOST: '0.0.0.0',
  AUDIOBOOK_STORAGE_DIR: join(state, 'audiobooks'),
  AUDIOBOOK_MAX_CONCURRENT_RENDERS: '1',
  AUDIOBOOK_TTS_PROVIDER: 'kokoro',
  CORS_ORIGIN: origin.origin,
  JWT_SECRET: await readFile(keyfile, 'utf8'),
  TURSO_DATABASE_URL: pathToFileURL(join(state, 'accounts.sqlite')).href,
  TURSO_AUTH_TOKEN: '',
});
await import('../../backend/src/server.js');
