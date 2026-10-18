import { measureAcceptancePhase } from "../utils/acceptanceTiming.js";
import { createHash } from 'node:crypto';
import { getDatabase } from '../db/database.js';

export const MAX_PODCAST_BYTES = 50 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const invalid = message => fail('PODCAST_INVALID_PAYLOAD', message);
const missing = () => fail('PODCAST_NOT_FOUND', 'Podcast not found or access denied.');

// Parse the bytes themselves: a MIME declaration is not an audio validation.
export function validatePodcastWav(input) {
  const bytes = Buffer.from(input || []);
  if (bytes.length < 44 || bytes.length > MAX_PODCAST_BYTES || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid('A complete WAV file within 50 MiB is required.');
  let fmt, data;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) invalid('Truncated WAV chunk.');
    const tag = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) invalid('Truncated WAV data.');
    if (tag === 'fmt ') { if (fmt || size < 16) invalid('Invalid WAV format.'); fmt = bytes.subarray(start, start + size); }
    if (tag === 'data') { if (data) invalid('Multiple WAV data chunks are unsupported.'); data = bytes.subarray(start, start + size); }
    offset = start + size + (size % 2);
    if (offset > bytes.length) invalid('Truncated WAV padding.');
  }
  if (!fmt || !data?.length) invalid('WAV format and samples are required.');
  const format = fmt.readUInt16LE(0), channels = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4), block = fmt.readUInt16LE(12), bits = fmt.readUInt16LE(14);
  if (!((format === 1 && bits === 16) || (format === 3 && bits === 32)) || channels < 1 || channels > 2 || rate < 8000 || rate > 96000 || block !== channels * bits / 8 || fmt.readUInt32LE(8) !== rate * block || data.length % block) invalid('Unsupported or inconsistent WAV format.');
  let energy = 0;
  for (let offset = 0; offset < data.length; offset += bits / 8) {
    const value = format === 1 ? data.readInt16LE(offset) / 32768 : data.readFloatLE(offset);
    if (!Number.isFinite(value) || Math.abs(value) > 1) invalid('Invalid audio samples.');
    energy += value * value;
  }
  if (Math.sqrt(energy / (data.length / (bits / 8))) < 0.0001) invalid('Audio is silent.');
  const duration = data.length / block / rate;
  if (duration < 0.1 || duration > 7200) invalid('Audio duration is outside the supported range.');
  return { bytes, duration, hash: createHash('sha256').update(bytes).digest('hex') };
}

const columns = 'id,notebook_id,title,created_at,duration,audio_sha256,byte_length,script_json,source_ids_json';
const record = row => ({ id: row.id, notebook_id: row.notebook_id, title: row.title, created_at: row.created_at, duration: row.duration, audio_blob_id: row.id, persistence: 'account', audio_sha256: row.audio_sha256, byte_length: row.byte_length, script: JSON.parse(row.script_json), source_ids: JSON.parse(row.source_ids_json) });

export async function validatePodcastMetadata(client, notebookId, userId, metadata) {
      if (!metadata || !uuid.test(metadata.id || '') || typeof metadata.title !== 'string' || !metadata.title.trim() || metadata.title.length > 300) invalid('A unique podcast id and title are required.');
      const script = metadata.script;
      if (!script || typeof script !== 'object' || !Array.isArray(script.segments) || !script.segments.length || script.segments.length > 1000 || script.segments.some(segment => typeof segment?.speaker !== 'string' || !segment.speaker.trim() || segment.speaker.length > 100 || typeof segment.text !== 'string' || !segment.text.trim())) invalid('The generated script is required.');
      const scriptJson = JSON.stringify(script);
      if (Buffer.byteLength(scriptJson) > 512 * 1024) invalid('Script exceeds the supported size.');
      if (!Array.isArray(metadata.sourceIds) || !metadata.sourceIds.length || metadata.sourceIds.length > 100 || metadata.sourceIds.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(metadata.sourceIds).size !== metadata.sourceIds.length) invalid('Unique source ids are required.');
      for (const id of metadata.sourceIds) {
        const source = await measureAcceptancePhase('source-owner', () => client.execute({ sql: 'SELECT id FROM sources WHERE id=? AND notebook_id=? AND user_id=?', args: [id, notebookId, userId] }), { count: 1 });
        if (!source.rows.length) invalid('A referenced source is unavailable in this notebook.');
      }
  return { scriptJson };
}

