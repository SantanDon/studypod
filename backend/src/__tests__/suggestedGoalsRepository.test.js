// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSuggestedGoalsRepository, ensureSuggestedGoalSchema } from '../db/suggestedGoalsRepository.js';
let client, db, repo, directory;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'studypod-suggestions-'));
  client = createClient({ url: pathToFileURL(join(directory, 'test.db')).href }); db = drizzle(client);
  await client.executeMultiple(`PRAGMA foreign_keys=ON;
    CREATE TABLE sources(id text PRIMARY KEY, notebook_id text, user_id text);
    INSERT INTO sources VALUES ('source','book','owner');
    CREATE TABLE research_goals(id text PRIMARY KEY,user_id text,notebook_id text,title text,description text,parent_goal_id text,status text,priority text,source_id text,source_chunk_id text,last_activity_at integer,progress_pct integer DEFAULT 0,linked_task_ids text DEFAULT '[]',linked_artifact_ids text DEFAULT '[]',created_at integer,updated_at integer);
    CREATE TABLE signal_queue_suggestions(id text PRIMARY KEY,source_id text,notebook_id text,user_id text,title text,rationale text,source_chunk_indices text DEFAULT '[]',confidence real,status text,created_at integer);`);
  await ensureSuggestedGoalSchema(db);
  repo = createSuggestedGoalsRepository(async () => db);
});
// libSQL's transaction connections retain Windows file handles until process exit.
// Fixtures contain synthetic data only and live in isolated OS temporary directories.
afterEach(() => { client.close(); });
const suggestion = () => repo.upsertSignalQueueSuggestion({ sourceId: 'source', notebookId: 'book', userId: 'owner', title: 'Compare Cedar controls', rationale: 'Plain water isolates nutrient effects.', sourceChunkIndices: [2, 4], confidence: 0.9 });
it('migrates existing schema idempotently and preserves accepted association on regeneration', async () => {
  const id = await suggestion(); await ensureSuggestedGoalSchema(db);
  const first = await repo.acceptSignalQueueSuggestion('source', 'book', 'owner', id);
  expect(first.created).toBe(true); expect(first.goal.sourceChunkId).toBe('2');
  expect(await suggestion()).toBe(id);
  const [row] = await repo.getSignalQueueSuggestionsBySource('source', 'book', 'owner');
  expect(row).toMatchObject({ status: 'accepted', acceptedGoalId: first.goal.id, sourceChunkIndices: '[2,4]' });
  const retry = await repo.acceptSignalQueueSuggestion('source', 'book', 'owner', id);
  expect(retry.created).toBe(false); expect(retry.goal.id).toBe(first.goal.id);
  expect((await client.execute('SELECT id FROM research_goals')).rows).toHaveLength(1);
});
it('denies wrong source, account and notebook without creating goals or disclosing cached rows', async () => {
  const id = await suggestion();
  for (const args of [['other', 'book', 'owner'], ['source', 'other', 'owner'], ['source', 'book', 'stranger']]) {
    expect(await repo.acceptSignalQueueSuggestion(...args, id)).toBeNull();
    expect(await repo.getSignalQueueSuggestionsBySource(...args)).toEqual([]);
  }
  expect((await client.execute('SELECT id FROM research_goals')).rows).toHaveLength(0);
});
it('handles malformed legacy chunk JSON and preserves dismissed decisions', async () => {
  const id = await suggestion();
  await client.execute({ sql: "UPDATE signal_queue_suggestions SET source_chunk_indices='broken' WHERE id=?", args: [id] });
  expect((await repo.acceptSignalQueueSuggestion('source', 'book', 'owner', id)).goal.sourceChunkId).toBeNull();
  await client.execute({ sql: "UPDATE signal_queue_suggestions SET status='dismissed' WHERE id=?", args: [id] });
  await suggestion();
  expect((await repo.getSignalQueueSuggestionsBySource('source', 'book', 'owner'))[0].status).toBe('dismissed');
  expect(await repo.acceptSignalQueueSuggestion('source', 'book', 'owner', id)).toBeNull();
});



