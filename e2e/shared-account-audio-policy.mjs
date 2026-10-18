import { createSharedFullPolicy } from './shared-account-full-policy.mjs';
const hosts = new Set(['huggingface.co','cdn-lfs.huggingface.co','cdn-lfs-us-1.huggingface.co','cdn-lfs-eu-1.huggingface.co','cdn.jsdelivr.net','cas-bridge.xethub.hf.co','cas-server.xethub.hf.co','transfer.xethub.hf.co']);
export function createSharedAudioPolicy(origin) {
 const base = createSharedFullPolicy(origin); let verified = false;
 return { ...base, verifyIdentity() { base.verifyIdentity(); verified = true; }, decide(rawUrl, method) {
  const original = base.decide(rawUrl, method); if (original.allowed) return original;
  const url = new URL(rawUrl);
      if (url.username || url.password) return original; const name = url.pathname.split('/').pop() || '';
  const asset = /\.(?:onnx|wasm)$/.test(name) || /^[ab][fm]_[a-z]+\.bin$/.test(name) || /^(?:model[-.\w]*|pytorch_model)\.bin$/.test(name) || /^(?:config|tokenizer|tokenizer_config|generation_config|special_tokens_map|preprocessor_config)\.json$/.test(name) || /^ort[-.\w]*\.(?:mjs|js)$/.test(name);
  if (verified && base.ids().length === 1 && method.toUpperCase() === 'GET' && url.protocol === 'https:' && hosts.has(url.hostname) && asset) return { allowed: true };
  return original;
 }};
}
