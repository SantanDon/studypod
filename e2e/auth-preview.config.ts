import { Agent } from 'node:http';
import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: process.env.STUDYPOD_AUTH_BUILD_DIR || 'dist' },
  preview: { host: '127.0.0.1', port: 4178, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4018', agent: new Agent({ keepAlive: true }) } } },
});
