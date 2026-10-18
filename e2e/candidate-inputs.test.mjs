import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep, dirname } from 'node:path';
import { candidateInputPaths, sourceFingerprint } from './candidate-inputs.mjs';

const additional = ['backend/package.json', 'backend/package-lock.json', 'index.html', 'scripts/install-backend.js', 'scripts/validate-production-env.mjs', 'vitest.config.ts', 'eslint.config.js'];
const executable = ['src/main.tsx', 'public/brand.svg', 'e2e/full-flow.config.ts', 'backend/src/server.js', 'backend/scripts/migrate.mjs', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.app.json', 'playwright.config.ts'];
const excluded = ['.env', '.env.production', 'backend/.env', '.ai-bridge/receipt.json', 'e2e/credentials.private.json', 'public/credentials.json', 'scripts/secrets/token.json', 'backend/src/.env.local', 'backend/src/local.db', 'backend/src/node_modules/pkg/index.js', 'scripts/dist/output.js', 'src/.cache/file.json', 'coverage/result.json', '../src/main.tsx', '/src/main.tsx', 'C:\\private\\token.json', 'src/../credentials.json'];

test('candidate inventory includes dependency, entrypoint and gate changes without admitting secrets or artifacts', () => {
  const selected = candidateInputPaths([...additional, ...executable, ...excluded]);
  for (const path of [...additional, ...executable]) assert.ok(selected.includes(path), `missing candidate input: ${path}`);
  for (const path of excluded) assert.ok(!selected.includes(path), `unsafe input selected: ${path}`);
});

test('every newly covered input changes the real candidate digest when its bytes change', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'studypod-fingerprint-'));
  try {
    for (const path of additional) { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), 'before'); }
    const initial = await sourceFingerprint(root, additional);
    for (const path of additional) {
      await writeFile(resolve(root, path), 'after');
      const changed = await sourceFingerprint(root, additional);
      assert.notEqual(changed.sha256, initial.sha256, `changed bytes invisible: ${path}`);
      await writeFile(resolve(root, path), 'before');
    }
    assert.equal((await sourceFingerprint(root, [...additional].reverse().concat(additional))).sha256, initial.sha256, 'inventory order/duplicates must not change candidate identity');
    assert.equal((await sourceFingerprint(root, additional.concat(excluded))).sha256, initial.sha256, 'private/artifact inventories must not alter candidate identity');
  } finally {
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    assert.ok(root.split(sep).at(-1).startsWith('studypod-fingerprint-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('deletion and unexpected read errors are observable rather than a successful unchanged snapshot', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'studypod-fingerprint-'));
  try {
    await writeFile(resolve(root, 'package.json'), '{}');
    const before = await sourceFingerprint(root, ['package.json']);
    await rm(resolve(root, 'package.json'));
    const after = await sourceFingerprint(root, ['package.json']);
    assert.notEqual(after.sha256, before.sha256);
    assert.deepEqual(after.files, [{ path: 'package.json', absent: true }]);
    await mkdir(resolve(root, 'index.html'));
    await assert.rejects(sourceFingerprint(root, ['index.html']));
  } finally {
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    assert.ok(root.split(sep).at(-1).startsWith('studypod-fingerprint-'));
    await rm(root, { recursive: true, force: true });
  }
});
