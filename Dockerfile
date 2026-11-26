# Use glibc for the native CPU inference and database libraries.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY scripts/install-backend.js ./scripts/install-backend.js
RUN CI=true npm ci && CI=true npm ci --prefix backend
COPY . .
RUN npm run build && CI=true npm prune --omit=dev && CI=true npm prune --omit=dev --prefix backend

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3001 STUDYPOD_BIND_HOST=0.0.0.0 \
    AUDIOBOOK_STORAGE_DIR=/data/audiobooks
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/src ./backend/src
COPY --from=builder /app/dist ./dist
RUN install -d -o node -g node /data /app/uploads /app/.cache \
    /app/node_modules/kokoro-js/node_modules/@huggingface/transformers/.cache \
    /app/node_modules/@huggingface/transformers/.cache
USER node
EXPOSE 3001
CMD ["node", "backend/src/server.js"]
