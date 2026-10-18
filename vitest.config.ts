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
      "backend/src/routes/proxy.error-forwarding.test.mjs",
      "backend/src/routes/youtube.error-forwarding.test.mjs",
      "scripts/write-deployment-identity.test.mjs",
      "backend/src/__tests__/notebookRecovery.test.js",
      "src/__tests__/integration/repositories.test.ts",
    ],
  },
});
