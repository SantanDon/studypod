import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { cloud, local } = vi.hoisted(() => ({ cloud: vi.fn(), local: vi.fn() }));
vi.mock("@/lib/ai/serverAiClient", () => ({ generateServerAiResponse: cloud }));
vi.mock("@/lib/ai/openAICompatibleLocalClient", () => ({ completeCompatibleLocalChat: local }));

beforeEach(() => {
  localStorage.clear(); cloud.mockReset(); local.mockReset(); vi.resetModules();
  vi.stubEnv("VITE_ENABLE_OLLAMA", "false");
});
afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); vi.resetModules(); });

it("routes compatible provider chat with its selected model, overriding task defaults, and does not fall back on error", async () => {
  const settings = await import("@/config/localModelConfig");
  settings.saveLocalModelSettings({ provider: "lm-studio", model: "qwen3.5:9b", enabled: true });
  local.mockRejectedValue(new Error("Local model generation failed (503)"));
  const { chatCompletion } = await import("@/lib/ai/ollamaService");
  await expect(chatCompletion({ messages: [{ role: "user", content: "Hello" }], model: "llama3.2:1b" })).rejects.toThrow("Local model generation failed (503)");
  expect(local).toHaveBeenCalledWith(expect.objectContaining({ model: "qwen3.5:9b" }));
  expect(cloud).not.toHaveBeenCalled();
});