export function createPodcastRepository({ getDatabase: database = getDatabase } = {}) {
  async function ensureSchema(client) {
    await measureAcceptancePhase('schema', () => client.execute(`CREATE TABLE IF NOT EXISTS studio_podcasts (
      id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,
      created_at TEXT NOT NULL, duration REAL NOT NULL, audio_sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL, script_json TEXT NOT NULL, source_ids_json TEXT NOT NULL, audio_bytes BLOB NOT NULL)`));
  }
  async function owned(notebookId, userId) {
    const db = await database(), client = db.$client;
    const result = await measureAcceptancePhase('owner', () => client.execute({ sql: 'SELECT id FROM notebooks WHERE id=? AND user_id=?', args: [notebookId, userId] }));
    if (!result.rows.length) missing();
    await ensureSchema(client);
    return client;
  }
  async function find(client, notebookId, userId, id, audio = false) {
    const result = await measureAcceptancePhase('read', () => client.execute({ sql: `SELECT ${audio ? 'audio_bytes,audio_sha256' : columns} FROM studio_podcasts WHERE notebook_id=? AND user_id=? AND id=?`, args: [notebookId, userId, id] }));
    if (!result.rows.length) missing();
    return result.rows[0];
  }
  return {
    assertOwner: async (notebookId, userId) => { await owned(notebookId, userId); },
    async recent(userId) {
      const db = await database(), client = db.$client;
      await ensureSchema(client);
      const result = await client.execute({ sql: `SELECT p.id,p.notebook_id,p.title,p.created_at,p.duration FROM studio_podcasts p INNER JOIN notebooks n ON n.id=p.notebook_id AND n.user_id=p.user_id WHERE p.user_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 1`, args: [userId] });
      return result.rows[0] ? { id: result.rows[0].id, notebook_id: result.rows[0].notebook_id, title: result.rows[0].title, created_at: result.rows[0].created_at, duration: result.rows[0].duration, persistence: 'account' } : null;
    },
    async list(notebookId, userId) {
      const client = await owned(notebookId, userId);
      const result = await client.execute({ sql: `SELECT ${columns} FROM studio_podcasts WHERE notebook_id=? AND user_id=? ORDER BY created_at DESC`, args: [notebookId, userId] });
      return result.rows.map(record);
    },
    async get(notebookId, userId, id) { return record(await find(await owned(notebookId, userId), notebookId, userId, id)); },
    async audio(notebookId, userId, id) { const row = await find(await owned(notebookId, userId), notebookId, userId, id, true); return { bytes: measureAcceptancePhase('copy', () => Buffer.from(row.audio_bytes), { bytes: row.audio_bytes.length }), hash: row.audio_sha256 }; },
    async delete(notebookId, userId, id) {
      const client = await owned(notebookId, userId);
      await find(client, notebookId, userId, id);
      await client.execute({ sql: 'DELETE FROM studio_podcasts WHERE notebook_id=? AND user_id=? AND id=?', args: [notebookId, userId, id] });
      return { success: true };
    },
    async create(notebookId, userId, metadata, input, internal = {}) {
      const client = internal.client || await owned(notebookId, userId);
      const { scriptJson } = await validatePodcastMetadata(client, notebookId, userId, metadata);
      const audio = measureAcceptancePhase('validate', () => validatePodcastWav(input), { bytes: input?.length }), sourceJson = JSON.stringify(metadata.sourceIds), title = metadata.title.trim();
      if (metadata.duration != null && (!Number.isFinite(metadata.duration) || Math.abs(metadata.duration - audio.duration) > Math.max(1, audio.duration * 0.02))) invalid('Declared duration does not match audio.');
      // A single insert commits the validated bytes and their provenance together.
      await measureAcceptancePhase('blob-insert', () => client.execute({ sql: `INSERT INTO studio_podcasts (id,notebook_id,user_id,title,created_at,duration,audio_sha256,byte_length,script_json,source_ids_json,audio_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, args: [metadata.id, notebookId, userId, title, new Date().toISOString(), audio.duration, audio.hash, audio.bytes.length, scriptJson, sourceJson, internal.chunked ? Buffer.alloc(0) : audio.bytes] }), { bytes: audio.bytes.length, count: metadata.sourceIds.length });
      const row = await find(client, notebookId, userId, metadata.id);
      if (row.audio_sha256 !== audio.hash || row.title !== title || row.script_json !== scriptJson || row.source_ids_json !== sourceJson) fail('PODCAST_CONFLICT', 'This podcast id already has different content.');
      return record(row);
    },
  };
}
export const podcastRepository = createPodcastRepository();
