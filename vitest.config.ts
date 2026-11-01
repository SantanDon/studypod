import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/vitest.setup.ts"],
    testTimeout: 30000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.ai-bridge/**",
      "e2e/full-flow-decision.test.mjs",
      "e2e/full-flow-reporter.test.mjs",
      "e2e/audio-fidelity.helpers.test.mjs",
      "e2e/candidate-inputs.test.mjs",
      "e2e/acceptance-contracts.test.mjs",
      "e2e/runner-lifecycle.test.mjs",
      "e2e/audio-asr-provenance.test.mjs",
      "e2e/audio-pcm-diagnostic.test.mjs",
      "e2e/shared-account-audio-policy.test.mjs",
      "e2e/shared-account-audiobook-policy.test.mjs",
      "e2e/shared-account-diagnostics.test.mjs",
      "e2e/shared-account-full-policy.test.mjs",
      "e2e/shared-account-policy.test.mjs",
      "e2e/shared-account-studio-diagnostics.test.mjs",
      "e2e/shared-preview-access.test.mjs",
      "e2e/shared-release-candidate.test.mjs",
      "backend/src/routes/proxy.error-forwarding.test.mjs",
      "backend/src/routes/youtube.error-forwarding.test.mjs",
      "backend/src/routes/audiobook.extract-diagnostics.test.mjs",
      "backend/src/__tests__/audiobookRenderAdmission.test.js",
      "scripts/write-deployment-identity.test.mjs",
      "backend/src/__tests__/notebookRecovery.test.js",
      "src/__tests__/integration/repositories.test.ts",
    ],
  },
});
