import { createHash } from 'node:crypto';

const models = new Set(['onnx-community/whisper-base', 'onnx-community/whisper-tiny']);
const smallFiles = /^(?:config|generation_config|preprocessor_config|tokenizer_config|special_tokens_map)\.json$/;

// Opt-in observation only. Never intercept requests, retain bodies, or read model weights.
export function observeAudioAsrProvenance(page, { enabled = false, origin, configuredModel } = {}) {
  const receipt = { enabled: enabled === true, configuredModel: models.has(configuredModel) ? configuredModel : 'unspecified', browserVersion: null, assets: [] };
  const pending = new Set();
  if (!receipt.enabled) return { receipt, stop: async () => {} };
  receipt.browserVersion = page.context().browser()?.version() ?? null;
  const expectedOrigin = new URL(origin).origin;
  const onResponse = response => {
    const job = (async () => {
      let url;
      try { url = new URL(response.url()); } catch { return; }
      let asset;
      let limit = 0;
      if (url.origin === expectedOrigin && /^\/assets\/audioExtractor-[\w-]+\.js$/.test(url.pathname)) {
        asset = { kind: 'extractor', path: url.pathname };
        limit = 2 * 1024 * 1024;
      } else if (url.origin === 'https://huggingface.co') {
        const match = url.pathname.match(/^\/(onnx-community\/whisper-(?:base|tiny))\/resolve\/([\w.-]{1,80})\/(.{1,150})$/);
        if (!match || !/^(?:[\w.-]+\/)*[\w.-]+$/.test(match[3])) return;
        asset = { kind: 'public-model', model: match[1], revision: match[2], suffix: match[3] };
        if (smallFiles.test(match[3])) limit = 128 * 1024;
      } else return;
      if (receipt.assets.length >= 40) return;
      asset.status = response.status();
      asset.sha256 = null;
      asset.hashState = 'body-not-read';
      receipt.assets.push(asset);
      if (!limit || asset.status !== 200) return;
      const declared = Number(response.headers()['content-length']);
      if (!Number.isSafeInteger(declared) || declared <= 0 || declared > limit) {
        asset.hashState = 'missing-or-large-length'; return;
      }
      try {
        const body = await response.body();
        if (body.length > limit) { asset.hashState = 'large-body'; return; }
        asset.byteLength = body.length;
        asset.sha256 = createHash('sha256').update(body).digest('hex');
        asset.hashState = 'hashed';
      } catch { asset.hashState = 'unavailable'; }
    })().catch(() => {});
    pending.add(job);
    void job.finally(() => pending.delete(job));
  };
  page.on('response', onResponse);
  return { receipt, stop: async () => { page.off('response', onResponse); await Promise.allSettled([...pending]); } };
}
