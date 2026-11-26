# Dedicated StudyPod audio Sprite

This runs the StudyPod web app and its CPU audiobook worker on one origin. The dedicated Sprite maintains its own accounts and books. Use a fresh checkout of the reviewed commit on a **separate Sprite**, without copying local environment files or production credentials. Its filesystem retains the SQLite database, audiobook chapters, signing key and installed model between wakes.

On the new Sprite, from the repository root, use Node.js 22, FFmpeg and the CPU runtime. On Ubuntu, install FFmpeg and libgomp1 with the system package manager if missing. The model downloads on the first preflight.

```sh
node --version
export CI=true ONNXRUNTIME_NODE_INSTALL_CUDA=skip
npm ci
npm ci --prefix backend
VITE_API_URL=/api npm run build
node deploy/sprite-audio/preflight.mjs
```

The preflight synthesizes a spoken sentence and reports duration, available CPU and peak renderer memory. Use a single concurrent render. Register the server as a Sprite Service from this same checkout. Replace the example origin with the dedicated Sprite origin from `sprite info`.

```sh
audio_origin=https://studypod-audio-EXAMPLE.sprites.app
install -d -m 700 "$HOME/.local/share/studypod-audio"
printf '%s\n' "$audio_origin" > "$HOME/.local/share/studypod-audio/origin"
sprite-env services create studypod-audio --cmd "$(command -v node)" --args "$(pwd)/deploy/sprite-audio/start.mjs"
```

The service listens on port 8080. Verify the Sprite's HTTP service port in its configuration, then check `/api/health`, sign in to a dedicated demo account and render a chapter. Play the resulting audio and open the saved chapter again after the next wake. An interrupted render may be resumed from the audiobook view. Leave the Passage Finder Sprite and its connectors untouched.
