import { createHash, randomUUID } from 'node:crypto';
import { getDatabase } from '../db/database.js';
import { MAX_PODCAST_BYTES, podcastRepository, validatePodcastMetadata, validatePodcastWav } from './podcastRepository.js';
export const PODCAST_CHUNK_BYTES = 1024 * 1024;
export const PODCAST_UPLOAD_TTL_MS = 60 * 60 * 1000;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const invalid = () => fail('PODCAST_INVALID_PAYLOAD', 'Invalid or incomplete podcast transfer.');
const missing = () => fail('PODCAST_NOT_FOUND', 'Podcast not found or access denied.');
const conflict = () => fail('PODCAST_CONFLICT', 'This transfer already has different content.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function createPodcastChunkRepository({ repository = podcastRepository, getDatabase: database = getDatabase, now = Date.now } = {}) {
  async function owned(book, user) {
    await repository.assertOwner(book, user);
    const client = (await database()).$client;
    await client.execute(`CREATE TABLE IF NOT EXISTS studio_podcast_uploads (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, podcast_id TEXT NOT NULL, metadata_json TEXT NOT NULL, byte_length INTEGER NOT NULL, audio_sha256 TEXT NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL, UNIQUE(notebook_id,user_id,podcast_id))`);
    await client.execute(`CREATE TABLE IF NOT EXISTS studio_podcast_chunks (upload_id TEXT NOT NULL REFERENCES studio_podcast_uploads(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL, bytes BLOB NOT NULL, chunk_sha256 TEXT NOT NULL, PRIMARY KEY(upload_id,chunk_index))`);
    return client;
  }
  async function expired(client) {
    // Only pending transfers expire. Never refresh another account's deadline.
    await client.execute({sql:'DELETE FROM studio_podcast_chunks WHERE upload_id IN (SELECT id FROM studio_podcast_uploads WHERE state=? AND expires_at<=?)',args:['pending',now()]});
    await client.execute({sql:'DELETE FROM studio_podcast_uploads WHERE state=? AND expires_at<=?',args:['pending',now()]});
  }
  async function session(client, book, user, id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) missing();
    const r = await client.execute({sql:'SELECT * FROM studio_podcast_uploads WHERE id=? AND notebook_id=? AND user_id=?',args:[id,book,user]});
    if (!r.rows.length || (r.rows[0].state === 'pending' && r.rows[0].expires_at <= now())) missing();
    return r.rows[0];
  }
  function indexOf(index, length) {
    if (!/^(0|[1-9]\d*)$/.test(String(index))) invalid();
    const n=Number(index); if (!Number.isSafeInteger(n) || n >= Math.ceil(length/PODCAST_CHUNK_BYTES)) invalid(); return n;
  }
  async function transaction(client, fn) {
    const tx=await client.transaction('write');
    try { const value=await fn(tx); await tx.commit(); return value; } catch(e) { await tx.rollback(); throw e; } finally { tx.close(); }
  }
  return {
    async start(book,user,input) {
      const client=await owned(book,user);
      if (!Number.isSafeInteger(input?.byteLength) || input.byteLength<44 || input.byteLength>MAX_PODCAST_BYTES || !/^[a-f0-9]{64}$/.test(input?.sha256 || '')) invalid();
      await validatePodcastMetadata(client,book,user,input.metadata);
      const metadata=JSON.stringify(input.metadata); if(Buffer.byteLength(metadata)>600*1024) invalid();
      return transaction(client,async tx=>{
        await expired(tx);
        const old=await tx.execute({sql:'SELECT * FROM studio_podcast_uploads WHERE notebook_id=? AND user_id=? AND podcast_id=?',args:[book,user,input.metadata.id]});
        let id=old.rows[0]?.id;
        if(id) { const row=old.rows[0]; if(row.metadata_json!==metadata || row.byte_length!==input.byteLength || row.audio_sha256!==input.sha256) conflict(); }
        else { id=randomUUID(); await tx.execute({sql:'INSERT INTO studio_podcast_uploads VALUES (?,?,?,?,?,?,?,?,?)',args:[id,book,user,input.metadata.id,metadata,input.byteLength,input.sha256,now()+PODCAST_UPLOAD_TTL_MS,'pending']}); }
        return {uploadId:id,chunkSize:PODCAST_CHUNK_BYTES,chunkCount:Math.ceil(input.byteLength/PODCAST_CHUNK_BYTES)};
      });
    },
    async put(book,user,id,index,input) {
      const client=await owned(book,user), bytes=Buffer.from(input || []);
      return transaction(client,async tx=>{
        const row=await session(tx,book,user,id), n=indexOf(index,row.byte_length);
        if(bytes.length!==Math.min(PODCAST_CHUNK_BYTES,row.byte_length-n*PODCAST_CHUNK_BYTES)) invalid();
        const digest=hash(bytes), old=await tx.execute({sql:'SELECT chunk_sha256 FROM studio_podcast_chunks WHERE upload_id=? AND chunk_index=?',args:[id,n]});
        if(old.rows.length) { if(old.rows[0].chunk_sha256!==digest) conflict(); return {received:true,index:n}; }
        if(row.state!=='pending') conflict();
        await tx.execute({sql:'INSERT INTO studio_podcast_chunks VALUES (?,?,?,?)',args:[id,n,bytes,digest]});
        return {received:true,index:n};
      });
    },
    async complete(book,user,id) {
      const client=await owned(book,user);
      const result=await transaction(client,async tx=>{
        const row=await session(tx,book,user,id);
        if(row.state==='complete') return {existingId:row.podcast_id};
        const chunks=[];
        for(let n=0;n<Math.ceil(row.byte_length/PODCAST_CHUNK_BYTES);n++) {
          const r=await tx.execute({sql:'SELECT bytes,chunk_sha256 FROM studio_podcast_chunks WHERE upload_id=? AND chunk_index=?',args:[id,n]});
          if(!r.rows.length) invalid(); const b=Buffer.from(r.rows[0].bytes);
          if(b.length!==Math.min(PODCAST_CHUNK_BYTES,row.byte_length-n*PODCAST_CHUNK_BYTES) || hash(b)!==r.rows[0].chunk_sha256) invalid(); chunks.push(b);
        }
        const bytes=Buffer.concat(chunks); if(bytes.length!==row.byte_length || hash(bytes)!==row.audio_sha256) invalid();
        validatePodcastWav(bytes);
        const podcast=await repository.create(book,user,JSON.parse(row.metadata_json),bytes,{client:tx,chunked:true});
        await tx.execute({sql:'UPDATE studio_podcast_uploads SET state=?,expires_at=0 WHERE id=?',args:['complete',id]});
        return {podcast};
      });
      return result.podcast || repository.get(book,user,result.existingId);
    },
    async read(book,user,id,index) {
      const client=await owned(book,user), podcast=await repository.get(book,user,id), n=indexOf(index,podcast.byte_length);
      const upload=await client.execute({sql:'SELECT id FROM studio_podcast_uploads WHERE notebook_id=? AND user_id=? AND podcast_id=? AND state=?',args:[book,user,id,'complete']});
      const result=upload.rows.length ? await client.execute({sql:'SELECT bytes FROM studio_podcast_chunks WHERE upload_id=? AND chunk_index=?',args:[upload.rows[0].id,n]}) : await client.execute({sql:'SELECT substr(audio_bytes,?,?) AS bytes FROM studio_podcasts WHERE notebook_id=? AND user_id=? AND id=?',args:[n*PODCAST_CHUNK_BYTES+1,PODCAST_CHUNK_BYTES,book,user,id]});
      const bytes=Buffer.from(result.rows[0]?.bytes || []); if(bytes.length!==Math.min(PODCAST_CHUNK_BYTES,podcast.byte_length-n*PODCAST_CHUNK_BYTES)) invalid();
      return {bytes,hash:podcast.audio_sha256};
    },
    async audio(book,user,id) {
      const metadata=await repository.get(book,user,id), chunks=[];
      for(let n=0;n<Math.ceil(metadata.byte_length/PODCAST_CHUNK_BYTES);n++) chunks.push((await this.read(book,user,id,n)).bytes);
      const bytes=Buffer.concat(chunks); if(hash(bytes)!==metadata.audio_sha256) invalid(); return {bytes,hash:metadata.audio_sha256};
    },
    async delete(book,user,id) {
      const client=await owned(book,user); await repository.get(book,user,id);
      return transaction(client,async tx=>{
        const args=[book,user,id];
        await tx.execute({sql:'DELETE FROM studio_podcast_chunks WHERE upload_id IN (SELECT id FROM studio_podcast_uploads WHERE notebook_id=? AND user_id=? AND podcast_id=?)',args});
        await tx.execute({sql:'DELETE FROM studio_podcast_uploads WHERE notebook_id=? AND user_id=? AND podcast_id=?',args});
        await tx.execute({sql:'DELETE FROM studio_podcasts WHERE notebook_id=? AND user_id=? AND id=?',args}); return {success:true};
      });
    },
  };
}
