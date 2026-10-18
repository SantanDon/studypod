import { afterEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({ logger: log }));

describe("Groq brief rate-window recovery", () => {
  async function setup(fallbackEnabled = false, model = "") {
    for (const key of ["OPENAI_API_KEY", "VITE_GROQ_API_KEY", "TOKENLLM7_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OLLAMA_BASE_URL", "GROQ_MODEL"]) vi.stubEnv(key, "");
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("GROQ_MODEL", model);
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("TOKENLLM7_ENABLED", fallbackEnabled ? "true" : "false");
    vi.resetModules();
    return import("../services/titanProvider.js");
  }
  const request = { messages: [{ role: "user", content: "Explain the source." }], priority: "performance" };
  const failure = (message, headers = {}, status = 429) => ({
    ok: false, status,
    headers: { get: (name) => headers[name] || null },
    text: async () => JSON.stringify({ error: { message } }),
  });
  const success = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "Recovered grounded answer" } }] }) });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("uses the explicit subsecond request window instead of the full token refill", async () => {
    const { dispatchToTitan, getAvailableProviders } = await setup();
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(
      "Rate limit reached for model: Limit 7000, Used 1880, Requested 5156. Please try again in 308.571428ms.",
      { "x-ratelimit-reset-tokens": "25s" },
    )).mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetchMock);
    const pending = expect(dispatchToTitan(request)).resolves.toMatchObject({ answer: "Recovered grounded answer" });
    await vi.advanceTimersByTimeAsync(358);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAvailableProviders().GROQ.available).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors Retry-After before the full token reset", async () => {
    const { dispatchToTitan } = await setup();
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(failure("Rate limit reached", {
      "retry-after": "0.1", "x-ratelimit-reset-tokens": "25s",
    })).mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetchMock);
    const pending = expect(dispatchToTitan(request)).resolves.toMatchObject({ answer: "Recovered grounded answer" });
    await vi.advanceTimersByTimeAsync(149);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries only once, preserves provider fallback, and avoids a blanket cooldown", async () => {
    const { dispatchToTitan, getAvailableProviders } = await setup(true);
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url) => url.includes("groq.com")
      ? failure("Rate limit reached. Please try again in 100ms.") : success());
    vi.stubGlobal("fetch", fetchMock);
    const pending = expect(dispatchToTitan(request)).resolves.toMatchObject({ answer: "Recovered grounded answer" });
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("groq.com"))).toHaveLength(2);
    expect(getAvailableProviders().GROQ.available).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(getAvailableProviders().GROQ.available).toBe(true);
  });

  it.each([
    [429, "Dailyquota exhausted. Please try again in 100ms.", {}],
    [429, "Authentication required. Please try again in 100ms.", {}],
    [429, "Rate limit reached. Please try again in 3s.", {}],
    [429, "Rate limit reached.", {}],
    [429, "Please try again in 100ms.", { "retry-after": "10" }],
    [401, "Please try again in 100ms.", {}],
    [403, "Please try again in 100ms.", {}],
  ])("does not retry quota, unknown, long or auth failures (%s, %s)", async (status, message, headers) => {
    const { dispatchToTitan } = await setup();
    const fetchMock = vi.fn(async () => failure(message, headers, status));
    vi.stubGlobal("fetch", fetchMock);
    await expect(dispatchToTitan(request)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not spend the remaining request budget on a rate wait", async () => {
    const { dispatchToTitan } = await setup();
    const fetchMock = vi.fn(async () => failure("Please try again in 300ms."));
    vi.stubGlobal("fetch", fetchMock);
    await expect(dispatchToTitan({ ...request, timeoutMs: 1_200 })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the recovered Groq model when its first request is briefly rate limited", async () => {
    const { dispatchToTitan } = await setup(false, "retired-model");
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failure("Model not found", {}, 404))
      .mockResolvedValueOnce(failure("Please try again in 100ms."))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetchMock);
    const pending = expect(dispatchToTitan(request)).resolves.toMatchObject({ modelUsed: "qwen/qwen3.8-27b" });
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).model))
      .toEqual(["retired-model", "qwen/qwen3.8-27b", "qwen/qwen3.8-27b"]);
  });

  it("cancels the rate wait with the original request and cleans up timers", async () => {
    const { dispatchToTitan } = await setup();
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => failure("Please try again in 300ms."));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = expect(dispatchToTitan({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("LLM7 model availability recovery", () => {
  function isolate(model = "retired-model") {
    for (const key of ["OPENAI_API_KEY", "GROQ_API_KEY", "VITE_GROQ_API_KEY", "TOKENLLM7_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OLLAMA_BASE_URL"]) vi.stubEnv(key, "");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("TOKENLLM7_ENABLED", "true");
    vi.stubEnv("TOKENLLM7_MODEL", model);
    vi.resetModules();
  }
  const failure = (status, message) => ({ ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message } }) });
  const success = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "Supported response" } }] }) });
  const request = { messages: [{ role: "user", content: "Summarize the source." }], priority: "context" };
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("defaults to the public-catalogue LLM7 model", async () => {
    isolate("");
    const fetchMock = vi.fn(async () => success());
    vi.stubGlobal("fetch", fetchMock);
    const { dispatchToTitan } = await import("../services/titanProvider.js");
    expect(await dispatchToTitan(request)).toMatchObject({ modelUsed: "mistral-Nemo-Instruct-2407" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("mistral-Nemo-Instruct-2407");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 404])("recovers once from explicit unavailable-model status %s", async (status) => {
    isolate();
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(status, "Model 'retired-model' is currently unavailable.")).mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetchMock);
    const { dispatchToTitan } = await import("../services/titanProvider.js");
    expect(await dispatchToTitan(request)).toMatchObject({ answer: "Supported response", modelUsed: "mistral-Nemo-Instruct-2407" });
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual(["retired-model", "mistral-Nemo-Instruct-2407"]);
  });

  it.each([[400, "Invalid request format"], [401, "Model is currently unavailable"], [403, "Forbidden"], [429, "Rate limit"], [404, "Endpoint not found"], [500, "Model is currently unavailable"]])("does not retry unrelated/auth/rate/server failure %s %s", async (status, message) => {
    isolate();
    const fetchMock = vi.fn(async () => failure(status, message));
    vi.stubGlobal("fetch", fetchMock);
    const { dispatchToTitan } = await import("../services/titanProvider.js");
    await expect(dispatchToTitan(request)).rejects.toMatchObject({ name: "ProviderUnavailableError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["retired-model", "mistral-Nemo-Instruct-2407"])("fails closed without looping when fallback is unavailable (%s)", async (model) => {
    isolate(model);
    const fetchMock = vi.fn(async () => failure(400, "Model is currently unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const { dispatchToTitan } = await import("../services/titanProvider.js");
    await expect(dispatchToTitan(request)).rejects.toMatchObject({ name: "ProviderUnavailableError" });
    expect(fetchMock).toHaveBeenCalledTimes(model === "retired-model" ? 2 : 1);
  });

  it("does not start fallback with less than one second remaining", async () => {
    isolate();
    let now = 1_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = vi.fn(async () => {
      now += 4_500;
      return failure(400, "Model is currently unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { dispatchToTitan } = await import("../services/titanProvider.js");
      await expect(dispatchToTitan({ ...request, timeoutMs: 5_000 })).rejects.toMatchObject({ name: "ProviderUnavailableError" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });

  it("does not retry transport failures as unavailable models", async () => {
    isolate();
    const fetchMock = vi.fn(async () => { throw new Error("Connection failed"); });
    vi.stubGlobal("fetch", fetchMock);
    const { dispatchToTitan } = await import("../services/titanProvider.js");
    await expect(dispatchToTitan(request)).rejects.toMatchObject({ name: "ProviderUnavailableError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Titan provider configuration", () => {
  it("disables default Ollama thinking for bounded interactive responses", async () => {
    for (const name of ["OPENAI_API_KEY", "TOKENLLM7_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "VITE_GROQ_API_KEY"]) vi.stubEnv(name, "");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("TOKENLLM7_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
    vi.stubEnv("OLLAMA_MODEL", "qwen3.5:9b");
    let requestBody;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "17 blue trays" } }] }) };
    }));
    const { dispatchToTitan } = await import("../services/titanProvider.js?ollama-interactive-test");
    const result = await dispatchToTitan({ messages: [{ role: "user", content: "How many trays?" }], priority: "context" });
    expect(requestBody.reasoning_effort).toBe("none");
    expect(result.answer).toBe("17 blue trays");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the legacy Groq deployment variable server-side during migration", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "fixture");

    const { getAvailableProviders } =
      await import("../services/titanProvider.js?legacy-groq-test");

    expect(getAvailableProviders().GROQ).toMatchObject({
      configured: true,
      model: "qwen/qwen3.8-27b",
      protocol: "chat-completions",
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Rename it to GROQ_API_KEY"),
    );
  });

  it("prefers the non-public server variable when both names exist", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("VITE_GROQ_API_KEY", "legacy-fixture");

    const { getAvailableProviders } =
      await import("../services/titanProvider.js?modern-groq-test");

    expect(getAvailableProviders().GROQ.configured).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("recovers from a stale Groq model override with the verified fallback model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("TOKENLLM7_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("GROQ_MODEL", "retired-model");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "");

    const requestModels = [];
    const fetchMock = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requestModels.push(body.model);

      if (requestModels.length === 1) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              error: { message: "The requested model does not exist." },
            }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "fallback response" } }],
          usage: { total_tokens: 7 },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchToTitan } =
      await import("../services/titanProvider.js?groq-model-fallback-test");

    const result = await dispatchToTitan({
      messages: [{ role: "user", content: "Summarize this source." }],
      priority: "performance",
    });

    expect(result).toMatchObject({
      answer: "fallback response",
      modelUsed: "qwen/qwen3.8-27b",
    });
    expect(requestModels).toEqual(["retired-model", "qwen/qwen3.8-27b"]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("retrying once with qwen/qwen3.8-27b"),
    );
  });

  it("queues burst traffic instead of rejecting requests when provider capacity is full", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("TOKENLLM7_KEY", "");
    vi.stubEnv("TOKENLLM7_ENABLED", "false"); // isolate to GROQ; LLM7 is no-auth by default
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    vi.stubEnv("TITAN_MAX_CONCURRENCY", "1");
    vi.stubEnv("TITAN_TOTAL_TIMEOUT_MS", "5000");

    let active = 0;
    let maximumActive = 0;
    const fetchMock = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "queued response" } }],
          usage: { total_tokens: 5 },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchToTitan } =
      await import("../services/titanProvider.js?capacity-queue-test");
    const request = () =>
      dispatchToTitan({
        messages: [{ role: "user", content: "Generate one study question." }],
        priority: "performance",
      });

    const results = await Promise.all([request(), request(), request()]);

    expect(results.map((result) => result.answer)).toEqual([
      "queued response",
      "queued response",
      "queued response",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maximumActive).toBe(1);
  });
  it("honors provider reset windows and logs a bounded diagnostic", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("TOKENLLM7_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "");

    const responseHeaders = new Map([
      ["x-ratelimit-reset-tokens", "1m2.5s"],
      ["x-ratelimit-limit-tokens", "12000"],
      ["x-ratelimit-remaining-tokens", "0"],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: { get: (name) => responseHeaders.get(name) || null },
        text: async () =>
          JSON.stringify({
            error: {
              code: "rate_limit_exceeded",
              message: "Daily provider allowance exhausted.",
            },
          }),
      })),
    );

    const { dispatchToTitan, getAvailableProviders } =
      await import("../services/titanProvider.js?provider-reset-test");

    await expect(
      dispatchToTitan({
        messages: [{ role: "user", content: "Summarize this source." }],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    expect(getAvailableProviders().GROQ.available).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("retry after ~63s"),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Daily provider allowance exhausted"),
    );
  });

  it("fits grounded chat output inside the configured provider request budget", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("TOKENLLM7_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("GROQ_REQUEST_TOKEN_BUDGET", "11000");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "");

    let requestBody;
    const fetchMock = vi.fn(async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "grounded response" } }],
          usage: { total_tokens: 10 },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchToTitan } =
      await import("../services/titanProvider.js?groq-budget-test");

    await dispatchToTitan({
      messages: [
        { role: "system", content: "Use only the supplied evidence." },
        { role: "user", content: "e".repeat(27_000) },
      ],
      priority: "context",
    });

    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(256);
    expect(requestBody.max_tokens).toBeLessThanOrEqual(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
