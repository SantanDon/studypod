import { afterEach, describe, expect, it, vi } from 'vitest';
import { podcastApi, type PodcastRecord } from '@/services/podcastApiService';
import { StudioApiError } from '@/services/studioApiService';

afterEach(() => {
 vi.unstubAllGlobals();
 vi.useRealTimers();
});

const id = 'c7d105df-7012-49e2-95bf-2eb93bc41e03';
const notebookId = 'notebook-1';
const pathname = (url: string) => new URL(url, 'http://localhost').pathname;

async function digest(blob: Blob) {
 const bytes = await blob.arrayBuffer();
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function response(body: unknown, status = 200) {
 return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('podcastApi save completion reconciliation', () => {
 it('returns the exact matching saved record when completion errors after commit', async () => {
  const blob = new Blob([new Uint8Array(44)], { type: 'audio/wav' });
  const audioHash = await digest(blob);
  const record = { id, notebook_id: notebookId, title: 'Recovered', created_at: '2026-11-01T00:00:00.000Z', audio_blob_id: id, script: {}, source_ids: [], persistence: 'account', audio_sha256: audioHash, byte_length: blob.size } as PodcastRecord;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
   const url = String(input); calls.push({ url, init });
   if (url.endsWith('/uploads') && init?.method === 'POST') return Promise.resolve(response({ uploadId: 'upload-1', chunkSize: 1024 * 1024, chunkCount: 1 }));
   if (url.endsWith('/chunks/0')) return Promise.resolve(response({ received: true, index: 0 }));
   if (pathname(url) === `/api/notebooks/${notebookId}/studio/podcasts` && init?.method === 'POST') return Promise.resolve(response({ error: 'response lost after commit' }, 500));
   if (pathname(url) === `/api/notebooks/${notebookId}/studio/podcasts/${id}` && !init?.method) return Promise.resolve(response({ podcast: record }));
   throw new Error(`Unexpected request: ${init?.method || 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(podcastApi(notebookId).save({ id, title: 'Recovered', blob, script: {} as PodcastRecord['script'], sourceIds: [] })).resolves.toEqual(record);
  expect(calls.some(call => call.url.endsWith(`/studio/podcasts/${id}`))).toBe(true);
  const startBody = JSON.parse(String(calls.find(call => call.url.endsWith('/uploads'))?.init?.body));
  expect(startBody.metadata.id).toBe(id);
  expect(calls.filter(call => call.url.endsWith('/uploads'))).toHaveLength(1);
  const completionBodies = calls.filter(call => call.url.endsWith('/studio/podcasts') && call.init?.method === 'POST').map(call => JSON.parse(String(call.init?.body)));
  expect(completionBodies).toHaveLength(3);
  expect(completionBodies.every(body => body.uploadId === 'upload-1')).toBe(true);
 });

 it('rejects reconciliation when the exact ID has different audio metadata', async () => {
  const blob = new Blob([new Uint8Array(44)], { type: 'audio/wav' });
  const wrongRecord = { id, notebook_id: notebookId, title: 'Different', created_at: '2026-11-01T00:00:00.000Z', audio_blob_id: id, script: {}, source_ids: [], persistence: 'account', audio_sha256: '0'.repeat(64), byte_length: blob.size } as PodcastRecord;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
   const url = String(input);
   if (url.endsWith('/uploads') && init?.method === 'POST') return Promise.resolve(response({ uploadId: 'upload-1', chunkSize: 1024 * 1024, chunkCount: 1 }));
   if (url.endsWith('/chunks/0')) return Promise.resolve(response({ received: true, index: 0 }));
   if (pathname(url) === `/api/notebooks/${notebookId}/studio/podcasts` && init?.method === 'POST') return Promise.resolve(response({ error: 'response lost after commit' }, 500));
   if (pathname(url) === `/api/notebooks/${notebookId}/studio/podcasts/${id}` && !init?.method) return Promise.resolve(response({ podcast: wrongRecord }));
   throw new Error(`Unexpected request: ${init?.method || 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(podcastApi(notebookId).save({ id, title: 'Original', blob, script: {} as PodcastRecord['script'], sourceIds: [] })).rejects.toMatchObject<Partial<StudioApiError>>({ code: 'PODCAST_INVALID_TRANSFER', status: 422 });
 });
});

describe('podcastApi audio download', () => {
 it('downloads at most three chunks concurrently and restores their original order', async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 44);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const expectedHash = await digest(new Blob([bytes]));
  const completionOrder: number[] = [];
  let active = 0;
  let maxActive = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
   const url = String(input);
   const path = pathname(url);
   if (path.endsWith(`/studio/podcasts/${id}`)) return response({ podcast: { id, byte_length: bytes.length, audio_sha256: expectedHash } });
   const match = path.match(/\/audio\/chunks\/(\d+)$/);
   if (!match) throw new Error(`Unexpected request: ${url}`);
   const index = Number(match[1]);
   active++;
   maxActive = Math.max(maxActive, active);
   await new Promise(resolve => setTimeout(resolve, [15, 8, 1][index] ?? 0));
   active--;
   completionOrder.push(index);
   const start = index * 1024 * 1024;
   const chunk = bytes.slice(start, Math.min(start + 1024 * 1024, bytes.length));
   return new Response(chunk, { headers: { 'Content-Length': String(chunk.length) } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const downloaded = await podcastApi(notebookId).audio(id);
  expect(maxActive).toBe(3);
  expect(completionOrder).not.toEqual([0, 1, 2]);
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
 });

 it('rejects a chunk whose body length differs from its expected range', async () => {
  const bytes = new Uint8Array(44);
  const audioHash = await digest(new Blob([bytes]));
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
   const path = pathname(String(input));
   if (path.endsWith(`/studio/podcasts/${id}`)) return Promise.resolve(response({ podcast: { id, byte_length: 44, audio_sha256: audioHash } }));
   if (path.endsWith('/audio/chunks/0')) return Promise.resolve(new Response(new Uint8Array(43), { headers: { 'Content-Length': '43' } }));
   throw new Error(`Unexpected request: ${String(input)}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  await expect(podcastApi(notebookId).audio(id)).rejects.toMatchObject<Partial<StudioApiError>>({ code: 'PODCAST_INVALID_TRANSFER', status: 422 });
 });

 it('aborts in-flight workers and does not queue more chunks after a chunk fails', async () => {
  const length = 3 * 1024 * 1024 + 44;
  const requestedChunks: number[] = [];
  let abortedWorkers = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
   const path = pathname(String(input));
   if (path.endsWith(`/studio/podcasts/${id}`)) return Promise.resolve(response({ podcast: { id, byte_length: length, audio_sha256: 'a'.repeat(64) } }));
   const match = path.match(/\/audio\/chunks\/(\d+)$/);
   if (!match) throw new Error(`Unexpected request: ${String(input)}`);
   const index = Number(match[1]);
   requestedChunks.push(index);
   if (index === 0) return Promise.resolve(new Response(new Uint8Array(1), { headers: { 'Content-Length': '1' } }));
   return new Promise((_, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) { abortedWorkers++; reject(new DOMException('Aborted', 'AbortError')); return; }
    signal?.addEventListener('abort', () => { abortedWorkers++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
   });
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(podcastApi(notebookId).audio(id)).rejects.toMatchObject<Partial<StudioApiError>>({ code: 'PODCAST_INVALID_TRANSFER', status: 422 });
  expect(requestedChunks).toEqual([0, 1, 2]);
  expect(abortedWorkers).toBe(2);
 });

 it('aborts a stalled multi-request download at its overall deadline with a useful error', async () => {
  vi.useFakeTimers();
  const scheduleTimer = globalThis.setTimeout.bind(globalThis);
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
   scheduleTimer(handler, timeout === 15 * 60_000 ? 1 : timeout, ...args)) as typeof setTimeout);
  const length = 44;
  let chunkAborted = false;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
   const path = pathname(String(input));
   if (path.endsWith(`/studio/podcasts/${id}`)) return Promise.resolve(response({ podcast: { id, byte_length: length, audio_sha256: 'a'.repeat(64) } }));
   if (path.endsWith('/audio/chunks/0')) return new Promise((_, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) { chunkAborted = true; reject(new DOMException('Aborted', 'AbortError')); return; }
    signal?.addEventListener('abort', () => { chunkAborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
   });
   throw new Error(`Unexpected request: ${String(input)}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const download = podcastApi(notebookId).audio(id).then(value => ({ value }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(2);
  const outcome = await download;
  expect('error' in outcome ? outcome.error : undefined).toMatchObject<Partial<StudioApiError>>({ code: 'PODCAST_DOWNLOAD_TIMEOUT', status: 408, message: 'Audio took too long to load. Please try again.' });
  expect(chunkAborted).toBe(true);
 });
});
