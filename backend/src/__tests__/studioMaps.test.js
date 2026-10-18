// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFile } from 'node:fs/promises';
import { ensureStudioSchema } from '../db/studioBootstrap.js';
import { createStudioRepository } from '../services/studioRepository.js';

let client, db, repo;
const payload = { title: 'Cedar', nodes: [{ id: 'root', label: 'Cedar', type: 'main' }, { id: 'leaf', label: 'Leaf', type: 'detail', x: 2, y: 3 }], edges: [{ id: 'edge', source: 'root', target: 'leaf', type: 'part_of' }] };
function repository() {
  return createStudioRepository({ getDatabase: async () => db, getNotebookById: async (id, userId) => {
    const result = await client.execute({ sql: 'SELECT id FROM notebooks WHERE id=? AND (user_id=? OR EXISTS (SELECT 1 FROM notebook_members WHERE notebook_id=notebooks.id AND user_id=?))', args: [id, userId, userId] });
    return result.rows[0] ?? null;
  } });
}
beforeEach(async () => {
  client = createClient({ url: 'file::memory:' }); db = drizzle(client);
  await client.executeMultiple(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id text PRIMARY KEY);
    CREATE TABLE notebooks(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id));
    CREATE TABLE notebook_members(notebook_id text,user_id text);
    INSERT INTO users VALUES ('owner'),('member'),('stranger');
    INSERT INTO notebooks VALUES ('book','owner'),('other','stranger');
    INSERT INTO notebook_members VALUES ('book','member');`);
  await ensureStudioSchema(db); repo = repository();
});
afterEach(() => client.close());

it('persists acknowledged graphs across repository instances with server-owned identity and IDs', async () => {
  const map = await repo.createMap('book', 'owner', { ...payload, id: 'forged', userId: 'member', notebookId: 'other' });
  expect(map.id).not.toBe('forged');
  expect(map).toMatchObject({ notebookId: 'book', ...payload });
  expect(map).not.toHaveProperty('userId');
  expect(await repository().listMaps('book', 'owner')).toEqual([map]);
  await ensureStudioSchema(db);
  expect(await repository().getMap('book', 'owner', map.id)).toEqual(map);
});
it('denies foreign accounts, notebook members, and wrong notebook routes while allowing owned deletion', async () => {
  const map = await repo.createMap('book', 'owner', payload);
  expect(await repo.listMaps('book', 'member')).toEqual([]);
  for (const operation of [repo.getMap('book', 'member', map.id), repo.deleteMap('book', 'member', map.id), repo.listMaps('book', 'stranger'), repo.getMap('other', 'stranger', map.id), repo.createMap('book', 'stranger', payload)]) {
    await expect(operation).rejects.toMatchObject({ code: 'STUDIO_NOT_FOUND' });
  }
  expect(await repo.getMap('book', 'owner', map.id)).toEqual(map);
  expect(await repo.deleteMap('book', 'owner', map.id)).toEqual({ success: true });
  expect(await repo.listMaps('book', 'owner')).toEqual([]);
});
it('rejects malformed graphs and byte/count budgets without storing partial records', async () => {
  for (const invalid of [null, { ...payload, nodes: [] }, { ...payload, nodes: [payload.nodes[0], payload.nodes[0]] }, { ...payload, nodes: Array(501).fill(payload.nodes[0]) }, { ...payload, edges: [{ ...payload.edges[0], target: 'missing' }] }, { ...payload, edges: [{ ...payload.edges[0], target: 'root' }] }, { ...payload, edges: [payload.edges[0], payload.edges[0]] }, { ...payload, nodes: [{ ...payload.nodes[0], type: 'invalid' }] }, { ...payload, padding: 'x'.repeat(1000001) }]) {
    await expect(repo.createMap('book', 'owner', invalid)).rejects.toMatchObject({ code: 'STUDIO_INVALID_PAYLOAD' });
  }
  expect(await repo.listMaps('book', 'owner')).toEqual([]);
});
it('applies the map migration idempotently and cascades maps when a notebook is removed', async () => {
  await client.execute('DROP TABLE studio_maps');
  const sql = (await readFile(new URL('../db/migrations/0003_private_maps.sql', import.meta.url), 'utf8')).replaceAll('--> statement-breakpoint', '');
  await client.executeMultiple(sql); await client.executeMultiple(sql);
  await repo.createMap('book', 'owner', payload);
  await client.execute("DELETE FROM notebooks WHERE id='book'");
  expect((await client.execute('SELECT count(*) AS count FROM studio_maps')).rows[0].count).toBe(0);
});
