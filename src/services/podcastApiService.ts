import { API_BASE_URL } from '@/config/api';
import type { LocalPodcast } from './localStorageService';
import type { PodcastScript } from '@/lib/podcastGenerator';
import { StudioApiError } from './studioApiService';
export interface PodcastRecord extends LocalPodcast { script: PodcastScript; source_ids: string[]; persistence: 'account' | 'guest'; audio_sha256?: string; byte_length?: number }
export interface PodcastSave { id?: string; title: string; blob: Blob; duration?: number; script: PodcastScript; sourceIds: string[] }
export type RecentPodcast = Pick<PodcastRecord, 'id' | 'notebook_id' | 'title' | 'created_at' | 'duration' | 'persistence'>;
const CHUNK_BYTES = 1024 * 1024;
const MAX_BYTES = 50 * CHUNK_BYTES;
const REQUEST_TIMEOUT_MS = 15_000;
async function boundedFetch(url: string, init: RequestInit): Promise<Response> {
 const controller = new AbortController();
 const caller = init.signal;
 let timer: ReturnType<typeof setTimeout>;
 let onAbort: () => void;
 const cancelled = new Promise<never>((_, reject) => {
  onAbort = () => { controller.abort(); reject(new DOMException('Request cancelled.', 'AbortError')); };
  if (caller?.aborted) onAbort();
  else caller?.addEventListener('abort', onAbort, {once:true});
  timer = setTimeout(() => { controller.abort(); reject(new StudioApiError('Audio transfer timed out. Please retry.',408,'PODCAST_TRANSFER_TIMEOUT')); }, REQUEST_TIMEOUT_MS);
 });
 try {
  return await Promise.race([cancelled, (async () => {
   if (caller?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
   const response = await fetch(url, {...init, signal:controller.signal});
   const bytes = await response.arrayBuffer();
   return new Response([204,205,304].includes(response.status) ? null : bytes, {status:response.status,statusText:response.statusText,headers:response.headers});
  })()]);
 } finally { clearTimeout(timer!); caller?.removeEventListener('abort', onAbort!); }
}
function authorization(token?: string): Headers {
 const headers = new Headers();
 if (token && !['COOKIE_SESSION','SESSION_MANAGED_BY_COOKIE','managed_by_cookie'].includes(token)) headers.set('Authorization', `Bearer ${token}`);
 return headers;
}
async function requireSuccess(response: Response): Promise<Response> {
 if (!response.ok) {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event('auth:unauthorized'));
  throw new StudioApiError(data.error || data.message || 'Could not save or load this episode. Please retry.', response.status, data.code);
 }
 return response;
}
const invalidTransfer = () => new StudioApiError('The saved audio could not be verified. Please retry.', 422, 'PODCAST_INVALID_TRANSFER');
async function sha256(bytes: ArrayBuffer): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export async function latestSavedPodcast(token?: string): Promise<RecentPodcast | null> {
 const response = await requireSuccess(await boundedFetch(`${API_BASE_URL}/notebooks/studio/podcasts/recent`, { credentials: 'include', headers: authorization(token) }));
 return (await response.json()).podcast ?? null;
}
export function podcastApi(notebookId: string, token?: string) {
 const base = `${API_BASE_URL}/notebooks/${encodeURIComponent(notebookId)}/studio/podcasts`;
 async function request(path: string, init: RequestInit = {}, retry = false): Promise<Response> {
  const headers = authorization(token);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  for (let attempt = 0; ; attempt++) {
   let response: Response;
   try { response = await boundedFetch(base + path, { ...init, credentials: 'include', headers }); }
   catch (error) { if (error instanceof StudioApiError || (error instanceof Error && error.name === 'AbortError') || init.signal?.aborted) throw error; if (retry && attempt < 2) continue; throw error; }
   if (retry && response.status >= 500 && attempt < 2) { await response.body?.cancel(); continue; }
   return requireSuccess(response);
  }
 }
 return {
  list: async (): Promise<PodcastRecord[]> => (await (await request('')).json()).podcasts,
  save: async ({blob,...metadata}: PodcastSave): Promise<PodcastRecord> => {
   if (blob.size < 44 || blob.size > MAX_BYTES) throw invalidTransfer();
   const bytes = await blob.arrayBuffer();
   const digest = await sha256(bytes);
   const savedMetadata = { ...metadata, id: metadata.id || crypto.randomUUID() };
   const upload = await (await request('/uploads', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metadata:savedMetadata, byteLength:bytes.byteLength, sha256:digest})}, true)).json();
   const chunkCount = Math.ceil(bytes.byteLength / CHUNK_BYTES);
   if (typeof upload.uploadId !== 'string' || !upload.uploadId || upload.chunkSize !== CHUNK_BYTES || upload.chunkCount !== chunkCount) throw invalidTransfer();
   const uploadPath = `/uploads/${encodeURIComponent(upload.uploadId)}`;
   for (let index = 0; index < chunkCount; index++) {
    await request(`${uploadPath}/chunks/${index}`, {method:'PUT', headers:{'Content-Type':'application/octet-stream'}, body:bytes.slice(index * CHUNK_BYTES, Math.min((index + 1) * CHUNK_BYTES, bytes.byteLength))}, true);
   }
   return (await (await request('', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uploadId:upload.uploadId})}, true)).json()).podcast;
  },
  audio: async (id: string): Promise<Blob> => {
   const path = `/${encodeURIComponent(id)}`;
   const podcast: PodcastRecord = (await (await request(path)).json()).podcast;
   const length = podcast.byte_length;
   if (!Number.isSafeInteger(length) || length! < 44 || length! > MAX_BYTES || !/^[0-9a-f]{64}$/i.test(podcast.audio_sha256 || '')) throw invalidTransfer();
   const bytes = new Uint8Array(length!);
   for (let index = 0; index < Math.ceil(length! / CHUNK_BYTES); index++) {
    const response = await request(`${path}/audio/chunks/${index}`, {}, true);
    const expected = Math.min(CHUNK_BYTES, length! - index * CHUNK_BYTES);
    const advertised = response.headers.get('Content-Length');
    if (advertised !== null && Number(advertised) !== expected) { await response.body?.cancel(); throw invalidTransfer(); }
    const chunk = await response.arrayBuffer();
    if (chunk.byteLength !== expected) throw invalidTransfer();
    bytes.set(new Uint8Array(chunk), index * CHUNK_BYTES);
   }
   if (await sha256(bytes.buffer) !== podcast.audio_sha256!.toLowerCase()) throw invalidTransfer();
   return new Blob([bytes], {type:'audio/wav'});
  },
  remove: async (id: string) => { await request(`/${encodeURIComponent(id)}`, {method:'DELETE'}); },
 };
}
