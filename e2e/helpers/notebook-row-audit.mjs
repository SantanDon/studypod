import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { resolve, relative, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// No user/auth/session tables; no arbitrary SQL exposed; no raw content returned.
export const tables = Object.freeze(['notebooks', 'notebook_members', 'sources', 'chat_messages', 'notes', 'documents', 'memories', 'tags', 'tasks', 'studio_decks', 'studio_maps', 'studio_quizzes', 'studio_attempts', 'studio_podcasts']);
const digest = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v instanceof Uint8Array ? { blobSha256: createHash('sha256').update(v).digest('hex'), bytes: v.length } : typeof v === 'bigint' ? String(v) : v)).digest('hex');
const validId = id => assert.match(id, /^[a-zA-Z0-9_-]{1,100}$/, 'Invalid audit identity');
export function inspectRows(db, notebookId, tracked = {}) {
  validId(notebookId);
  const result = {};
  for (const table of tables) {
    const column = table === 'notebooks' ? 'id' : 'notebook_id';
    const ids = tracked[table]?.ids || [];
    ids.forEach(validId);
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${column}=?${ids.length ? ` OR id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY id`).all(notebookId, ...ids);
    result[table] = { count: rows.length, ids: rows.map(row => String(row.id)), digest: digest(rows) };
    if (table === 'studio_podcasts') result[table].blobBytes = rows.reduce((n, row) => n + (row.audio_bytes?.length || 0), 0);
  }
  const documentIds = [...new Set([...(result.documents.ids || []), ...(tracked.documents?.ids || [])])];
  const versionIds = tracked.document_versions?.ids || [];
  [...documentIds, ...versionIds].forEach(validId);
  const clauses = [], params = [];
  if (documentIds.length) { clauses.push(`document_id IN (${documentIds.map(() => '?').join(',')})`); params.push(...documentIds); }
  if (versionIds.length) { clauses.push(`id IN (${versionIds.map(() => '?').join(',')})`); params.push(...versionIds); }
  const versions = db.prepare(`SELECT * FROM document_versions WHERE ${clauses.join(' OR ') || '0'} ORDER BY id`).all(...params);
  result.document_versions = { count: versions.length, ids: versions.map(row => String(row.id)), digest: digest(versions) };
  return result;
}
export function assertPopulated(snapshot) {
  for (const table of ['notebooks', 'sources', 'studio_decks', 'studio_podcasts']) assert.ok(snapshot[table].count > 0, `${table} must be populated`);
  assert.ok(snapshot.studio_podcasts.blobBytes > 1000, 'Persisted podcast BLOB must be populated');
}
export function assertPurged(snapshot) {
  for (const [table, value] of Object.entries(snapshot)) assert.equal(value.count, 0, `${table} still contains target rows`);
  assert.equal(snapshot.studio_podcasts.blobBytes, 0, 'Target BLOB still exists');
}
export function assertRetained(before, after) { assert.deepEqual(after, before, 'Populated sibling rows/BLOB changed'); }
export function runtimePath(env, root) {
  assert.equal(env.STUDYPOD_FULL_ISOLATED, '1', 'Requires isolated acceptance runner');
  assert.ok(!env.TURSO_AUTH_TOKEN, 'Remote database credentials forbidden');
  const url = new URL(env.TURSO_DATABASE_URL);
  assert.equal(url.protocol, 'file:'); assert.equal(url.search, ''); assert.equal(url.hash, '');
  const run = realpathSync(env.STUDYPOD_GROUNDING_RUN_DIR);
  const allowed = realpathSync(resolve(root, '.ai-bridge/studypod-renewal-20261012/full-flow'));
  const under = relative(allowed, run);
  assert.ok(under && !under.startsWith('..') && !isAbsolute(under), 'Run must be under exact full-flow root');
  const path = realpathSync(fileURLToPath(url));
  assert.equal(basename(path), 'acceptance.db');
  assert.equal(path, resolve(run, 'acceptance.db'), 'Audit must inspect exact runner DB');
  assert.ok(statSync(path).isFile());
  return path;
}
export function openRuntimeAudit(root, env = process.env) {
  const db = new DatabaseSync(runtimePath(env, root), { readOnly: true });
  return Object.freeze({ snapshot: (id, tracked) => inspectRows(db, id, tracked), close: () => db.close() });
}
