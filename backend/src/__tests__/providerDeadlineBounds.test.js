import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  ["personal", 60_000],
  ["managed", 55_000],
])("enforces the %s provider deadline throughout response reading", async (mode, limit) => {
  vi.stubEnv("TITAN_TOTAL_TIMEOUT_MS", "55000");
  vi.stubEnv("TITAN_TIMEOUT_MS", "55000");
  vi.stubEnv("GROQ_API_KEY", "fixture");
  vi.resetModules();
  const { generateWithPersonalProvider } = await import("../services/personalProviderService.js");
  const { dispatchToTitan } = await import("../services/titanProvider.js");
  vi.useFakeTimers();
  let aborted = false;
  vi.stubGlobal("fetch", vi.fn(async (_url, { signal }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
      aborted = true;
      reject(signal.reason);
    }, { once: true })),
  })));
  const request = { messages: [{ role: "user", content: "Test" }], priority: "performance", timeoutMs: 120_000 };
  const pending = mode === "personal"
    ? generateWithPersonalProvider({ provider: "groq", key: "fixture", model: "model" }, request)
    : dispatchToTitan(request);
  const done = expect(pending).rejects.toBeDefined();
  await vi.advanceTimersByTimeAsync(limit);
  await done;
  expect(aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
