// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { randomUUID } from 'node:crypto';
import { createPodcastRepository, validatePodcastWav } from '../services/podcastRepository.js';

let client, repo, sourceId;
function wav(silent = false, float = false) {
  const samples = 1600, size = float ? 4 : 2, bytes = Buffer.alloc(44 + samples * size);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(float ? 3 : 1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(8000 * size, 28); bytes.writeUInt16LE(size, 32); bytes.writeUInt16LE(size * 8, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * size, 40);
  for (let i = 0; i < samples; i++) { const value = silent ? 0 : Math.sin(i / 10) * 0.2; if (float) bytes.writeFloatLE(value, 44 + i * size); else bytes.writeInt16LE(Math.round(value * 32767), 44 + i * size); }
  return bytes;
}
const payload = () => ({ id: randomUUID(), title: 'Cedar discussion', duration: 0.2, script: { title: 'Cedar discussion', segments: [{ speaker: 'Alex', text: 'Cedar trees are evergreen.' }] }, sourceIds: [sourceId] });
beforeEach(async () => {
  client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(`PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE notebooks(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id)); CREATE TABLE sources(id TEXT PRIMARY KEY,notebook_id TEXT,user_id TEXT); CREATE TABLE notebook_members(notebook_id TEXT,user_id TEXT); INSERT INTO users VALUES ('owner'),('member'),('foreign'); INSERT INTO notebooks VALUES ('book','owner'),('other','foreign'); INSERT INTO notebook_members VALUES ('book','member');`);
  sourceId = randomUUID();
  await client.execute({ sql: 'INSERT INTO sources VALUES (?,?,?)', args: [sourceId, 'book', 'owner'] });
  repo = createPodcastRepository({ getDatabase: async () => drizzle(client) });
});
afterEach(() => client.close());
describe('atomic account podcast persistence', () => {
  it('reopens a record and identical playable bytes through a fresh repository', async () => {
    const metadata = payload(), bytes = wav();
    const saved = await repo.create('book', 'owner', metadata, bytes);
    const fresh = createPodcastRepository({ getDatabase: async () => drizzle(client) });
    expect(saved).toMatchObject({ persistence: 'account', script: metadata.script, source_ids: [sourceId], byte_length: bytes.length, duration: 0.2 });
    expect(await fresh.get('book', 'owner', saved.id)).toEqual(saved);
    expect((await fresh.audio('book', 'owner', saved.id)).bytes).toEqual(bytes);
    expect(await fresh.list('book', 'owner')).toEqual([saved]);
    expect(saved).not.toHaveProperty('audio_bytes');
  });
  it('uniformly denies members and foreign owners before parsing payloads', async () => {
    const saved = await repo.create('book', 'owner', payload(), wav());
    for (const user of ['member', 'foreign']) {
      for (const operation of [repo.list('book', user), repo.get('book', user, saved.id), repo.audio('book', user, saved.id), repo.delete('book', user, saved.id), repo.create('book', user, null, null)]) await expect(operation).rejects.toMatchObject({ code: 'PODCAST_NOT_FOUND' });
    }
    await expect(repo.get('other', 'foreign', saved.id)).rejects.toMatchObject({ code: 'PODCAST_NOT_FOUND' });
    expect(await repo.get('book', 'owner', saved.id)).toEqual(saved);
  });
  it('makes identical retry idempotent and refuses changed content', async () => {
    const metadata = payload(), bytes = wav(), saved = await repo.create('book', 'owner', metadata, bytes);
    expect(await repo.create('book', 'owner', metadata, bytes)).toEqual(saved);
    await expect(repo.create('book', 'owner', { ...metadata, title: 'Different' }, bytes)).rejects.toMatchObject({ code: 'PODCAST_CONFLICT' });
    expect(await repo.list('book', 'owner')).toHaveLength(1);
  });
  it('rejects invalid audio and foreign provenance without inserting partial records', async () => {
    const foreignSource = randomUUID();
    await client.execute({ sql: 'INSERT INTO sources VALUES (?,?,?)', args: [foreignSource, 'other', 'foreign'] });
    for (const bytes of [Buffer.from('fake WAV'), wav(true), wav().subarray(0, 50)]) await expect(repo.create('book', 'owner', payload(), bytes)).rejects.toMatchObject({ code: 'PODCAST_INVALID_PAYLOAD' });
    await expect(repo.create('book', 'owner', { ...payload(), sourceIds: [foreignSource] }, wav())).rejects.toMatchObject({ code: 'PODCAST_INVALID_PAYLOAD' });
    await expect(repo.create('book', 'owner', { ...payload(), duration: 100 }, wav())).rejects.toMatchObject({ code: 'PODCAST_INVALID_PAYLOAD' });
    expect(await repo.list('book', 'owner')).toEqual([]);
  });
  it('validates float samples and rejects nonfinite values', () => {
    const bytes = wav(false, true);
    expect(validatePodcastWav(bytes).duration).toBe(0.2);
    bytes.writeFloatLE(NaN, 44);
    expect(() => validatePodcastWav(bytes)).toThrow('Invalid audio samples.');
  });
  it('deletes the record and bytes together', async () => {
    const saved = await repo.create('book', 'owner', payload(), wav());
    expect(await repo.delete('book', 'owner', saved.id)).toEqual({ success: true });
    await expect(repo.audio('book', 'owner', saved.id)).rejects.toMatchObject({ code: 'PODCAST_NOT_FOUND' });
    expect(await repo.list('book', 'owner')).toEqual([]);
  });
  it('returns only the latest saved owner metadata across notebooks', async () => {
    expect(await repo.recent('owner')).toBeNull();
    await client.execute("INSERT INTO notebooks VALUES ('second','owner')");
    const ownerFirst = await repo.create('book', 'owner', payload(), wav());
    await client.execute({ sql: 'UPDATE studio_podcasts SET created_at=? WHERE id=?', args: ['2026-01-01T00:00:00.000Z', ownerFirst.id] });
    sourceId = randomUUID();
    await client.execute({ sql: 'INSERT INTO sources VALUES (?,?,?)', args: [sourceId, 'second', 'owner'] });
    const ownerLatest = await repo.create('second', 'owner', payload(), wav());
    const foreignSource = randomUUID();
    await client.execute({ sql: 'INSERT INTO sources VALUES (?,?,?)', args: [foreignSource, 'other', 'foreign'] });
    sourceId = foreignSource;
    const foreign = await repo.create('other', 'foreign', payload(), wav());
    await client.execute({ sql: 'UPDATE studio_podcasts SET created_at=? WHERE id=?', args: ['2099-01-01T00:00:00.000Z', foreign.id] });
    const result = await repo.recent('owner');
    expect(result).toEqual({ id: ownerLatest.id, notebook_id: 'second', title: ownerLatest.title, created_at: ownerLatest.created_at, duration: ownerLatest.duration, persistence: 'account' });
    expect(result).not.toHaveProperty('script');
    expect(result).not.toHaveProperty('audio_bytes');
    expect(await repo.recent('member')).toBeNull();
    expect((await repo.recent('foreign')).id).toBe(foreign.id);
  });
});

describe('four-record history keyset pages',()=>{
 it('keeps ten maximum-size scripts below hosted response limit with stable timestamp ties',async()=>{
  const ids=[];for(let i=0;i<10;i++){const item=payload();item.script.segments[0].text='';item.script.segments[0].text='x'.repeat(524288-Buffer.byteLength(JSON.stringify(item.script)));ids.push((await repo.create('book','owner',item,wav())).id);}
  await client.execute("UPDATE studio_podcasts SET created_at='2026-10-18T10:00:00.000Z'");
  const seen=[];let cursor;let pages=0;
  do{const rows=await repo.list('book','owner',{cursor});expect(rows.length).toBeLessThanOrEqual(5);const items=rows.slice(0,4);const last=items.at(-1);const next=rows.length>4?[last.created_at,last.id]:undefined;
   expect(Buffer.byteLength(JSON.stringify({podcasts:items,nextCursor:next}))).toBeLessThan(4500000);expect(items.every(x=>Buffer.byteLength(JSON.stringify(x.script))===524288)).toBe(true);seen.push(...items.map(x=>x.id));cursor=next;pages++;
  }while(cursor);expect(pages).toBe(3);expect(seen).toEqual(ids.sort().reverse());expect(new Set(seen).size).toBe(10);
 });
 it('denies foreign and member pagination',async()=>{for(const user of ['member','foreign'])await expect(repo.list('book',user,{cursor:['2026-10-18T00:00:00.000Z',randomUUID()]})).rejects.toMatchObject({code:'PODCAST_NOT_FOUND'});});
});

it('keyset excludes newly inserted newer episodes without skipping older history',async()=>{
 const ids=[];for(let i=0;i<6;i++)ids.push((await repo.create('book','owner',payload(),wav())).id);
 await client.execute("UPDATE studio_podcasts SET created_at='2026-10-17T00:00:00.000Z'");
 const first=(await repo.list('book','owner',{})).slice(0,4);const last=first.at(-1);const added=await repo.create('book','owner',payload(),wav());
 const rest=await repo.list('book','owner',{cursor:[last.created_at,last.id]});const seen=[...first,...rest].map(x=>x.id);
 expect(seen).toEqual(ids.sort().reverse());expect(seen).not.toContain(added.id);expect(new Set(seen).size).toBe(6);
});
