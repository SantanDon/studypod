import { createSharedMutationPolicy } from './shared-account-policy.mjs';
// The extraction API has no notebook identifier. Require the exact synthetic file
// selected by this run instead of granting a global POST exception.
function matchesApprovedFile(request, fixture) {
  if (!fixture || !request || !Buffer.isBuffer(request.body)) return false;
  const boundary = /^multipart\/form-data;\s*boundary=(?:"([a-zA-Z0-9'()+_,.\/:=?-]{1,70})"|([a-zA-Z0-9'()+_,.\/:=?-]{1,70}))$/i.exec(request.contentType || '');
  if (!boundary) return false;
  const marker = boundary[1] || boundary[2];
  const prefix = Buffer.from('--' + marker + '\r\n');
  const body = request.body;
  const closing = '\r\n--' + marker + '--';
  const suffix = Buffer.from(closing + (body.subarray(-2).equals(Buffer.from('\r\n')) ? '\r\n' : ''));
  if (!body.subarray(0, prefix.length).equals(prefix) || !body.subarray(-suffix.length).equals(suffix)) return false;
  const headerEnd = body.indexOf('\r\n\r\n', prefix.length);
  if (headerEnd < 0 || headerEnd - prefix.length > 1024) return false;
  const headers = body.subarray(prefix.length, headerEnd).toString('utf8').split('\r\n');
  if (headers.length !== 2) return false;
  const disposition = headers.find(header => /^content-disposition:/i.test(header));
  const type = headers.find(header => /^content-type:/i.test(header));
  if (disposition !== 'Content-Disposition: form-data; name="file"; filename="' + fixture.name + '"' || (type || '').toLowerCase() !== 'content-type: ' + fixture.type) return false;
  // An additional part, metadata field, or changed file fails this byte comparison.
  return body.subarray(headerEnd + 4, body.length - suffix.length).equals(fixture.bytes);
}


// Model downloads are read-only and enabled only for the current audio scenario.
function isWhisperAsset(url) {
  if (url.origin === 'https://huggingface.co') return /^\/onnx-community\/whisper-(?:tiny|base)\/resolve\/main\/(?:config\.json|tokenizer_config\.json|tokenizer\.json|preprocessor_config\.json|generation_config\.json|onnx\/(?:encoder_model_quantized|decoder_model_merged_quantized)\.onnx)$/.test(url.pathname);
  return url.origin === 'https://cdn.jsdelivr.net' && /^\/npm\/onnxruntime-web@1\.31\.0-dev\.20260914-8d85527a0\/dist\/ort-wasm-simd-threaded\.asyncify\.(?:mjs|wasm)$/.test(url.pathname);
}

// Each scenario creates exactly one notebook; all user data mutations remain scoped to it.
export function createSharedFullPolicy(origin) {
  const base = createSharedMutationPolicy(origin);
  let approvedPdf;
  let approvedEpub;
  let audioAssetsEnabled = false;
  const globalPosts = new Set(['/api/ai/generate', '/api/proxy/extract-web', '/api/youtube/youtube-transcript', '/api/youtube-edge']);
  const scoped = /^(?:sources(?:\/[a-zA-Z0-9-]+)?|messages|chat|notes(?:\/[a-zA-Z0-9-]+)?|research-goals(?:\/[a-zA-Z0-9-]+)?|studio\/(?:maps|decks|quizzes|podcasts)(?:\/[a-zA-Z0-9-]+)*(?:\/chunks\/\d+)?)$/;
  return {
    ...base,
    registerPdfFixture(name, bytes) {
      if (approvedPdf || base.ids().length !== 1 || name !== 'cedar.pdf' || !Buffer.isBuffer(bytes) || bytes.length > 50 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF fixture must belong to the captured QA notebook');
      approvedPdf = { name, type: 'application/pdf', bytes: Buffer.from(bytes) };
    },
    registerEpubFixture(name, bytes) {
      if (approvedEpub || base.ids().length !== 1 || name !== 'cedar.epub' || !Buffer.isBuffer(bytes) || bytes.length > 50 * 1024 * 1024 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('EPUB fixture must belong to the captured QA notebook');
      approvedEpub = { name, type: 'application/epub+zip', bytes: Buffer.from(bytes) };
    },
    registerAudioAssets() {
      if (base.ids().length !== 1) throw new Error('Audio assets require a captured QA notebook');
      audioAssetsEnabled = true;
    },
    decide(rawUrl, method, request) {
      const original = base.decide(rawUrl, method);
      const url = new URL(rawUrl);
      const verb = method.toUpperCase();
      if (audioAssetsEnabled && base.ids().length === 1 && ['GET', 'HEAD'].includes(verb) && !url.search && isWhisperAsset(url)) return { allowed: true };
      if (original.allowed || original.reason !== 'mutation-outside-run') return original;
      if (url.origin !== origin || base.ids().length !== 1) return original;
      if (url.pathname === '/api/pdf/process-pdf') {
        return verb === 'POST' && !url.search && matchesApprovedFile(request, approvedPdf)
          ? { allowed: true } : { allowed: false, reason: 'pdf-extraction-not-approved' };
      }
      if (url.pathname === '/api/audiobook/extract') {
        return verb === 'POST' && url.search === '?persist=false' && matchesApprovedFile(request, approvedEpub)
          ? { allowed: true } : { allowed: false, reason: 'epub-extraction-not-approved' };
      }
      if (verb === 'POST' && globalPosts.has(url.pathname)) return { allowed: true };
      const match = url.pathname.match(/^\/api\/notebooks\/([a-zA-Z0-9-]+)\/(.+)$/);
      if (match && base.ids().includes(match[1]) && scoped.test(match[2]) && ['POST', 'PUT', 'DELETE'].includes(verb)) return { allowed: true };
      return original;
    },
  };
}
