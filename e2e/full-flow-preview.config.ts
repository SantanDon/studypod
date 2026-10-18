import { Agent } from 'node:http';
import { defineConfig } from 'vite';
import { previewTimingFromEnvironment } from './preview-timing.mjs';
const previewTiming = previewTimingFromEnvironment();
export default defineConfig({
  plugins: [previewTiming.plugin],
  build: { outDir: process.env.STUDYPOD_FULL_BUILD_DIR },
  preview: { host: '127.0.0.1', port: 4182, strictPort: true,
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
    proxy: { '/api': { target: 'http://127.0.0.1:4020', agent: new Agent({ keepAlive: true }), configure: previewTiming.configureProxy } } },
});
